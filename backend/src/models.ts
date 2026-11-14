import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";
import { START_LEVEL } from "./policy.ts";
import type { GuardLayer, GuardSeverity, StruggleType } from "./types.ts";

// The Mongoose models for every collection in `.cursor/rules/project.mdc`
// under "Data model". Field names are snake_case on purpose: they are the names
// the rule file, the board, and the professor dashboard all use, and the API
// returns them unchanged. Renaming one here silently breaks every route and
// screen that reads it.
//
// Nothing in this file creates a document. Assignments exist because a
// professor saved the setup form; students, sessions, messages, and scribe
// events exist because a person started a session and sent a turn. There is no
// seed and no `is_synthetic` flag (see "Real MVP" in the rule file).

/** The canary stored beside every answer key. The guard treats any draft containing it as a leak. */
export const CANARY = "MARGIN_CANARY_7f3a";

/** Hint ladder bounds. Level 1 is a question, 2 a pointer to the notes, 3 a different worked example. */
const HINT_LEVELS = [1, 2, 3] as const;

// The shared shapes live in `types.ts` (L-B1) as TypeScript types only, and
// Mongoose needs runtime arrays for `enum` validation. Each array below is
// built from a `Record<SharedType, true>`, which the compiler requires to list
// every member of the type and nothing else. If `types.ts` adds, removes, or
// renames a struggle type, severity, or layer, this file stops compiling until
// the enum matches, so the database cannot accept a value the rest of the app
// does not know (or reject one it does).
// Exported for scribe.ts, which validates the model's label against the same list.
export const STRUGGLE_TYPES = Object.keys({
  misconception: true,
  stuck_starting: true,
  syntax_or_mechanics: true,
  careless_error: true,
  none: true,
} satisfies Record<StruggleType, true>) as StruggleType[];
const GUARD_SEVERITIES = Object.keys({
  none: true,
  partial: true,
  full: true,
} satisfies Record<GuardSeverity, true>) as GuardSeverity[];
const GUARD_LAYERS = Object.keys({
  deterministic: true,
  judge: true,
  fallback: true,
} satisfies Record<GuardLayer, true>) as GuardLayer[];

// Roles are local to the transcript. No shared type names them, so this is
// the one place they are defined.
const MESSAGE_ROLES = ["student", "tutor"] as const;

/**
 * Validates a hint level or ceiling as a whole number from 1 to 3.
 *
 * `min`/`max` alone would accept 2.5, and the policy code compares levels with
 * `+ 1`, so a fractional ceiling would let a student climb past the professor's
 * limit.
 */
const hintLevelField = {
  type: Number,
  min: 1,
  max: 3,
  validate: {
    // null passes: a student message has no hint level, and its field defaults
    // to null. Assignments and sessions still require a number through their
    // defaults, so null never reaches the policy.
    validator: (n: number | null) => n === null || Number.isInteger(n),
    message: "A hint level is a whole number from 1 to 3.",
  },
};

// ---------------------------------------------------------------------------
// assignments
// ---------------------------------------------------------------------------

const assignmentSchema = new Schema(
  {
    course_name: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    // The problem statement the student works on. Students see this.
    prompt: { type: String, required: true },
    // The professor's solution. `select: false` means no query returns it
    // unless the caller writes `.select("+answer_key")`, and only the guard's
    // loader should ever do that. Removing this flag would put the solution in
    // every `find()` result, including the student view.
    answer_key: { type: String, required: true, select: false },
    // Hidden for the same reason as the key: if a student ever saw the canary,
    // they could paste it back and make the guard flag their own messages.
    canary: { type: String, default: CANARY, select: false },
    // The professor's pasted lecture notes. Level-2 hints cite these by keyword.
    notes: { type: String, default: "" },
    // The controlled vocabulary the scribe must choose `concept` from. It is
    // per assignment, so the dashboard heatmap only has rows the professor named.
    concepts: {
      type: [{ type: String, trim: true }],
      validate: {
        validator: (list: string[]) => list.length > 0,
        message: "An assignment needs at least one concept for the scribe to label with.",
      },
    },
    hint_ceiling: { ...hintLevelField, default: 3 },
  },
  {
    collection: "assignments",
    // `as const` on every timestamps option in this file: without it Mongoose's
    // types widen the field names to `string` and give each model an index
    // signature of dates, which makes ordinary query filters fail to compile.
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" } as const,
    toJSON: {
      // Defense in depth: even if a route loads the key with `+answer_key` and
      // then calls `res.json(doc)`, serialization drops the key and the canary.
      // A professor route that needs the key must build its response by hand,
      // which makes sending the key a visible, reviewable choice.
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.answer_key;
        delete ret.canary;
        return ret;
      },
    },
  },
);

export type AssignmentDoc = InferSchemaType<typeof assignmentSchema>;
export const Assignment = mongoose.model("Assignment", assignmentSchema);

/**
 * The only fields a student response may contain, written as an inclusion
 * list rather than "everything except the key".
 *
 * With an inclusion list, a field added to the schema later (a rubric, a
 * second key) stays hidden until someone deliberately adds it here. An
 * exclusion list would leak it by default. `findStudentAssignment` takes no
 * projection from its caller, so a student route has no way to ask for more.
 */
export const STUDENT_ASSIGNMENT_FIELDS = Object.freeze([
  "_id",
  "course_name",
  "title",
  "prompt",
  "notes",
  "concepts",
  "hint_ceiling",
] as const);

/** The shape a student receives for an assignment. It has no key and no canary. */
export type StudentAssignmentView = {
  id: string;
  course_name: string;
  title: string;
  prompt: string;
  notes: string;
  concepts: string[];
  hint_ceiling: number;
};

/**
 * Loads an assignment for a student route.
 *
 * Every student-facing read of an assignment goes through here. The query
 * projects only `STUDENT_ASSIGNMENT_FIELDS`, and the result is copied field by
 * field into a new object, so the key is absent at the database, in memory, and
 * in the JSON. Returns null for an unknown or malformed id so the route can
 * answer 404 instead of throwing a cast error.
 */
export async function findStudentAssignment(id: string): Promise<StudentAssignmentView | null> {
  if (!mongoose.isValidObjectId(id)) return null;

  const doc = await Assignment.findById(id).select(STUDENT_ASSIGNMENT_FIELDS.join(" ")).lean();
  if (!doc) return null;

  return {
    id: String(doc._id),
    course_name: doc.course_name,
    title: doc.title,
    prompt: doc.prompt,
    notes: doc.notes ?? "",
    concepts: doc.concepts ?? [],
    hint_ceiling: doc.hint_ceiling ?? 3,
  };
}

// ---------------------------------------------------------------------------
// students
// ---------------------------------------------------------------------------

// A student is created when a person starts a session, never ahead of time.
// `display_name` is shown to the professor. It is never put in a model prompt
// (the privacy rule: the cloud model sees the work, not who wrote it).
const studentSchema = new Schema(
  {
    display_name: { type: String, required: true, trim: true },
  },
  { collection: "students", timestamps: { createdAt: "created_at", updatedAt: false } as const },
);

export type StudentDoc = InferSchemaType<typeof studentSchema>;
export const Student = mongoose.model("Student", studentSchema);

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

// One student working on one assignment. `current_level` is the rung of the
// hint ladder the deterministic policy last chose. It is stored so a reload or
// an API restart does not drop the student back to level 1.
//
// There is deliberately no answer-key field here. The message route loads the
// key from the assignment only for the guard; copying it onto every session
// would multiply the places a careless query could return it.
const sessionSchema = new Schema(
  {
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    assignment_id: { type: Schema.Types.ObjectId, ref: "Assignment", required: true },
    // START_LEVEL comes from policy.ts so the schema and the ladder cannot
    // disagree about where a new student begins.
    current_level: { ...hintLevelField, default: START_LEVEL },
  },
  { collection: "sessions", timestamps: { createdAt: "created_at", updatedAt: false } as const },
);

// The professor drill-down lists sessions per assignment, and a student's own
// progress view lists them per student.
sessionSchema.index({ assignment_id: 1, student_id: 1 });

export type SessionDoc = InferSchemaType<typeof sessionSchema>;
export const Session = mongoose.model("Session", sessionSchema);

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

// The guard's decision on a tutor draft, kept for the debug drawer and for the
// red-team record. Its fields are `GuardVerdict` from types.ts. The guard is
// required not to quote the answer key in `reason`, but the board still keeps
// verdict reasons on the server as a second line of defense: a student
// response is built from TurnResult, never by sending this stored row.
const guardVerdictSchema = new Schema(
  {
    leaks: { type: Boolean, required: true },
    severity: { type: String, enum: GUARD_SEVERITIES, required: true },
    reason: { type: String, default: "" },
    layer: { type: String, enum: GUARD_LAYERS, required: true },
  },
  { _id: false },
);

// Both sides of the chat. A student row has no hint level or verdict; a tutor
// row records the level it was written at, what the guard said, and how many
// regenerations it took. The transcript drill-down reads these in order.
const messageSchema = new Schema(
  {
    session_id: { type: Schema.Types.ObjectId, ref: "Session", required: true },
    role: { type: String, enum: MESSAGE_ROLES, required: true },
    // The original text, unredacted. The email/phone/id strip happens on the
    // copy sent to the model, not here, so the professor sees what was typed.
    content: { type: String, required: true },
    // Set only for snap-your-work uploads, which stay a 501 until D-R1 works.
    image_path: { type: String, default: null },
    hint_level: { ...hintLevelField, default: null },
    guard_verdict: { type: guardVerdictSchema, default: null },
    retries: { type: Number, default: 0, min: 0 },
  },
  { collection: "messages", timestamps: { createdAt: "created_at", updatedAt: false } as const },
);

// Transcripts are always read as one session in time order.
messageSchema.index({ session_id: 1, created_at: 1 });

export type MessageDoc = InferSchemaType<typeof messageSchema>;
export const Message = mongoose.model("Message", messageSchema);

// ---------------------------------------------------------------------------
// scribe_events
// ---------------------------------------------------------------------------

// One label per student turn. This is the raw material for every number the
// professor sees: the heatmap and the Thursday card percent are computed in
// code from these rows, never written by a model. `student_id` and
// `assignment_id` are copied from the session so those aggregations need no
// join.
const scribeEventSchema = new Schema(
  {
    message_id: { type: Schema.Types.ObjectId, ref: "Message", required: true },
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    assignment_id: { type: Schema.Types.ObjectId, ref: "Assignment", required: true },
    // Must be one of the assignment's `concepts`. The scribe checks that before
    // writing, because the list differs per assignment and a schema enum cannot.
    concept: { type: String, required: true },
    struggle_type: { type: String, enum: STRUGGLE_TYPES, required: true },
    attempt_made: { type: Boolean, required: true },
    jailbreak_attempt: { type: Boolean, required: true },
    demonstrated_understanding: { type: Boolean, required: true },
    // One short quote from the student that justifies the label.
    evidence: { type: String, default: "" },
  },
  { collection: "scribe_events", timestamps: { createdAt: "created_at", updatedAt: false } as const },
);

// The class summary groups by assignment then concept; progress reads by student.
scribeEventSchema.index({ assignment_id: 1, concept: 1 });
scribeEventSchema.index({ student_id: 1, assignment_id: 1 });

export type ScribeEventDoc = InferSchemaType<typeof scribeEventSchema>;
export const ScribeEvent = mongoose.model("ScribeEvent", scribeEventSchema);

// ---------------------------------------------------------------------------
// thursday_cards
// ---------------------------------------------------------------------------

// A generated reteach card. `payload` is free-form JSON because its shape
// belongs to the coach (D-B8): the weakest concept, the percent code computed,
// and the model's three practice problems. Cards are kept, not overwritten, so
// the professor can compare weeks.
const thursdayCardSchema = new Schema(
  {
    assignment_id: { type: Schema.Types.ObjectId, ref: "Assignment", required: true },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  { collection: "thursday_cards", timestamps: { createdAt: "generated_at", updatedAt: false } as const },
);

thursdayCardSchema.index({ assignment_id: 1, generated_at: -1 });

export type ThursdayCardDoc = InferSchemaType<typeof thursdayCardSchema>;
export const ThursdayCard = mongoose.model("ThursdayCard", thursdayCardSchema);

// ---------------------------------------------------------------------------
// professor_messages
// ---------------------------------------------------------------------------

// One row per generated Thursday card, holding the card as readable text. This
// is the Photon entry: `/prof/messages` lists these newest first. It is a
// separate collection from `messages` because it belongs to the professor, not
// to any student session.
const professorMessageSchema = new Schema(
  {
    assignment_id: { type: Schema.Types.ObjectId, ref: "Assignment", required: true },
    body: { type: String, required: true },
  },
  { collection: "professor_messages", timestamps: { createdAt: "created_at", updatedAt: false } as const },
);

professorMessageSchema.index({ assignment_id: 1, created_at: -1 });

export type ProfessorMessageDoc = InferSchemaType<typeof professorMessageSchema>;
export const ProfessorMessage = mongoose.model("ProfessorMessage", professorMessageSchema);

/** Reference id type for callers that build documents across collections. */
export type Id = Types.ObjectId;
