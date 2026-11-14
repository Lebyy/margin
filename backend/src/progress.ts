// A student's own progress: their sessions, the scribe's label on each of
// their turns, and the hint level the tutor answered at.
//
// This is the student's formative log (L-F7), not a grade. It is built only
// from rows whose student_id is the one asked for, so it cannot contain another
// student's quote, name, or numbers. It has no score, rank, or class average:
// a comparison to classmates would turn the log into the surveillance the
// privacy rule says students avoid. There is no auth this weekend, so the id in
// the URL is the only filter; every query below is scoped by it.

import mongoose from "mongoose";
import { Assignment, Message, ScribeEvent, Session, Student } from "./models.ts";
import type { StruggleType } from "./types.ts";

/** One labelled turn, as the student sees it. */
export type ProgressLabel = {
  assignment_id: string;
  session_id: string;
  concept: string;
  struggle_type: StruggleType;
  attempt_made: boolean;
  demonstrated_understanding: boolean;
  /** The student's own words, already scrubbed of key lines by the scribe. */
  evidence: string;
  /** The level the tutor answered this turn at, or null if the tutor did not answer (a 503). */
  hint_level: number | null;
  created_at: string;
};

export type StudentProgress = {
  student_id: string;
  sessions: {
    session_id: string;
    assignment_id: string;
    assignment_title: string;
    current_level: number;
    created_at: string;
  }[];
  /** Oldest first, so the page reads as a timeline. */
  labels: ProgressLabel[];
};

/**
 * Builds one student's progress, or null for an unknown or malformed id.
 *
 * Every query filters on this student's id or on sessions that belong to it.
 * Widening any of them (for example reading scribe_events by assignment)
 * would put classmates' quotes in this student's response, which the D-B7
 * test exists to catch. `jailbreak_attempt` is left out on purpose: the log is
 * for learning, and showing a student an integrity flag is not that.
 */
export async function studentProgress(studentId: string): Promise<StudentProgress | null> {
  if (!mongoose.isValidObjectId(studentId)) return null;
  if (!(await Student.exists({ _id: studentId }))) return null;

  const sessions = await Session.find({ student_id: studentId }).sort({ created_at: 1, _id: 1 }).lean();
  const sessionIds = sessions.map((s) => s._id);

  // Titles only. The key is select: false on the model and is not asked for.
  const assignments = await Assignment.find({ _id: { $in: sessions.map((s) => s.assignment_id) } })
    .select("title")
    .lean();
  const titles = new Map(assignments.map((a) => [String(a._id), a.title]));

  const events = await ScribeEvent.find({ student_id: studentId }).sort({ created_at: 1, _id: 1 }).lean();

  // The tutor's level for a turn is on the tutor message that followed that
  // student message in the same session. Messages are read only from this
  // student's sessions, then walked in order to pair each student message
  // with the next tutor reply.
  const messages = await Message.find({ session_id: { $in: sessionIds } })
    .sort({ session_id: 1, created_at: 1, _id: 1 })
    .select("session_id role hint_level")
    .lean();
  const levelFor = new Map<string, number | null>();
  const sessionOf = new Map<string, string>();
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.role !== "student") continue;
    const next = messages[i + 1];
    const answered = next && next.role === "tutor" && String(next.session_id) === String(m.session_id);
    levelFor.set(String(m._id), answered ? (next.hint_level ?? null) : null);
    sessionOf.set(String(m._id), String(m.session_id));
  }

  return {
    student_id: studentId,
    sessions: sessions.map((s) => ({
      session_id: String(s._id),
      assignment_id: String(s.assignment_id),
      assignment_title: titles.get(String(s.assignment_id)) ?? "",
      current_level: s.current_level,
      created_at: new Date(s.created_at as Date).toISOString(),
    })),
    labels: events.map((e) => ({
      assignment_id: String(e.assignment_id),
      session_id: sessionOf.get(String(e.message_id)) ?? "",
      concept: e.concept,
      struggle_type: e.struggle_type as StruggleType,
      attempt_made: e.attempt_made,
      demonstrated_understanding: e.demonstrated_understanding,
      evidence: e.evidence ?? "",
      hint_level: levelFor.get(String(e.message_id)) ?? null,
      created_at: new Date(e.created_at as Date).toISOString(),
    })),
  };
}
