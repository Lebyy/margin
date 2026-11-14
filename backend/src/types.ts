// Shared shapes for the tutor, the guard, the scribe, and the coach.
// David imports these names instead of declaring a second set of fields.
// A later rename here is the one edit that keeps the HTTP body, the database, and the drawer in agreement.

/** The professor's ceiling is 1, 2, or 3. A fourth level would be the solution, which this scale does not have. */
export type HintLevel = 1 | 2 | 3;

/**
 * Why the student is stuck, from the scribe.
 * `none` means the turn was not a struggle. Adding a free-text kind would let the heatmap grow a column the dashboard does not know.
 */
export type StruggleType =
  | "misconception"
  | "stuck_starting"
  | "syntax_or_mechanics"
  | "careless_error"
  | "none";

/**
 * One label for one student turn.
 * `concept` is a string because the professor names the concepts on the assignment.
 * The scribe, not this type, has to refuse a concept that is not on that list.
 */
export type ScribeLabel = {
  concept: string;
  struggle_type: StruggleType;
  attempt_made: boolean;
  jailbreak_attempt: boolean;
  demonstrated_understanding: boolean;
  evidence: string;
};

/** Where a guard decision came from. `fallback` is the fixed sentence, after the draft was held. */
export type GuardLayer = "deterministic" | "judge" | "fallback";

export type GuardSeverity = "none" | "partial" | "full";

/**
 * What the guard decided about one draft.
 * `reason` is for the drawer and the retry. It must not quote the answer key.
 * Dropping `layer` would make a fallback look like a model judgment.
 */
export type GuardVerdict = {
  leaks: boolean;
  severity: GuardSeverity;
  reason: string;
  layer: GuardLayer;
};

/**
 * What one student turn returns.
 * The student JSON is these four fields. A later field here has to be added to that response on purpose.
 */
export type TurnResult = {
  reply: string;
  level: HintLevel;
  verdict: GuardVerdict;
  retries: number;
};
