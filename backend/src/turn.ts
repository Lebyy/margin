// One student turn, after the scribe has labeled the message and before anything is saved.
//
// The order is fixed: policy, then the tutor, then the guard. The policy picks the level. The tutor drafts at that level. The guard checks the draft and retries.
// This file does not import the database. The message route loads the session and writes the result. A query here would hide a read of the answer key inside the turn.
// The answer key and the canary are arguments of the guard only. They are not fields of the object passed to the tutor. Spreading `state` into that object would put the solution in the prompt.

import { checkDeterministic, fallbackFor, guardDraft, type GuardedReply } from "./guard.ts";
import type { TextGenerator } from "./llm.ts";
import { nextHintLevel } from "./policy.ts";
import { draftHint, type DraftHintInput, type TutorRunner, type TutorTurn } from "./tutor.ts";
import type { AssignmentKind, HintLevel, ScribeLabel, TurnResult } from "./types.ts";

/**
 * What the message route has already loaded.
 * `level` is the session's `current_level`. `hintCeiling` is the assignment's `hint_ceiling`. `turns[].text` is a message's `content`.
 * `answerKey` and `canary` are loaded for the guard. There is no `display_name`. The model sees the work, not who wrote it.
 */
export type TurnState = {
  level: HintLevel;
  /** Real attempts on the current question, this message included. Set by the message route, which turns on the request rule in policy.ts. */
  attempts?: number;
  hintCeiling: HintLevel;
  /** The assignment prompt the student already sees. */
  prompt: string;
  /** The professor's notes. Level 2 searches these. */
  notes: string;
  turns: TutorTurn[];
  answerKey: string;
  canary: string;
  /** The kind of assignment. Left out, it is code. */
  kind?: AssignmentKind;
  /** The student's own saved notes for this assignment, if any. */
  ownNotes?: string;
};

/**
 * Test doubles for the tutor and the judge. Production leaves this unset, and those two call their models.
 * The message route does not pass this. A double that returned the key would still have to get past the guard before the student saw it.
 */
export type TurnHooks = {
  run?: TutorRunner;
  generate?: TextGenerator;
};

/**
 * A hint started before the scribe has answered.
 * `level` is the rung it was drafted at. `draft` never rejects: a failed early draft resolves to null and the turn drafts again in the normal order.
 */
export type EarlyDraft = { level: HintLevel; draft: Promise<string | null> };

/**
 * Starts the tutor on the session's current rung while the scribe is still labelling the message.
 *
 * The scribe and the tutor each take a few seconds, and the student waits on both. Most turns do not climb: no new try, a request for the answer, or the ceiling. For those the policy returns the rung the session is already on, so a draft at that rung is the draft the turn needs, and starting it early removes the scribe's time from the wait.
 *
 * This does not let anything choose the level but the policy. The early draft is used only when the policy, run afterward on the real label, returns the same rung. When the policy climbs, the early draft is thrown away unread and the tutor is asked again at the new rung. A thrown-away draft never reaches the guard or the student. The cost is one extra tutor call on a turn that climbs.
 */
export function startDraft(state: TurnState, studentText: string, hooks?: TurnHooks): EarlyDraft {
  const level = nextHintLevel({
    level: state.level,
    hintCeiling: state.hintCeiling,
    // The label that never climbs. Under the attempt ladder that is the current rung; under the request rule it is the nudge, which is most turns.
    label: { attempt_made: false, jailbreak_attempt: false, demonstrated_understanding: false, help_request: "none" },
    attempts: state.attempts,
  });
  const draft = draftHint(hintInput(state, studentText, level), hooks?.run).catch(() => null);
  return { level, draft };
}

/**
 * The reply, the level, the verdict, and the retry count for one student message.
 * `label` is the scribe's decision. This function does not read the message to decide the level, and it does not relabel the turn.
 */
export async function runTurn(
  state: TurnState,
  studentText: string,
  label: ScribeLabel,
  hooks?: TurnHooks,
  early?: EarlyDraft,
): Promise<TurnResult> {
  if (state.kind === "topic") return runLesson(state, studentText, hooks, early);
  const level = nextHintLevel({
    level: state.level,
    hintCeiling: state.hintCeiling,
    label,
    attempts: state.attempts,
  });
  // The early draft counts only if the policy landed on the rung it was written at.
  const reused = early && early.level === level ? await early.draft : null;
  const draft = reused ?? (await draftHint(hintInput(state, studentText, level), hooks?.run));
  const guarded = await guardDraft({
    draft,
    level,
    answerKey: state.answerKey,
    canary: state.canary,
    kind: state.kind,
    prompt: state.prompt,
    generate: hooks?.generate,
    redraft: (nextLevel, feedback) => draftHint(hintInput(state, studentText, nextLevel, feedback), hooks?.run),
  });
  return forStudent(guarded, state);
}

/** What the "Try a smaller problem" control sends as the student's side of the turn. It is fixed text, so the control cannot be used to slip a different request to the level-3 prompt. */
export const SMALLER_PROBLEM_ASK = "Can we try a smaller problem first? Walk me through a different, smaller one.";

/**
 * The "Try a smaller problem" control (L-R6): a level-3 worked example of a different problem, on request.
 *
 * This is the one place a student reaches the level-3 hint without the ladder, and it is narrow on purpose. It is a control, not a message, so there is no text to talk the tutor round with. It asks for a different problem, which on the demo is count_list and never sum_list. It does not move the session's level: the ladder is still climbed only by real attempts, and the next ordinary message is answered at the level the session was on.
 * The professor's ceiling still holds. An assignment capped below 3 has no smaller-problem card, and the caller refuses before this is reached.
 * The guard runs on the example exactly as on any draft. If it holds the example, the reply drops a level like any held draft, and the page shows it as an ordinary hint instead of a card.
 */
export async function runSmallerProblem(state: TurnState, hooks?: TurnHooks): Promise<TurnResult> {
  const draft = await draftHint(hintInput(state, SMALLER_PROBLEM_ASK, 3), hooks?.run);
  const guarded = await guardDraft({
    draft,
    level: 3,
    answerKey: state.answerKey,
    canary: state.canary,
    kind: state.kind,
    prompt: state.prompt,
    generate: hooks?.generate,
    redraft: (nextLevel, feedback) => draftHint(hintInput(state, SMALLER_PROBLEM_ASK, nextLevel, feedback), hooks?.run),
  });
  return forStudent(guarded, state);
}

/**
 * One turn on a learning topic.
 *
 * A topic has no answer key, so the ladder and the judge have nothing to do here: there is no level to choose and no solution a reply could give away. The level is returned as it was and never moves. The canary check still runs, because that marker must not reach a student on any route, and a reply that carried it is replaced with the general fallback sentence.
 * The early draft is always usable, since a lesson is the same whatever the scribe's label says.
 */
async function runLesson(state: TurnState, studentText: string, hooks?: TurnHooks, early?: EarlyDraft): Promise<TurnResult> {
  const level = nextHintLevel({ level: state.level, hintCeiling: state.hintCeiling, label: { attempt_made: false, jailbreak_attempt: false, demonstrated_understanding: false } });
  const draft = (early ? await early.draft : null) ?? (await draftHint(hintInput(state, studentText, level), hooks?.run));
  const verdict = checkDeterministic(draft, "", state.canary, "topic");
  if (verdict.leaks) {
    return { reply: fallbackFor("topic"), level, verdict: { ...verdict, reason: "The draft was held.", layer: "fallback" }, retries: 0 };
  }
  return { reply: draft, level, verdict: { ...verdict, reason: "A lesson on course material. There is no answer key to check against." }, retries: 0 };
}

/**
 * The strings the student can read: the reply and the verdict reason.
 * The guard is supposed to hold a solution before this point. This is the last look, because the message route renders both strings.
 * A normalized line still teaches the solution, so a draft the word check would hold is not allowed out under different names either.
 * Nothing here is logged. A log of either string would be a copy of the key when this check is the thing that stopped it.
 */
function forStudent(guarded: GuardedReply, state: TurnState): TurnResult {
  let reply = guarded.reply;
  let reason = guarded.verdict.reason;
  let layer = guarded.verdict.layer;
  let leaks = guarded.verdict.leaks;
  if (exposesSolution(reply, state.answerKey, state.canary, state.kind)) {
    reply = fallbackFor(state.kind, state.prompt);
    layer = "fallback";
    leaks = true;
  }
  if (exposesSolution(reason, state.answerKey, state.canary, state.kind)) {
    reason = "The draft was held.";
  }
  return {
    reply,
    level: guarded.level,
    verdict: { ...guarded.verdict, reason, layer, leaks },
    retries: guarded.retries,
  };
}

/**
 * The same check the guard uses on a draft.
 * The reason is student-facing too, so a line that would hold a draft holds the reason as well.
 */
function exposesSolution(text: string, answerKey: string, canary: string, kind?: AssignmentKind): boolean {
  return checkDeterministic(text, answerKey, canary, kind).leaks;
}

/**
 * The tutor's input, built field by field.
 * `answerKey` and `canary` are not copied. A spread of `state` would add them, and draftHint would throw, but the field would have been one edit away from the prompt.
 */
function hintInput(state: TurnState, studentText: string, level: HintLevel, feedback?: string): DraftHintInput {
  const input: DraftHintInput = {
    level,
    prompt: state.prompt,
    notes: state.notes,
    turns: state.turns,
    studentText,
  };
  if (state.kind) input.kind = state.kind;
  if (state.ownNotes) input.ownNotes = state.ownNotes;
  if (feedback && feedback.trim().length > 0) input.feedback = feedback;
  return input;
}
