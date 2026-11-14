// One student turn, after the scribe has labeled the message and before anything is saved.
//
// The order is fixed: policy, then the tutor, then the guard. The policy picks the level. The tutor drafts at that level. The guard checks the draft and retries.
// This file does not import the database. The message route loads the session and writes the result. A query here would hide a read of the answer key inside the turn.
// The answer key and the canary are arguments of the guard only. They are not fields of the object passed to the tutor. Spreading `state` into that object would put the solution in the prompt.

import { checkDeterministic, FALLBACK_REPLY, guardDraft, type GuardedReply } from "./guard.ts";
import type { TextGenerator } from "./llm.ts";
import { nextHintLevel } from "./policy.ts";
import { draftHint, type DraftHintInput, type TutorRunner, type TutorTurn } from "./tutor.ts";
import type { HintLevel, ScribeLabel, TurnResult } from "./types.ts";

/**
 * What the message route has already loaded.
 * `level` is the session's `current_level`. `hintCeiling` is the assignment's `hint_ceiling`. `turns[].text` is a message's `content`.
 * `answerKey` and `canary` are loaded for the guard. There is no `display_name`. The model sees the work, not who wrote it.
 */
export type TurnState = {
  level: HintLevel;
  hintCeiling: HintLevel;
  /** The assignment prompt the student already sees. */
  prompt: string;
  /** The professor's notes. Level 2 searches these. */
  notes: string;
  turns: TutorTurn[];
  answerKey: string;
  canary: string;
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
 * The reply, the level, the verdict, and the retry count for one student message.
 * `label` is the scribe's decision. This function does not read the message to decide the level, and it does not relabel the turn.
 */
export async function runTurn(
  state: TurnState,
  studentText: string,
  label: ScribeLabel,
  hooks?: TurnHooks,
): Promise<TurnResult> {
  const level = nextHintLevel({
    level: state.level,
    hintCeiling: state.hintCeiling,
    label,
  });
  const draft = await draftHint(hintInput(state, studentText, level), hooks?.run);
  const guarded = await guardDraft({
    draft,
    level,
    answerKey: state.answerKey,
    canary: state.canary,
    generate: hooks?.generate,
    redraft: (nextLevel, feedback) => draftHint(hintInput(state, studentText, nextLevel, feedback), hooks?.run),
  });
  return forStudent(guarded, state);
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
  if (exposesSolution(reply, state.answerKey, state.canary)) {
    reply = FALLBACK_REPLY;
    layer = "fallback";
    leaks = true;
  }
  if (exposesSolution(reason, state.answerKey, state.canary)) {
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
function exposesSolution(text: string, answerKey: string, canary: string): boolean {
  return checkDeterministic(text, answerKey, canary).leaks;
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
  if (feedback && feedback.trim().length > 0) input.feedback = feedback;
  return input;
}
