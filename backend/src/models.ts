import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";
import { START_LEVEL } from "./policy.ts";
import type { AssignmentKind, GuardLayer, GuardSeverity, StruggleType } from "./types.ts";

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
/** The kinds of assignment, tied to the shared type the same way as the enums above. */
export const ASSIGNMENT_KINDS = Object.keys({
  code: true,
  written: true,
  math: true,
  topic: true,
} satisfies Record<AssignmentKind, true>) as AssignmentKind[];
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
    // A learning topic is the one kind with no key: it is material to teach, and there is no solution to hold back. Every other kind must have one, or the guard would have nothing to check a hint against.
    answer_key: {
      type: String,
      // An empty key is allowed: a professor may post questions before the key (the form warns them). The guard then has no key lines to match, and the judge reads the draft alone. A key that is missing altogether is still refused.
      required: function (this: { kind?: string; answer_key?: string | null }) {
        return this.kind !== "topic" && typeof this.answer_key !== "string";
      },
      select: false,
    },
    // What kind of work this is. Assignments saved before this field existed are code.
    kind: { type: String, enum: ASSIGNMENT_KINDS, default: "code" },
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
    // Questions 2 and on. `prompt` and `answer_key` above are question 1, so an
    // assignment saved before questions existed is simply a one-question
    // assignment and runs exactly as before. Each later question's prompt is
    // student-visible here, and its key sits in `question_keys` at the same
    // index, hidden by `select: false` like `answer_key`. They are two arrays,
    // not one array of {prompt, key}, because `select: false` cannot hide one
    // field of a subdocument while a student query projects the other.
    questions: { type: [{ prompt: { type: String, required: true }, _id: false }], default: [] },
    question_keys: { type: [String], default: [], select: false },
    // When it is due. Null means no due date, and the course page lists it after the dated ones.
    due_at: { type: Date, default: null },
    // The professor opts in per assignment. Off, the student sees the prompt
    // and the due date and no tutor: every tutor route refuses the session
    // before any model is called. The default is on, so every assignment saved
    // before this field existed (the demo included) behaves exactly as before.
    margin_enabled: { type: Boolean, default: true },
    // The lectures this assignment covers. When set, the level-2 pointer
    // searches those lectures' slides, page by page, and cites them as
    // "Lecture n, slide p". Empty means the pasted notes are searched, as before.
    lecture_ids: { type: [{ type: Schema.Types.ObjectId, ref: "LectureFile" }], default: [] },
    // The professor's Question PDF, kept in GridFS so a student can open the
    // original sheet. The Answer key PDF is never stored: its text is read
    // into the hidden keys at save time and the file is dropped.
    question_pdf_id: { type: Schema.Types.ObjectId, default: null },
    // The class this belongs to. Set when the assignment is saved, from its course name. Null only on a row saved before courses existed, until the course list is next read.
    course_id: { type: Schema.Types.ObjectId, ref: "Course", default: null },
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
        delete ret.question_keys;
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
  "course_id",
  "course_name",
  "title",
  "prompt",
  "kind",
  "notes",
  "concepts",
  "hint_ceiling",
  "questions",
  "due_at",
  "margin_enabled",
  "question_pdf_id",
] as const);

/** The shape a student receives for an assignment. It has no key and no canary. */
export type StudentAssignmentView = {
  id: string;
  /** The class this work belongs to, so the page can walk back to it. Null when the assignment was saved before classes existed. */
  course_id: string | null;
  course_name: string;
  title: string;
  prompt: string;
  kind: AssignmentKind;
  notes: string;
  concepts: string[];
  hint_ceiling: number;
  /** Every question's prompt in order. Item 0 is `prompt`. Never a key. */
  questions: string[];
  /** ISO time, or null for no due date. */
  due_at: string | null;
  margin_enabled: boolean;
  /** True when the professor's Question PDF can be opened. The id itself stays on the server. */
  has_question_pdf: boolean;
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
    course_id: doc.course_id ? String(doc.course_id) : null,
    course_name: doc.course_name,
    title: doc.title,
    prompt: doc.prompt,
    kind: (doc.kind ?? "code") as AssignmentKind,
    notes: doc.notes ?? "",
    concepts: doc.concepts ?? [],
    hint_ceiling: doc.hint_ceiling ?? 3,
    questions: [doc.prompt, ...(doc.questions ?? []).map((q) => q.prompt)],
    due_at: doc.due_at ? new Date(doc.due_at).toISOString() : null,
    margin_enabled: doc.margin_enabled !== false,
    has_question_pdf: doc.question_pdf_id != null,
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
    // Which question the student is on, 0-based. It only moves forward, when
    // the student presses Next or Finish, and the tutor and the guard read the
    // prompt and key at this index.
    current_question: { type: Number, default: 0, min: 0 },
    // Real attempts on the current question, counted from the scribe's
    // attempt_made. The request rule in policy.ts unlocks the slides and the
    // worked example only after three. It resets when the student moves on.
    question_attempts: { type: Number, default: 0, min: 0 },
    // The per-question clock the professor sees. One entry opens when a
    // question starts and closes when the student presses Next or Finish. The
    // times are the server's, so the page cannot edit them, and no student
    // route returns this field. The student page shows no clock; the start card
    // tells the student their time per question is shared with the professor.
    question_times: {
      type: [{ index: { type: Number, required: true }, started_at: { type: Date, required: true }, finished_at: { type: Date, default: null }, _id: false }],
      default: [],
    },
    // Set when the student finishes the last question. Null while working.
    completed_at: { type: Date, default: null },
    // The two questions written for the student after the last question, and
    // their answers. Formative: the professor reads them, nothing grades them.
    reflection: {
      type: new Schema(
        {
          why: { type: String, required: true },
          what_if: { type: String, required: true },
          what_if_index: { type: Number, required: true },
          answers: { why: { type: String, default: "" }, what_if: { type: String, default: "" } },
        },
        { _id: false },
      ),
      default: null,
    },
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
    // Which question of the assignment this turn was on, 0-based, copied from
    // the session's current_question when the row is written. The professor's
    // per-question work view groups turns by it. Null on rows written before
    // it existed and on Talk captions; roster.ts places those by the session's
    // per-question clock instead, so leaving it out never hides a turn.
    question_index: { type: Number, default: null, min: 0 },
    // The tutor's tool calls on this turn, as the professor's transcript shows
    // them: the tool, its arguments, and what it answered (cut short). Only the
    // released draft's calls are kept; a held draft's arguments are the held
    // words, and those are stored nowhere.
    tool_calls: {
      type: [{ _id: false, name: { type: String, required: true }, args: { type: Schema.Types.Mixed, default: {} }, result: { type: String, default: "" } }],
      default: [],
    },
    // What the tools asked the student's page to do (draw, mark, write, open a
    // slide), after the guard released them. Kept so the transcript and a
    // reload can say what happened on the canvas. The canvas itself is the
    // student's and stays in their browser.
    actions: { type: [Schema.Types.Mixed], default: [] },
    // On a student message: the page sent the tutor a list of what was on the
    // canvas, and whether it sent a picture of it too. The picture is kept in
    // the blob store under `picture_key`, so the professor sees exactly what
    // Askretes was shown.
    canvas: {
      type: { _id: false, shared: { type: Boolean, default: false }, picture: { type: Boolean, default: false }, picture_key: { type: String, default: null } },
      default: null,
    },
    // Files attached to a student message: name, kind, size, and where the
    // original is kept, so the student and the professor can open it again.
    attachments: {
      type: [
        {
          _id: false,
          id: { type: String, default: null },
          name: { type: String, required: true },
          kind: { type: String, required: true },
          bytes: { type: Number, default: 0 },
          // Where the original file is kept in the blob store (storage.ts), and the type it is served with.
          storage_key: { type: String, default: null },
          content_type: { type: String, default: null },
        },
      ],
      default: [],
    },
    // The canvas as shapes, for the professor's transcript: on a student
    // message, the board the student shared; on a tutor message, the board
    // after Askretes' marks. Excalidraw elements, with links removed; the
    // pictures on the board are kept separately, in `board_files`.
    board: { type: [Schema.Types.Mixed], default: undefined },
    // The pictures on that board, kept in the blob store: the Excalidraw file
    // id each image element names, and where its bytes are.
    board_files: {
      type: [{ _id: false, id: { type: String, required: true }, storage_key: { type: String, required: true }, content_type: { type: String, required: true } }],
      default: undefined,
    },
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
// The roster and the class summary read one assignment's labels in time order. Without this the database
// sorted every label in memory on each dashboard load.
scribeEventSchema.index({ assignment_id: 1, created_at: 1, _id: 1 });

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

// ---------------------------------------------------------------------------
// courses and course_materials
// ---------------------------------------------------------------------------

/** The accent tokens a course can use. Each has a light and a dark value in frontend/app/globals.css. */
export const COURSE_ACCENTS = ["red", "blue", "green", "amber", "teal", "slate"] as const;
export type CourseAccent = (typeof COURSE_ACCENTS)[number];

/** A course's accent: the one the professor chose, or one picked from the id so it stays the same on every load. */
export function accentFor(course: { _id: unknown; accent?: string | null }): CourseAccent {
  if (course.accent && (COURSE_ACCENTS as readonly string[]).includes(course.accent)) return course.accent as CourseAccent;
  const id = String(course._id);
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COURSE_ACCENTS[h % COURSE_ACCENTS.length];
}

// A class: the thing a professor teaches and a student is in. It holds what
// is shared across every assignment and lesson in it: a description and the
// professor's classroom notes. A course exists because a professor created
// it, or saved an assignment under its name.
const courseSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "" },
    // Who teaches it, as the name that professor typed. There is no login this weekend, so this is a label that sorts a professor's own classes first, not a permission.
    professor: { type: String, default: "", trim: true },
    // Notes for the whole class, such as the syllabus or a running summary. The tutor reads these along with an assignment's own notes.
    notes: { type: String, default: "" },
    // The catalogue code ("PHYS 101") and the term ("Fall 2026") shown on the course card. Both are optional labels.
    code: { type: String, default: "", trim: true },
    term: { type: String, default: "", trim: true },
    // The card band and header colour. A name from a fixed set of theme
    // tokens, never a colour value, so every class reads in light and dark.
    // Null means "pick from the id", which is stable without being stored.
    accent: { type: String, enum: [...COURSE_ACCENTS, null], default: null },
    // A professor takes a class off the dashboard and the course lists by setting this. Nothing else is removed: its assignments, enrollments, and student sessions stay in the database. Every list of courses filters on it, so a hidden class is not shown to anyone.
    hidden: { type: Boolean, default: false },
  },
  { collection: "courses", timestamps: { createdAt: "created_at", updatedAt: "updated_at" } as const },
);
export const Course = mongoose.model("Course", courseSchema);

// A file the professor added to a class: a handout, slides, a reading. It is
// stored as text. A text file is stored as written, and a PDF or a photo is
// read once by the model when it is added, so students and the tutor can
// search it like any other notes.
const courseMaterialSchema = new Schema(
  {
    course_id: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
  },
  { collection: "course_materials", timestamps: { createdAt: "created_at", updatedAt: false } as const },
);
courseMaterialSchema.index({ course_id: 1, created_at: 1 });
export const CourseMaterial = mongoose.model("CourseMaterial", courseMaterialSchema);

// The professor's conversation with Askretes' class analyst about one
// assignment (analyst.ts). Every question and answer is kept, with the tools
// the analyst called and what they returned (cut short), so the professor can
// scroll back. Students appear in it only as labels (S1, S2, ...); the page
// shows names from the current label map.
const analystMessageSchema = new Schema(
  {
    // One of the two: an assignment's conversation (the analyst beside its dashboard), or a class's (the class chat, which can draft assignments).
    assignment_id: { type: Schema.Types.ObjectId, ref: "Assignment", default: null },
    course_id: { type: Schema.Types.ObjectId, ref: "Course", default: null },
    professor: { type: String, default: null },
    role: { type: String, enum: ["professor", "analyst"], required: true },
    // A draft the class chat made in this answer, by id and title, so the page can offer "Review and post" again after a reload.
    draft: { type: Schema.Types.Mixed, default: null },
    content: { type: String, required: true },
    tool_calls: {
      type: [{ _id: false, name: { type: String, required: true }, args: { type: Schema.Types.Mixed, default: {} }, result: { type: String, default: "" } }],
      default: [],
    },
  },
  { collection: "analyst_messages", timestamps: { createdAt: "created_at", updatedAt: false } as const },
);
analystMessageSchema.index({ assignment_id: 1, created_at: 1 });
analystMessageSchema.index({ course_id: 1, created_at: 1 });
export const AnalystMessage = mongoose.model("AnalystMessage", analystMessageSchema);

// A student in a class. It exists because the student pressed Join, or
// started a session on one of the class's assignments; no script enrolls
// anyone. My courses is the list of these rows for one student.
const enrollmentSchema = new Schema(
  {
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    course_id: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  },
  { collection: "enrollments", timestamps: { createdAt: "created_at", updatedAt: false } as const },
);
// One row per pair, so joining twice is an upsert and not a second enrollment.
enrollmentSchema.index({ student_id: 1, course_id: 1 }, { unique: true });
export const Enrollment = mongoose.model("Enrollment", enrollmentSchema);

// A lecture's slides as the professor uploaded them. The PDF itself is in
// GridFS (bucket `lecture_pdfs`, see slides.ts) under `file_id`, a random id:
// the uploaded file name is never a path, only a default title. It is kept
// so students can read the real slides in the browser. The text the tutor
// searches is in slide_pages, one row per page.
const lectureFileSchema = new Schema(
  {
    course_id: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    lecture_number: { type: Number, required: true, min: 0 },
    title: { type: String, required: true, trim: true },
    lecture_date: { type: Date, default: null },
    file_id: { type: Schema.Types.ObjectId, required: true },
    page_count: { type: Number, required: true, min: 0 },
  },
  { collection: "lecture_files", timestamps: { createdAt: "uploaded_at", updatedAt: false } as const },
);
lectureFileSchema.index({ course_id: 1, lecture_number: 1 });
export const LectureFile = mongoose.model("LectureFile", lectureFileSchema);

// The text of one page of a lecture PDF, read once at upload. A page with no
// text layer (a scanned slide) is stored as "", and the professor is told; it
// is not guessed at. The tutor cites a page as "Lecture n, slide p", where p
// is this page number, so a citation opens the same page in the viewer.
const slidePageSchema = new Schema(
  {
    lecture_file_id: { type: Schema.Types.ObjectId, ref: "LectureFile", required: true },
    page_number: { type: Number, required: true, min: 1 },
    text: { type: String, default: "" },
  },
  { collection: "slide_pages" },
);
slidePageSchema.index({ lecture_file_id: 1, page_number: 1 }, { unique: true });
export const SlidePage = mongoose.model("SlidePage", slidePageSchema);

// ---------------------------------------------------------------------------
// student_notes
// ---------------------------------------------------------------------------

// A student's own notes on one assignment or topic: what they typed or pasted
// from a file. One row per student and assignment. The row exists because
// that student saved it. The professor's dashboard does not read this
// collection: these are the student's private study notes, not coursework to
// be looked over, and showing them would make the tool feel watched.
const studentNoteSchema = new Schema(
  {
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    assignment_id: { type: Schema.Types.ObjectId, ref: "Assignment", required: true },
    body: { type: String, default: "" },
  },
  { collection: "student_notes", timestamps: { createdAt: "created_at", updatedAt: "updated_at" } as const },
);

// One note per pair. The unique index is what lets a save be an upsert and not a second copy.
studentNoteSchema.index({ student_id: 1, assignment_id: 1 }, { unique: true });

export const StudentNote = mongoose.model("StudentNote", studentNoteSchema);

/** Reference id type for callers that build documents across collections. */
export type Id = Types.ObjectId;
