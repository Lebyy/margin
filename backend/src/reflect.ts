// The two questions a student is asked after finishing the last question of
// an assignment: one "why did you do it this way", and one "what if" about one
// of the problems.
//
// Why this shape:
//   - The model writes the wording, because a good "why" names something the
//     student actually did. It reads the question prompts and the student's
//     own messages from this session. It never gets the answer key, the
//     canary, or the student's name (completeJson strips emails, phones and
//     long ids from the text, and no name field exists in the prompt).
//   - Both questions go through the guard's deterministic check against every
//     question's key. A reflection question that quotes a solution would hand
//     a classmate the answer if it were shown or shared, so a hit is replaced,
//     not edited.
//   - Finishing must never fail on the model. Bad JSON, a provider error, or a
//     hit all fall back to fixed questions, and the session is still complete.

import { z } from "zod";
import { checkDeterministic } from "./guard.ts";
import { completeJson, type TextGenerator } from "./llm.ts";
import type { AssignmentKind } from "./types.ts";

export type Reflection = { why: string; what_if: string; what_if_index: number };

export type ReflectInput = {
  /** Every question's prompt in order. */
  prompts: string[];
  /** The student's own messages from this session, oldest first. Never the tutor's replies, which the guard already shaped. */
  studentTurns: string[];
  /** Every question's key, for the leak check only. Never sent to the model. */
  keys: string[];
  canary: string;
  kind: AssignmentKind;
  generate?: TextGenerator;
};

/** The longest stretch of the student's own words the model reads. Enough for a whole assignment's attempts, without a runaway prompt. */
const MAX_TURN_CHARS = 12_000;

const reflectionSchema = z.object({
  why: z.string().trim().min(10).max(300),
  what_if: z.string().trim().min(10).max(300),
  // 1-based in the prompt, because "question 2" is how a student says it.
  what_if_question: z.number().int().min(1),
});

const REFLECT_SYSTEM = `A student has just finished every question of an assignment with an AI tutor that never gives the solution. Write two short reflection questions for the student.

1. why: one "why did you do it this way" question. Point at a specific choice the student made in their own messages (an approach, a step, a structure). If their messages show no clear choice, ask why they approached question 1 the way they did.
2. what_if: one "what if" question about exactly one of the problems. Change one condition of that problem (a different input, an edge case, a constraint) and ask what would change in their approach.

Rules: each is one question, under 40 words, addressed to the student as "you". No code, no backticks, and no solution or part of a solution to any question. Do not say whether their work was right. Do not mention grades.

Return JSON: { "why": "...", "what_if": "...", "what_if_question": <the 1-based number of the problem the what-if is about> }`;

/** The questions used when the model is down, or its questions touch a key. They are true of any assignment and give nothing away. */
export function fallbackReflection(count: number): Reflection {
  const last = Math.max(1, count);
  return {
    why: "Why did you choose the approach you took on question 1, rather than another way?",
    what_if: `What if the input to question ${last} were empty or as small as possible? What would change in your approach?`,
    what_if_index: last - 1,
  };
}

/**
 * Writes the two reflection questions for one finished session.
 * Always resolves: on any failure it returns `fallbackReflection`.
 */
export async function reflectOn(input: ReflectInput): Promise<Reflection> {
  const count = input.prompts.length;
  const fallback = fallbackReflection(count);
  // Newest words kept when the student wrote a lot, because the last attempts are closest to what they finished with.
  const turns = input.studentTurns.join("\n---\n").slice(-MAX_TURN_CHARS);
  const problems = input.prompts.map((p, i) => `Question ${i + 1}:\n${p}`).join("\n\n");

  let written: z.infer<typeof reflectionSchema>;
  try {
    written = await completeJson({
      // The fast model. Like the coach, it writes teaching prose from material code already gathered.
      role: "coach",
      schema: reflectionSchema,
      system: REFLECT_SYSTEM,
      user: `The assignment:\n<<<\n${problems}\n>>>\n\nThe student's own messages, oldest first:\n<<<\n${turns || "(none)"}\n>>>`,
      generate: input.generate,
    });
  } catch (error) {
    console.error("reflection could not be written:", (error as Error).name);
    return fallback;
  }

  const leaks = (text: string) => /`/.test(text) || input.keys.filter((key) => key.trim().length > 0).some((key) => checkDeterministic(text, key, input.canary, input.kind).leaks);
  if (leaks(written.why) || leaks(written.what_if)) return fallback;
  return {
    why: written.why,
    what_if: written.what_if,
    // A number past the last question is clamped rather than trusted.
    what_if_index: Math.min(written.what_if_question, count) - 1,
  };
}
