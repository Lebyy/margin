// Multi-question assignments: which prompt and which key a turn works on,
// and how the per-question clock is read back for the professor.
//
// Question 1 is the assignment's own `prompt` and `answer_key`; questions 2
// and on are `questions[i-1]` and `question_keys[i-1]`. Keeping question 1 in
// the original fields is what lets every assignment saved before this file
// existed run unchanged as a one-question assignment.

import { checkDeterministic } from "./guard.ts";
import type { AssignmentKind } from "./types.ts";

/** The fields of an assignment row this file reads. The key fields are present only when the caller selected them. */
type AssignmentLike = {
  prompt: string;
  answer_key?: string | null;
  questions?: { prompt: string }[] | null;
  question_keys?: string[] | null;
};

/** How many questions an assignment has. Always at least 1. */
export function questionCount(assignment: Pick<AssignmentLike, "questions">): number {
  return 1 + (assignment.questions?.length ?? 0);
}

/** Every question's prompt in order. */
export function questionPrompts(assignment: Pick<AssignmentLike, "prompt" | "questions">): string[] {
  return [assignment.prompt, ...(assignment.questions ?? []).map((q) => q.prompt)];
}

/** Every question's key in order, as stored. A topic has none, and each is then "". */
export function questionKeys(assignment: AssignmentLike): string[] {
  const later = assignment.question_keys ?? [];
  return [assignment.answer_key ?? "", ...(assignment.questions ?? []).map((_, i) => later[i] ?? "")];
}

/**
 * The prompt and key for the question a session is on, plus every other key.
 *
 * `answerKey` is this question's key alone, and that is what runTurn's guard
 * gets, so the guard's checks are exactly as strong as on a one-question
 * assignment. (Joining all keys into one string would weaken them: the prose
 * check treats a key under eight words as a whole final answer, and "4" and
 * "9" joined would only match "4 9".) `otherKeys` are checked one at a time by
 * `leaksAnotherQuestion` after the turn, so a student on question 2 cannot
 * pull question 1's solution out of the tutor either. An index past the end
 * (an assignment edited to have fewer questions) clamps to the last question.
 */
export function questionAt(assignment: AssignmentLike, index: number): { index: number; prompt: string; answerKey: string; otherKeys: string[] } {
  const prompts = questionPrompts(assignment);
  const keys = questionKeys(assignment);
  const i = Math.min(Math.max(0, Math.trunc(index)), prompts.length - 1);
  return { index: i, prompt: prompts[i], answerKey: keys[i], otherKeys: keys.filter((k, j) => j !== i && k.trim().length > 0) };
}

/**
 * True when a reply the guard released for this question contains another
 * question's solution, by the same deterministic check the guard runs first.
 * The caller then shows the fallback sentence instead, the same fail-closed
 * answer a held draft gets.
 */
export function leaksAnotherQuestion(reply: string, otherKeys: string[], canary: string, kind: AssignmentKind): boolean {
  return otherKeys.some((key) => checkDeterministic(reply, key, canary, kind).leaks);
}

/** One stored clock entry, as it sits on a session. */
export type QuestionTime = { index: number; started_at: Date; finished_at: Date | null };

/**
 * Seconds spent on each question, for the professor.
 *
 * A question is timed from when it opened to when the student pressed Next or
 * Finish. A question still open has `seconds: null`, never a running total,
 * so the number on the dashboard is always one the student finished. A
 * question the student never reached has no entry and is also null.
 */
export function secondsPerQuestion(times: QuestionTime[], count: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: count }, () => null);
  for (const t of times) {
    if (t.index < 0 || t.index >= count || !t.finished_at) continue;
    out[t.index] = Math.max(0, Math.round((new Date(t.finished_at).getTime() - new Date(t.started_at).getTime()) / 1000));
  }
  return out;
}
