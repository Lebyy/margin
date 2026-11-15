// The professor's two per-student views: the three-line summary (the mini log)
// and one student's transcript (the detailed log).
//
// Both are read from our own database. Nothing here calls a model, so opening a
// student does not send anyone's work anywhere a second time. Every count is
// made in code from stored rows, the same rule the Thursday card follows.
//
// The order is the order students started, never a ranking. The privacy rule
// says a dashboard that sorts students by struggle becomes a leaderboard, and
// students who feel ranked stop using the tool or perform for it.

import mongoose from "mongoose";
import { Assignment, Enrollment, Message, ScribeEvent, Session, Student } from "./models.ts";
import { questionPrompts, secondsPerQuestion, type QuestionTime } from "./questions.ts";
import type { GuardLayer, GuardSeverity, StruggleType } from "./types.ts";

/**
 * Where a student is on this assignment. `not_started` is a student enrolled in
 * the class who has no session on it; `finished` pressed Submit on the last
 * question in some session; anything between is `in_progress`.
 */
export type StudentStatus = "not_started" | "in_progress" | "finished";

/** One student's three lines: the concept, the kind of struggle, and the last hint level. */
export type StudentSummary = {
  student_id: string;
  display_name: string;
  status: StudentStatus;
  /** The concept this student struggled with on the most turns, or their most recent concept if they never struggled. Null before any labelled turn. */
  concept: string | null;
  /** The most common struggle on that concept. `none` when the student has not struggled. */
  struggle_type: StruggleType;
  /** The level of the tutor's most recent reply to this student. Null if the tutor has not answered yet. */
  last_hint_level: number | null;
  turns: number;
  /** The highest level any reply to this student reached on this assignment. The last level resets to 1 on each new question, so "did they ever climb" needs this. Null before any reply. */
  max_hint_level: number | null;
  /** Questions this student finished (pressed Next or Finish on), across their sessions. */
  questions_done: number;
  /** Mean seconds over those finished questions, from the server's clock. Null before the first one. */
  average_seconds: number | null;
};

export type Roster = {
  assignment_id: string;
  students: StudentSummary[];
  /**
   * What the guard did for this class, counted from stored rows.
   * `answer_requests` is turns the scribe labelled as trying to get the solution.
   * `drafts_held` is tutor replies where the guard refused at least one draft.
   * Neither is per student: an integrity count beside a name is the surveillance this dashboard is not.
   */
  guard: { answer_requests: number; drafts_held: number; replies: number };
  /**
   * Time for the class as a whole, from the same per-question clock.
   * `average_total_seconds` is the mean time to finish over students who finished (each student's latest finished session), so a student still working never pulls it down with a partial total.
   * `average_seconds_per_question` is the mean over every finished question by anyone. Both are null until something has finished.
   */
  timing: { finished_students: number; average_total_seconds: number | null; average_seconds_per_question: number | null };
};

/**
 * The students who have a session on this assignment, or null if the assignment does not exist.
 *
 * Students who started a session come first, in the order they started. After
 * them come the class's enrolled students who have not opened this assignment,
 * in the order they joined, marked `not_started` with no concept and no time:
 * a professor needs to see who has not begun, and the dashboard's status
 * filter would otherwise have nothing to show under "not started". A student
 * with a session and no turns still appears, with no concept.
 */
export async function roster(assignmentId: string): Promise<Roster | null> {
  if (!mongoose.isValidObjectId(assignmentId)) return null;

  // The database is a network hop away (about 60-100 ms each), so the reads go in three rounds of parallel
  // queries instead of eight in a row: first everything keyed by the assignment, then what needs its sessions or
  // class, then the names. Only the fields used below are fetched; a class of 200 has thousands of rows here.
  const [assignment, sessions, events] = await Promise.all([
    Assignment.findById(assignmentId).select("course_id prompt questions").lean(),
    Session.find({ assignment_id: assignmentId }).sort({ created_at: 1, _id: 1 }).select("student_id completed_at question_times created_at").lean(),
    ScribeEvent.find({ assignment_id: assignmentId }).sort({ created_at: 1, _id: 1 }).select("student_id concept struggle_type jailbreak_attempt").lean(),
  ]);
  if (!assignment) return null;

  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  };
  for (const s of sessions) add(String(s.student_id));
  const started = new Set(order);
  const finished = new Set(sessions.filter((s) => s.completed_at).map((s) => String(s.student_id)));

  const [enrolled, tutorMessages] = await Promise.all([
    assignment.course_id ? Enrollment.find({ course_id: assignment.course_id }).sort({ created_at: 1, _id: 1 }).select("student_id").lean() : Promise.resolve([]),
    Message.find({ session_id: { $in: sessions.map((s) => s._id) }, role: "tutor" })
      .sort({ created_at: 1, _id: 1 })
      .select("session_id hint_level retries guard_verdict.layer")
      .lean(),
  ]);
  for (const e of enrolled) add(String(e.student_id));

  const students = await Student.find({ _id: { $in: order } }).select("display_name").lean();
  const names = new Map(students.map((s) => [String(s._id), s.display_name]));
  // An enrollment whose student row is gone has no one to show; a started student always stays, as before.
  for (let i = order.length - 1; i >= 0; i -= 1) if (!started.has(order[i]) && !names.has(order[i])) order.splice(i, 1);

  // Each student's labels, grouped in one pass. Filtering the whole list once per student was
  // students x labels comparisons: about a quarter of a second for 166 students and 3,493 labels.
  const eventsOf = new Map<string, typeof events>();
  for (const e of events) {
    const id = String(e.student_id);
    const list = eventsOf.get(id);
    if (list) list.push(e);
    else eventsOf.set(id, [e]);
  }

  const studentOfSession = new Map(sessions.map((s) => [String(s._id), String(s.student_id)]));
  const count = questionPrompts(assignment).length;
  const time = classTime(sessions as { student_id: unknown; question_times?: QuestionTime[] | null; completed_at?: Date | null; created_at?: unknown }[], count);

  const lastLevel = new Map<string, number>();
  const maxLevel = new Map<string, number>();
  let draftsHeld = 0;
  for (const m of tutorMessages) {
    const student = studentOfSession.get(String(m.session_id));
    if (student && m.hint_level != null) {
      lastLevel.set(student, m.hint_level);
      maxLevel.set(student, Math.max(maxLevel.get(student) ?? 0, m.hint_level));
    }
    // A retry means a draft was refused and rewritten. A fallback layer means every draft was refused.
    if ((m.retries ?? 0) > 0 || m.guard_verdict?.layer === "fallback") draftsHeld += 1;
  }

  return {
    assignment_id: assignmentId,
    students: order.map((id) => {
      const mine = eventsOf.get(id) ?? [];
      const top = topStruggle(mine);
      return {
        student_id: id,
        display_name: names.get(id) ?? "",
        status: (finished.has(id) ? "finished" : started.has(id) ? "in_progress" : "not_started") as StudentStatus,
        concept: top.concept,
        struggle_type: top.struggle_type,
        last_hint_level: lastLevel.get(id) ?? null,
        turns: mine.length,
        max_hint_level: maxLevel.get(id) ?? null,
        questions_done: time.perStudent.get(id)?.done ?? 0,
        average_seconds: time.perStudent.get(id)?.average ?? null,
      };
    }),
    guard: {
      answer_requests: events.filter((e) => e.jailbreak_attempt).length,
      drafts_held: draftsHeld,
      replies: tutorMessages.length,
    },
    timing: time.classwide,
  };
}

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, n) => a + n, 0) / xs.length) : null);

/**
 * The roster's time numbers, computed in code from each session's clock.
 *
 * A student's average covers every question they finished in any of their
 * sessions, so a student who restarted is not reset to nothing. The class
 * time to finish uses each student's most recent finished session, and only
 * students who finished count: averaging in a half-done total would make the
 * assignment look shorter than it is.
 */
function classTime(
  sessions: { student_id: unknown; question_times?: QuestionTime[] | null; completed_at?: Date | null; created_at?: unknown }[],
  count: number,
): {
  perStudent: Map<string, { done: number; average: number | null }>;
  classwide: Roster["timing"];
} {
  const perStudent = new Map<string, { done: number; average: number | null }>();
  const finishedTotals = new Map<string, number>();
  const allSeconds: number[] = [];
  const byStudent = new Map<string, { seconds: number[]; done: Set<number> }>();
  for (const s of sessions) {
    const id = String(s.student_id);
    const seconds = secondsPerQuestion(s.question_times ?? [], count);
    const mine = byStudent.get(id) ?? { seconds: [], done: new Set<number>() };
    seconds.forEach((n, i) => {
      if (n === null) return;
      mine.seconds.push(n);
      mine.done.add(i);
      allSeconds.push(n);
    });
    byStudent.set(id, mine);
    // Sessions arrive oldest first, so a later finished session replaces an earlier one.
    if (s.completed_at && seconds.every((n) => n !== null)) finishedTotals.set(id, seconds.reduce((a: number, n) => a + (n ?? 0), 0));
  }
  for (const [id, m] of byStudent) perStudent.set(id, { done: m.done.size, average: mean(m.seconds) });
  return {
    perStudent,
    classwide: {
      finished_students: finishedTotals.size,
      average_total_seconds: mean([...finishedTotals.values()]),
      average_seconds_per_question: mean(allSeconds),
    },
  };
}

/**
 * The concept a student struggled with on the most turns, and the most common struggle there.
 * A tie goes to the more recent one, because the professor is deciding what to say next, not writing a history.
 * A student who never struggled gets their latest concept with `none`, so the line says what they worked on without inventing a difficulty.
 */
function topStruggle(events: { concept: string; struggle_type: string }[]): {
  concept: string | null;
  struggle_type: StruggleType;
} {
  if (events.length === 0) return { concept: null, struggle_type: "none" };
  const struggling = events.filter((e) => e.struggle_type !== "none");
  if (struggling.length === 0) return { concept: events[events.length - 1].concept, struggle_type: "none" };
  const concept = mostCommon(struggling.map((e) => e.concept));
  const kind = mostCommon(struggling.filter((e) => e.concept === concept).map((e) => e.struggle_type));
  return { concept, struggle_type: kind as StruggleType };
}

/** The value that appears most often. On a tie the later one wins, since `>=` lets a later equal count replace an earlier one. */
function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  let best = values[0];
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n >= (counts.get(best) ?? 0)) best = v;
  }
  return best;
}

/** One line of the transcript. */
export type TranscriptTurn = {
  session_id: string;
  role: "student" | "tutor";
  content: string;
  hint_level: number | null;
  /**
   * The guard's outcome on a tutor reply, without its reason.
   * The reason is the guard's private note and may describe the solution. Severity and layer are enough for a professor to see that a draft was held.
   */
  guard: { leaks: boolean; severity: GuardSeverity; layer: GuardLayer } | null;
  retries: number;
  /** The scribe's label on a student turn. Null on a tutor turn. */
  label: { concept: string; struggle_type: StruggleType; attempt_made: boolean } | null;
  created_at: string;
  /** The question this turn was on, 0-based, or null when it cannot be placed (see `placeTurn`). */
  question_index: number | null;
  /** The tutor's tool calls on this turn (the tool, its arguments, and what it answered), so the professor sees what Askretes searched, drew, marked, or opened. Empty on a student turn. */
  tool_calls: { name: string; args: Record<string, unknown>; result: string }[];
  /** On a student turn: whether the page shared the canvas with the tutor, and whether a picture of it went too. Null when it did not. */
  canvas: { shared: boolean; picture: boolean } | null;
  /** On a student turn: the files attached, by id, name, and kind. The originals are kept and served by the session's attachment route. */
  attachments: { id: string | null; name: string; kind: string }[];
  /** On a student turn: the picture of the canvas Askretes was shown is kept, and served by the message's canvas-picture route. */
  canvas_picture: boolean;
  /** The ids of the pictures on the stored board, served by the message's board-files route. */
  board_files: string[];
  /** The message's id, for the routes above. */
  message_id: string;
  /** The canvas as shapes: on a student turn the board shared with Askretes, on a tutor turn the board after Askretes' marks. Null when none was stored. */
  board: Record<string, unknown>[] | null;
  /** What Askretes' tools did on the canvas or in the slide pane, after the guard released it. */
  actions: Record<string, unknown>[];
};

/** One question of the assignment, as this student's work view heads it. */
export type TranscriptQuestion = {
  index: number;
  prompt: string;
  /** Seconds from opening the question to pressing Next, from this student's most recent session that finished it. Null if they never did. */
  seconds: number | null;
};

/**
 * The two look-back questions written for this student after the last question, and what they answered.
 * `what_if_index` is the 0-based question the second one is about. An answer the student has not written is "".
 */
export type TranscriptReflection = {
  why: string;
  what_if: string;
  what_if_index: number;
  answers: { why: string; what_if: string };
};

export type Transcript = {
  student_id: string;
  display_name: string;
  questions: TranscriptQuestion[];
  turns: TranscriptTurn[];
  /** From the most recent session that reached the reflection; null when the student never finished. */
  reflection: TranscriptReflection | null;
};

/**
 * One student's turns on one assignment, oldest first, or null if either id is unknown.
 *
 * Messages are read only from sessions that belong to both this student and
 * this assignment. Dropping either half of that filter would show a
 * classmate's turns, or this student's work for another course, in the wrong
 * drill-down.
 */
export async function transcript(studentId: string, assignmentId: string): Promise<Transcript | null> {
  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(assignmentId)) return null;
  const student = await Student.findById(studentId).select("display_name").lean();
  if (!student) return null;

  const sessions = await Session.find({ student_id: studentId, assignment_id: assignmentId }).sort({ created_at: 1, _id: 1 }).select("_id question_times reflection").lean();
  const assignment = await Assignment.findById(assignmentId).select("prompt questions").lean();
  const prompts = assignment ? questionPrompts(assignment) : [];
  // Latest session wins per question, so a restart shows the time of the attempt the student finished last.
  const seconds: (number | null)[] = prompts.map(() => null);
  for (const s of sessions) {
    secondsPerQuestion((s.question_times ?? []) as QuestionTime[], prompts.length).forEach((n, i) => {
      if (n !== null) seconds[i] = n;
    });
  }
  const clockOf = new Map(sessions.map((s) => [String(s._id), (s.question_times ?? []) as QuestionTime[]]));
  const messages = await Message.find({ session_id: { $in: sessions.map((s) => s._id) } })
    .sort({ created_at: 1, _id: 1 })
    .lean();
  const events = await ScribeEvent.find({ student_id: studentId, assignment_id: assignmentId })
    .select("message_id concept struggle_type attempt_made")
    .lean();
  const labels = new Map(events.map((e) => [String(e.message_id), e]));

  return {
    student_id: studentId,
    display_name: student.display_name,
    questions: prompts.map((prompt, index) => ({ index, prompt, seconds: seconds[index] })),
    // The professor reads these in the student's work view, after the last question, instead of in a separate list.
    reflection: lookBack(sessions.map((s) => s.reflection)),
    turns: messages.map((m) => {
      const label = labels.get(String(m._id));
      return {
        session_id: String(m.session_id),
        role: m.role,
        content: m.content,
        hint_level: m.hint_level ?? null,
        guard: m.guard_verdict
          ? { leaks: m.guard_verdict.leaks, severity: m.guard_verdict.severity, layer: m.guard_verdict.layer }
          : null,
        retries: m.retries ?? 0,
        label: label
          ? { concept: label.concept, struggle_type: label.struggle_type as StruggleType, attempt_made: label.attempt_made }
          : null,
        created_at: new Date(m.created_at as Date).toISOString(),
        question_index: m.question_index ?? placeTurn(clockOf.get(String(m.session_id)) ?? [], new Date(m.created_at as Date)),
        tool_calls: (m.tool_calls ?? []).map((c) => ({ name: c.name, args: (c.args ?? {}) as Record<string, unknown>, result: c.result ?? "" })),
        canvas: m.canvas ? { shared: !!m.canvas.shared, picture: !!m.canvas.picture } : null,
        attachments: (m.attachments ?? []).map((f) => ({ id: f.id ?? null, name: f.name, kind: f.kind })),
        canvas_picture: !!m.canvas?.picture_key,
        board_files: (m.board_files ?? []).map((f) => f.id),
        message_id: String(m._id),
        board: (m.board as Record<string, unknown>[] | undefined) ?? null,
        actions: (m.actions ?? []) as Record<string, unknown>[],
      };
    }),
  };
}

/** The latest stored reflection among a student's sessions (they are oldest first), in the shape the work view shows. */
function lookBack(reflections: ({ why: string; what_if: string; what_if_index: number; answers?: { why?: string | null; what_if?: string | null } | null } | null | undefined)[]): TranscriptReflection | null {
  const r = [...reflections].reverse().find((x) => x);
  if (!r) return null;
  return { why: r.why, what_if: r.what_if, what_if_index: r.what_if_index, answers: { why: r.answers?.why ?? "", what_if: r.answers?.what_if ?? "" } };
}

/**
 * The question an untagged turn was on, read from its session's clock.
 *
 * Rows written before messages carried `question_index`, and Talk captions,
 * have no tag. The clock entry that had started by the turn's time and was
 * the latest to start is the question the student was looking at, because a
 * question opens only when the previous one is finished. A turn older than
 * every entry (a session from before the clock existed) is null and is shown
 * apart, never guessed into question 1.
 */
function placeTurn(times: QuestionTime[], at: Date): number | null {
  let found: QuestionTime | null = null;
  for (const t of times) {
    if (new Date(t.started_at) <= at && (!found || new Date(t.started_at) >= new Date(found.started_at))) found = t;
  }
  return found ? found.index : null;
}
