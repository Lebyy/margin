import { Router, type NextFunction, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { dbState } from "./db.ts";
import type { TextGenerator } from "./llm.ts";
import { Assignment, CANARY, Message, Session, Student, findStudentAssignment } from "./models.ts";
import { START_LEVEL } from "./policy.ts";
import { labelTurn, saveScribeEvent } from "./scribe.ts";
import { runTurn } from "./turn.ts";
import type { TutorRunner } from "./tutor.ts";
import type { GuardVerdict, HintLevel } from "./types.ts";

// The HTTP routes David owns (board contract: routes.ts). Every record the
// product shows exists because a request here created it. There is no seed
// route and no script that fills the database, so an empty dashboard is the
// honest state before anyone uses the app.

/**
 * Refuses data routes while MongoDB is not connected.
 *
 * Buffering is off (see db.ts), so a query without a connection throws. This
 * turns that into a clear 503 instead of a generic 500, and it runs before the
 * body is validated so a teammate without MONGODB_URI sees the real cause
 * first. `/health` is registered outside this router and keeps working.
 */
function requireDb(_req: Request, res: Response, next: NextFunction): void {
  if (dbState() !== "connected") {
    res.status(503).json({ error: "database_unavailable" });
    return;
  }
  next();
}

/**
 * What a professor submits from the setup form.
 *
 * The canary is not in this schema. The server always stores `CANARY`, so a
 * client cannot set a different value that the guard does not know to look
 * for. Unknown keys are stripped by zod, which also means a request cannot
 * slip in a field such as `is_synthetic`.
 */
const assignmentInput = z.object({
  course_name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  answer_key: z.string().trim().min(1),
  notes: z.string().default(""),
  // The scribe may only label turns with these, and the heatmap gets one row
  // per concept. Duplicates would give the professor two rows for one idea.
  concepts: z
    .array(z.string().trim().min(1))
    .min(1)
    .refine((list) => new Set(list).size === list.length, "concepts must not repeat"),
  hint_ceiling: z.number().int().min(1).max(3).default(3),
});

/**
 * The same form when it edits a saved assignment.
 *
 * `id` names the assignment. `answer_key` may be left out, because the setup
 * form never receives the key back (every response drops it) and so cannot
 * send it again. Leaving it out keeps the stored key; sending it replaces it.
 * Requiring it would force the professor to retype the solution on every edit.
 */
const assignmentUpdate = assignmentInput.extend({
  id: z.string().refine((s) => mongoose.isValidObjectId(s), "id is not an assignment id"),
  answer_key: z.string().trim().min(1).optional(),
});

/** A string that Mongoose can cast to an ObjectId, checked before any query. */
const objectId = z.string().refine((s) => mongoose.isValidObjectId(s), "not a valid id");

/**
 * What the student screen sends to start working on an assignment.
 *
 * A returning student sends their `student_id`. A first visit sends a
 * `display_name` instead, and this route creates the student. That is the only
 * place a student document is ever created, which is why the students
 * collection stays empty until someone actually starts a session. Exactly one
 * of the two is required, so a typo cannot create a second copy of a student
 * who already has an id.
 */
const sessionInput = z
  .object({
    assignment_id: objectId,
    student_id: objectId.optional(),
    display_name: z.string().trim().min(1).max(80).optional(),
  })
  .refine((b) => (b.student_id === undefined) !== (b.display_name === undefined), {
    message: "send either student_id or display_name, not both",
  });

/**
 * One student turn. Exactly one of `text` or `image`.
 *
 * Text is the demo path. An image is snap-your-work, which stays a 501 until
 * D-R1's vision call is reliable (board contract). The 8000-character cap is
 * far above a pasted function and stops a whole file from being sent as one
 * message, which would also be sent to two models.
 */
const messageInput = z
  .object({
    text: z.string().trim().min(1).max(8000).optional(),
    image: z.object({ mimeType: z.string().min(1), base64: z.string().min(1) }).optional(),
  })
  .refine((b) => (b.text === undefined) !== (b.image === undefined), {
    message: "send either text or image, not both",
  });

/** How many earlier messages the scribe and the tutor see. Enough for "I tried that", short enough to stay cheap. */
const HISTORY_TURNS = 10;

/**
 * Key lines shorter than this are not checked in the verdict reason. Lines
 * like `return 0` are too common to mean the reason quotes the solution.
 */
const MIN_KEY_LINE = 12;

/**
 * The verdict as the student response carries it.
 *
 * The guard already strips the key from its reason, but the board says
 * reasons that quote the key stay on the server, so this checks again at the
 * last point before the wire. A reason that contains a key line or the canary
 * is blanked rather than edited, and the full verdict is still stored on the
 * tutor message for the professor's transcript.
 */
function studentVerdict(verdict: GuardVerdict, answerKey: string, canary: string): GuardVerdict {
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const reason = squash(verdict.reason);
  const keyLines = answerKey
    .split("\n")
    .map(squash)
    .filter((line) => line.length >= MIN_KEY_LINE);
  const quotesKey = keyLines.some((line) => reason.includes(line)) || reason.includes(squash(canary));
  return { ...verdict, reason: quotesKey ? "" : verdict.reason };
}

/**
 * Model stand-ins for tests. Production passes nothing and every call goes to
 * Gemini. The scribe and the guard judge both use completeJson, so each gets
 * its own generator to keep their answers apart in a test.
 */
export type RouteDeps = {
  scribe?: TextGenerator;
  judge?: TextGenerator;
  tutor?: TutorRunner;
};

/** Answers a zod failure with field paths only, never the submitted values. */
function rejectInvalid(res: Response, error: z.ZodError): void {
  // zod issues name the path and the rule, not the value, so a rejected
  // request cannot echo the submitted solution into a response or a log.
  res.status(400).json({
    error: "invalid_assignment",
    issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

export function createRouter(deps: RouteDeps = {}): Router {
  const router = Router();
  router.use(requireDb);

  /**
   * POST /api/prof/assignments: a professor saves an assignment.
   *
   * Without `id` this creates one (201); it is the only way an assignment
   * enters the database (D-B2). With `id` it edits that assignment (200) or
   * answers 404. Either way the response goes through the model's toJSON,
   * which drops `answer_key` and the canary, so even the professor's own reply
   * does not carry the key back over the wire.
   */
  router.post("/api/prof/assignments", async (req, res) => {
    const isUpdate = typeof req.body === "object" && req.body !== null && "id" in req.body;

    if (!isUpdate) {
      const parsed = assignmentInput.safeParse(req.body);
      if (!parsed.success) return rejectInvalid(res, parsed.error);

      // `new` + `save` rather than `Assignment.create`: Mongoose 9's typings for
      // `create` reject a string array field, while the constructor accepts it.
      const saved = await new Assignment({ ...parsed.data, canary: CANARY }).save();
      res.status(201).json(saved.toJSON());
      return;
    }

    const parsed = assignmentUpdate.safeParse(req.body);
    if (!parsed.success) return rejectInvalid(res, parsed.error);

    const { id, answer_key, ...fields } = parsed.data;
    const doc = await Assignment.findById(id);
    if (!doc) {
      res.status(404).json({ error: "assignment_not_found" });
      return;
    }

    // The canary is never in `fields`, so an edit cannot change it. The key is
    // only written when the form sent one; otherwise the stored key stays.
    doc.set(fields);
    if (answer_key !== undefined) doc.set("answer_key", answer_key);
    const saved = await doc.save();
    res.status(200).json(saved.toJSON());
  });

  /**
   * POST /api/sessions: a student starts work on one assignment.
   *
   * Every call makes a new session, even for a pair that already has one, so a
   * fresh start begins again at START_LEVEL instead of inheriting yesterday's
   * rung. The level is written explicitly from policy.ts rather than left to
   * the schema default, so the stored row is the exact number the policy reads
   * on the first message. The session carries ids only, never the answer key.
   * Unknown assignment or student ids are 404s and create nothing, not even
   * the student.
   */
  router.post("/api/sessions", async (req, res) => {
    const parsed = sessionInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_session",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }
    const { assignment_id, student_id, display_name } = parsed.data;

    // Checked before the student is created, so a bad assignment link does not
    // leave a student behind with no session.
    if (!(await Assignment.exists({ _id: assignment_id }))) {
      res.status(404).json({ error: "assignment_not_found" });
      return;
    }

    let studentId = student_id;
    if (studentId === undefined) {
      const student = await new Student({ display_name }).save();
      studentId = String(student._id);
    } else if (!(await Student.exists({ _id: studentId }))) {
      res.status(404).json({ error: "student_not_found" });
      return;
    }

    const session = await new Session({
      student_id: studentId,
      assignment_id,
      current_level: START_LEVEL,
    }).save();

    res.status(201).json({
      session_id: String(session._id),
      student_id: studentId,
      assignment_id,
      level: session.current_level,
    });
  });

  /**
   * POST /api/sessions/:id/messages: one student turn.
   *
   * The order follows the per-turn pipeline in project.mdc:
   *   1. Load the session, the assignment (with the key, for the guard only),
   *      and the last few messages.
   *   2. The scribe labels the student's text. It never fails: a bad label is
   *      the closed label, which cannot raise the level.
   *   3. The student message and its scribe event are stored before the tutor
   *      runs, so a turn the student really took is recorded even if the tutor
   *      is down.
   *   4. runTurn picks the level (policy), drafts (tutor), and checks (guard).
   *      This route does not touch the level or the draft itself.
   *   5. The tutor message keeps the full verdict and retries; the session keeps
   *      the new level, which the next message starts from.
   * The response is exactly reply, level, verdict, and retries. No streaming:
   * the guard needs the whole draft before anything is shown.
   */
  router.post("/api/sessions/:id/messages", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const parsed = messageInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_message",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }

    const session = await Session.findById(req.params.id).lean();
    if (!session) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }

    // Snap-your-work is not built yet (D-R1). The answer is the fixed 501 the
    // page knows to ignore, with no model text and nothing stored.
    if (parsed.data.image !== undefined) {
      res.status(501).json({ error: "vision_unavailable" });
      return;
    }
    const text = parsed.data.text as string;

    // The key and canary are selected here and passed only to the scribe's
    // local evidence scrub and to runTurn's guard. They never go into a
    // response, and runTurn keeps them out of the tutor's prompt.
    const assignment = await Assignment.findById(session.assignment_id).select("+answer_key +canary").lean();
    if (!assignment) {
      res.status(404).json({ error: "assignment_not_found" });
      return;
    }
    const answerKey = assignment.answer_key;
    const canary = assignment.canary ?? CANARY;
    const concepts = assignment.concepts ?? [];

    // Newest first for the limit, then flipped so the models read in order.
    // `_id` breaks ties when two messages share a millisecond.
    const history = (
      await Message.find({ session_id: session._id })
        .sort({ created_at: -1, _id: -1 })
        .limit(HISTORY_TURNS)
        .lean()
    )
      .reverse()
      .map((m) => ({ role: m.role, content: m.content }));

    const label = await labelTurn({
      prompt: assignment.prompt,
      concepts,
      studentText: text,
      recentTurns: history,
      answerKey,
      generate: deps.scribe,
    });

    const studentMessage = await new Message({
      session_id: session._id,
      role: "student",
      content: text,
    }).save();
    await saveScribeEvent({
      label,
      messageId: studentMessage._id,
      studentId: session.student_id,
      assignmentId: assignment._id,
      concepts,
    });

    let result;
    try {
      result = await runTurn(
        {
          level: session.current_level as HintLevel,
          hintCeiling: assignment.hint_ceiling as HintLevel,
          prompt: assignment.prompt,
          notes: assignment.notes ?? "",
          turns: history.map((m) => ({ role: m.role, text: m.content })),
          answerKey,
          canary,
        },
        text,
        label,
        { run: deps.tutor, generate: deps.judge },
      );
    } catch (error) {
      // The tutor's model call failed. The student sees a fixed error, never a
      // partial draft, and the session level does not move.
      console.error("runTurn failed:", (error as Error).name);
      res.status(503).json({ error: "tutor_unavailable" });
      return;
    }

    await new Message({
      session_id: session._id,
      role: "tutor",
      content: result.reply,
      hint_level: result.level,
      guard_verdict: result.verdict,
      retries: result.retries,
    }).save();
    await Session.updateOne({ _id: session._id }, { current_level: result.level });

    res.json({
      reply: result.reply,
      level: result.level,
      verdict: studentVerdict(result.verdict, answerKey, canary),
      retries: result.retries,
    });
  });

  /**
   * GET /api/assignments/:id: the student's view of an assignment.
   *
   * This route must not shape the response itself. It returns exactly what
   * `findStudentAssignment` builds from its inclusion list, so the key and the
   * canary are absent at the query, in memory, and in the JSON. The frontend is
   * not trusted to hide anything: what it receives is already safe. An unknown
   * or malformed id is a 404 rather than a cast error.
   */
  router.get("/api/assignments/:id", async (req, res) => {
    const view = await findStudentAssignment(req.params.id);
    if (!view) {
      res.status(404).json({ error: "assignment_not_found" });
      return;
    }
    res.json(view);
  });

  return router;
}
