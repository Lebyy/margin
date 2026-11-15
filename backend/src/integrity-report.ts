// The integrity review for one assignment, read from stored records: the
// professor's dashboard tab (GET /api/prof/integrity) and the analyst's
// integrity tool both call this, so the two can never disagree. The rules
// themselves are in integrity.ts; this file only gathers what they read.

import mongoose from "mongoose";
import { classTimes, reviewWork, type Finding, type IntegrityLevel, type QuestionActivity, type TypingRecord } from "./integrity.ts";
import { Assignment, Message, Session, Student } from "./models.ts";
import { questionCount, secondsPerQuestion, type QuestionTime } from "./questions.ts";

export type IntegrityRow = {
  session_id: string;
  student_id: string;
  display_name: string;
  completed: boolean;
  exempt: boolean;
  level: IntegrityLevel;
  findings: Finding[];
  /** Seconds per question from the server's clock; null while a question is open or was never reached. */
  seconds: (number | null)[];
  activity: QuestionActivity[];
  messages: number;
  /** How many of their messages the page described. Zero means nothing can be said about typing, which is not the same as clear. */
  described: number;
};

export type IntegrityReport = { question_count: number; class_median_seconds: (number | null)[]; class_finished: number[]; students: IntegrityRow[] };

/** Every session's review, evidence first, then worth a look, then clear. Null for an unknown assignment. No model is called and nothing is written. */
export async function integrityReport(assignmentId: string): Promise<IntegrityReport | null> {
  const assignment = mongoose.isValidObjectId(assignmentId) ? await Assignment.findById(assignmentId).select("prompt questions").lean() : null;
  if (!assignment) return null;
  const count = questionCount(assignment);
  const sessions = await Session.find({ assignment_id: assignmentId }).sort({ created_at: -1, _id: -1 }).lean();
  const students = await Student.find({ _id: { $in: sessions.map((s) => s.student_id) } }).select("display_name").lean();
  const names = new Map(students.map((s) => [String(s._id), s.display_name]));
  const perSession = sessions.map((s) => secondsPerQuestion((s.question_times ?? []) as QuestionTime[], count));
  const times = classTimes(perSession, count);
  const messages = await Message.find({ session_id: { $in: sessions.map((s) => s._id) }, role: "student" }).select("session_id question_index content typing").lean();
  const bySession = new Map<string, typeof messages>();
  for (const m of messages) {
    const k = String(m.session_id);
    const list = bySession.get(k);
    if (list) list.push(m);
    else bySession.set(k, [m]);
  }
  const rows: IntegrityRow[] = sessions.map((s, i) => {
    const mine = bySession.get(String(s._id)) ?? [];
    const activity = (s.activity ?? []) as QuestionActivity[];
    const review = reviewWork({
      sessionId: String(s._id),
      questionCount: count,
      messages: mine.map((m) => ({ question_index: m.question_index ?? null, content: m.content, typing: (m.typing as TypingRecord | null) ?? null })),
      secondsPerQuestion: perSession[i],
      activity,
      classMedianMs: times.medianMs,
      classFinished: times.finished,
      exempt: !!s.integrity_exempt,
    });
    return {
      session_id: String(s._id),
      student_id: String(s.student_id),
      display_name: names.get(String(s.student_id)) ?? "",
      completed: s.completed_at != null,
      exempt: !!s.integrity_exempt,
      level: review.level,
      findings: review.findings,
      seconds: perSession[i],
      activity,
      messages: mine.length,
      described: mine.filter((m) => m.typing).length,
    };
  });
  const rank = { evidence: 0, worth_a_look: 1, clear: 2 } as const;
  rows.sort((a, b) => rank[a.level] - rank[b.level]);
  return { question_count: count, class_median_seconds: times.medianMs.map((m) => (m == null ? null : Math.round(m / 1000))), class_finished: times.finished, students: rows };
}
