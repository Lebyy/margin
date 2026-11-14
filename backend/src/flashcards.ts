// Revision cards for one student's weakest concept (D-R4).
//
// MindPad's revise loop, cut to fit the hint rules: a few recall cards about
// the idea the student keeps getting stuck on, drawn from the professor's own
// notes, never from the assignment's answer.
//
// How a card is made, and why each step is there:
//   1. The concept is this student's weakest one, counted in code from their
//      own scribe labels on this assignment. No model picks it, and no other
//      student's data is read.
//   2. The notes sections about that concept are found with the D-R3 search.
//      The model gets only those sections and the concept name: not the
//      answer key, the canary, the assignment prompt, or the student's name.
//      The board forbids a card prompt that can see the key, and leaving out
//      the assignment prompt keeps the model from writing cards that solve it.
//   3. The fast model writes three question/answer cards from that text.
//   4. Every card goes through the guard's deterministic check and the
//      key-line match (stepLeaks, the same check the photo step gets). A card
//      that fails is dropped whole, not edited.
//
// Cards depend only on the assignment, the concept, and the notes, so they
// are cached per that triple: every student stuck on base_case shares one
// model call until the professor edits the notes.

import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { completeJson, type TextGenerator } from "./llm.ts";
import { Assignment, CANARY, ScribeEvent, Student } from "./models.ts";
import { NO_MATCH, searchNotes } from "./notes.ts";
import { stepLeaks } from "./vision.ts";

export type Flashcard = { front: string; back: string };

export type FlashcardsResult =
  | { ok: true; concept: string | null; cards: Flashcard[] }
  | { ok: false; reason: "student_not_found" | "assignment_not_found" | "unknown_concept" | "flashcards_unavailable" };

/** Cards per concept. A short deck the student can get through between attempts. */
const CARD_COUNT = 3;

const cardsSchema = z.object({
  cards: z
    .array(z.object({ front: z.string().trim().min(1).max(200), back: z.string().trim().min(1).max(300) }))
    .min(1)
    .max(CARD_COUNT),
});

const FLASHCARD_SYSTEM = `You write revision flashcards for a student in an intro programming course.

You are given one concept and an excerpt from the professor's lecture notes. Write up to ${CARD_COUNT} flashcards that help the student recall and understand that concept, using only what the excerpt says.

Each card has:
- front: a short question about the idea (one sentence).
- back: the answer, in one or two plain sentences, in the professor's terms. Where the excerpt names a lecture or slides, the back of one card may point there.

Rules: no code, no backticks, no function definitions, and no worked solution to any exercise. Ask about the idea, not about a specific assignment. Do not add facts the excerpt does not support.

Return JSON: { "cards": [ { "front": "...", "back": "..." } ] }`;

/** Kept for the life of the process. A restart costs one model call per concept again. */
const cache = new Map<string, Flashcard[]>();

/**
 * The concept this student has struggled with on the most turns of this
 * assignment, or null when they have not struggled yet. Ties go to the
 * professor's order, so the result does not depend on database order.
 */
async function weakestConcept(studentId: string, assignmentId: string, concepts: string[]): Promise<string | null> {
  const events = await ScribeEvent.find({ student_id: studentId, assignment_id: assignmentId, struggle_type: { $ne: "none" } })
    .select("concept")
    .lean();
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.concept, (counts.get(e.concept) ?? 0) + 1);
  let best: string | null = null;
  for (const c of concepts) {
    if ((counts.get(c) ?? 0) > (best === null ? 0 : (counts.get(best) ?? 0))) best = c;
  }
  return best;
}

/**
 * The cards for one student on one assignment.
 *
 * `concept` overrides the weakest concept, for the concept buttons on the
 * Revise tab; it must be one of the assignment's concepts. With no override
 * and no struggle yet, the result is no concept and no cards, and no model is
 * called: there is nothing to revise, and a deck about a guessed concept
 * would be the page inventing a weakness.
 */
export async function studentFlashcards(
  studentId: string,
  assignmentId: string,
  options: { concept?: string; generate?: TextGenerator } = {},
): Promise<FlashcardsResult> {
  if (!mongoose.isValidObjectId(studentId) || !(await Student.exists({ _id: studentId }))) {
    return { ok: false, reason: "student_not_found" };
  }
  if (!mongoose.isValidObjectId(assignmentId)) return { ok: false, reason: "assignment_not_found" };
  // The key and canary are read for the leak check only. They never enter the prompt or the response.
  const assignment = await Assignment.findById(assignmentId).select("+answer_key +canary").lean();
  if (!assignment) return { ok: false, reason: "assignment_not_found" };

  const concepts = assignment.concepts ?? [];
  if (options.concept !== undefined && !concepts.includes(options.concept)) return { ok: false, reason: "unknown_concept" };
  const concept = options.concept ?? (await weakestConcept(studentId, assignmentId, concepts));
  if (concept === null) return { ok: true, concept: null, cards: [] };

  const notes = assignment.notes ?? "";
  const key = `${assignmentId}:${concept}:${createHash("sha256").update(notes).digest("hex")}`;
  const cached = cache.get(key);
  if (cached) return { ok: true, concept, cards: cached };

  // The D-R3 search takes words, so the concept id's underscores are spaces here.
  const excerpt = searchNotes(notes, concept.replace(/_/g, " "));
  if (excerpt === NO_MATCH) {
    // The notes do not cover this concept. No cards, rather than cards the professor never taught.
    cache.set(key, []);
    return { ok: true, concept, cards: [] };
  }

  let written: z.infer<typeof cardsSchema>;
  try {
    written = await completeJson({
      // The fast model. "coach" is the role for teaching material about a
      // class concept, and it carries no student data, like these cards.
      role: "coach",
      schema: cardsSchema,
      system: FLASHCARD_SYSTEM,
      user: `Concept: ${concept.replace(/_/g, " ")}\n\nExcerpt from the professor's notes:\n<<<\n${excerpt}\n>>>`,
      generate: options.generate,
    });
  } catch (error) {
    console.error("flashcards could not be written:", (error as Error).name);
    return { ok: false, reason: "flashcards_unavailable" };
  }

  const canary = assignment.canary ?? CANARY;
  const cards = written.cards.filter((card) => !stepLeaks(`${card.front}\n${card.back}`.replace(/\n/g, " "), assignment.answer_key, canary));
  cache.set(key, cards);
  return { ok: true, concept, cards };
}

/** Empties the card cache. Tests use it so one case's cards do not answer the next. */
export function clearFlashcardCache(): void {
  cache.clear();
}
