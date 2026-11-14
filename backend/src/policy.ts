// The hint level for one student turn.
//
// tutor.ts receives the number this file returns. It does not choose a level,
// and this file does not call a model. A model that picked the level could be
// talked into level 3 by "my professor said you can", which is the jailbreak
// the ladder exists to refuse.
//
// The scribe has already decided attempt_made and jailbreak_attempt. This
// function does not read the message. A phrase list here would miss a
// paraphrase, and a second model call would make the ladder a suggestion.

import type { HintLevel, ScribeLabel } from "./types.ts";

/**
 * The rung a new session stores before any hint.
 * Sessions default to this same number. A second constant in the session
 * schema would let a new student start at 2 and skip the question.
 */
export const START_LEVEL = 1 satisfies HintLevel;

/** What the policy needs. The rest of the scribe label does not move the ladder. */
export type PolicyInput = {
  /** The level stored on the session. A new session passes START_LEVEL. */
  level: HintLevel;
  /** The professor's cap on this assignment. The result is never above it. */
  hintCeiling: HintLevel;
  /**
   * The scribe label for this message.
   * jailbreak_attempt covers begging, claimed permission, and "ignore the rules".
   * Those stay on the current rung even when the same message also contains a try.
   */
  label: Pick<ScribeLabel, "attempt_made" | "jailbreak_attempt" | "demonstrated_understanding">;
};

/**
 * The level for this turn.
 * Climb by one only when the student is still stuck, the scribe saw an attempt,
 * the message is not a jailbreak, and the next rung is still inside the ceiling.
 * Anything else returns the current rung. Returning level + 2 would skip the
 * notes and hand over the worked example on a single try.
 */
export function nextHintLevel(input: PolicyInput): HintLevel {
  const level = clampLevel(input.level, START_LEVEL);
  const ceiling = clampLevel(input.hintCeiling, START_LEVEL);
  const current = level > ceiling ? ceiling : level;

  const stuck = input.label.demonstrated_understanding !== true;
  const attempted = input.label.attempt_made === true;
  const jailbreak = input.label.jailbreak_attempt === true;
  if (!stuck || !attempted || jailbreak) return current;

  const next = current + 1;
  if (next > ceiling || next > 3) return current;
  return next as HintLevel;
}

/**
 * A level that is not 1, 2, or 3 becomes `fallback`.
 * The schema already rejects those, but a route that passes a raw number must
 * not be able to climb to 4. Level 4 would be the solution, and this scale does not have one.
 * An unreadable ceiling falls back to 1, the strictest cap, rather than to 3.
 */
function clampLevel(value: number, fallback: HintLevel): HintLevel {
  if (value === 1 || value === 2 || value === 3) return value;
  return fallback;
}
