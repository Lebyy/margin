// Shared shapes for the tutor, the guard, the scribe, and the coach.
// David imports these names instead of declaring a second set of fields.
// A later rename here is the one edit that keeps the HTTP body, the database, and the drawer in agreement.

/**
 * What kind of work an assignment asks for.
 * `code` is a program. `written` is prose: a short answer, an explanation, an essay paragraph. `math` is a worked problem with a final answer. `topic` is not graded work at all: it is course material to learn, it has no answer key, and Askretes teaches it instead of holding back.
 * The kind decides how the guard reads the key, which fallback sentence a held turn shows, and what the student's work area looks like. A kind added here has to be handled in all three.
 */
export type AssignmentKind = "code" | "written" | "math" | "topic";

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
/**
 * What the student asked for, beyond a hint. `slides` asks where in the
 * lectures to look, `example` asks for a worked example of a similar
 * problem, and `more_help` is "I'm lost" or "I still don't get it". Asking
 * for the answer is never one of these: that is `jailbreak_attempt`.
 */
export const HELP_REQUESTS = ["none", "more_help", "slides", "example"] as const;
export type HelpRequest = (typeof HELP_REQUESTS)[number];

export type ScribeLabel = {
  concept: string;
  struggle_type: StruggleType;
  attempt_made: boolean;
  jailbreak_attempt: boolean;
  demonstrated_understanding: boolean;
  evidence: string;
  /** Left out by older callers and test stand-ins; read as "none". */
  help_request?: HelpRequest;
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
  /** What the tutor's tools asked the page to do (draw, mark, write on the canvas, open a slide). Only the released draft's actions; a held draft's are dropped with it. */
  actions?: CanvasAction[];
  /** Every tool the released draft called, with its arguments and what it returned, for the professor's transcript. */
  toolCalls?: ToolCallRecord[];
};

/** A place on the student's canvas: one of its elements by id, or a box in 0-to-1 units of the canvas picture the tutor was shown. */
export type CanvasTarget = { element?: string; box?: { x: number; y: number; w: number; h: number } };

/**
 * One thing the tutor asked the student's page to do. The page carries it out; the server never touches the canvas.
 * Every word in an action is checked by the guard together with the reply, before the action is released.
 */
export type CanvasAction =
  | { type: "diagram"; kind: "map" | "steps" | "summary"; title: string; items: { label: string; detail: string }[]; picture?: boolean; picture_id?: string }
  | { type: "mark"; target: CanvasTarget; shape: "circle" | "box" | "underline" | "arrow"; note?: string; tone?: "red" | "green" }
  | { type: "write"; text: string; latex: boolean; target?: CanvasTarget }
  | { type: "show_slide"; lecture: number; slide: number };

/** One tool call, as the professor's transcript shows it. `result` is what the tool told the model, cut short. */
export type ToolCallRecord = { name: string; args: Record<string, unknown>; result: string };

/** What the student's page tells the tutor about the canvas on a turn: a short list of what is on it, and a picture of it when it changed and the message is about it. */
export type CanvasContext = { summary: string; image?: { mimeType: string; base64: string } };
