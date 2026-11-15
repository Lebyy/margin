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
import { Assignment, Message, ScribeEvent, Session, Student } from "./models.ts";
import { questionPrompts, secondsPerQuestion, type QuestionTime } from "./questions.ts";
import type { GuardLayer, GuardSeverity, StruggleType } from "./types.ts";

/** One student's three lines: the concept, the kind of struggle, and the last hint level. */
export type StudentSummary = {
  student_id: string;
  display_name: string;
  /** The concept this student struggled with on the most turns, or their most recent concept if they never struggled. Null before any labelled turn. */
  concept: string | null;
  /** The most common struggle on that concept. `none` when the student has not struggled. */
  struggle_type: StruggleType;
  /** The level of the tutor's most recent reply to this student. Null if the tutor has not answered yet. */
  last_hint_level: number | null;
  turns: number;
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
 * Only people who started a session appear, because that is the only way a
 * student document is created. A student with a session and no turns still
 * appears, with no concept, so the list matches the sessions in the database.
 */
export async function roster(assignmentId: string): Promise<Roster | null> {
  if (!mongoose.isValidObjectId(assignmentId)) return null;
  if (!(await Assignment.exists({ _id: assignmentId }))) return null;

  const sessions = await Session.find({ assignment_id: assignmentId }).sort({ created_at: 1, _id: 1 }).lean();
  const order: string[] = [];
  for (const s of sessions) {
    const id = String(s.student_id);
    if (!order.includes(id)) order.push(id);
  }
  const students = await Student.find({ _id: { $in: order } }).select("display_name").lean();
  const names = new Map(students.map((s) => [String(s._id), s.display_name]));

  const events = await ScribeEvent.find({ assignment_id: assignmentId }).sort({ created_at: 1, _id: 1 }).lean();
  const tutorMessages = await Message.find({ session_id: { $in: sessions.map((s) => s._id) }, role: "tutor" })
    .sort({ created_at: 1, _id: 1 })
    .select("session_id hint_level retries guard_verdict")
    .lean();
  const studentOfSession = new Map(sessions.map((s) => [String(s._id), String(s.student_id)]));
  const assignment = await Assignment.findById(assignmentId).select("prompt questions").lean();
  const count = questionPrompts(assignment!).length;
  const time = classTime(sessions as { student_id: unknown; question_times?: QuestionTime[] | null; completed_at?: Date | null; created_at?: unknown }[], count);

  const lastLevel = new Map<string, number>();
  let draftsHeld = 0;
  for (const m of tutorMessages) {
    const student = studentOfSession.get(String(m.session_id));
    if (student && m.hint_level != null) lastLevel.set(student, m.hint_level);
    // A retry means a draft was refused and rewritten. A fallback layer means every draft was refused.
    if ((m.retries ?? 0) > 0 || m.guard_verdict?.layer === "fallback") draftsHeld += 1;
  }

  return {
    assignment_id: assignmentId,
    students: order.map((id) => {
      const mine = events.filter((e) => String(e.student_id) === id);
      const top = topStruggle(mine);
      return {
        student_id: id,
        display_name: names.get(id) ?? "",
        concept: top.concept,
        struggle_type: top.struggle_type,
        last_hint_level: lastLevel.get(id) ?? null,
        turns: mine.length,
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
};

/** One question of the assignment, as this student's work view heads it. */
export type TranscriptQuestion = {
  index: number;
  prompt: string;
  /** Seconds from opening the question to pressing Next, from this student's most recent session that finished it. Null if they never did. */
  seconds: number | null;
};

export type Transcript = {
  student_id: string;
  display_name: string;
  questions: TranscriptQuestion[];
  turns: TranscriptTurn[];
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

  const sessions = await Session.find({ student_id: studentId, assignment_id: assignmentId }).sort({ created_at: 1, _id: 1 }).select("_id question_times").lean();
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
      };
    }),
  };
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
