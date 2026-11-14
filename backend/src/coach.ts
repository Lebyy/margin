// The coach: class-level numbers for the professor, and the Thursday card.
//
// Every statistic here is computed in code from the sessions and scribe
// events that exist for one assignment. The model is used for one thing: a
// short reteach note and three practice problems for the weakest concept. It
// receives the numbers as facts, its JSON has no field that could carry a
// number back, and its prose is rejected if it states a percentage or an
// "N of M" count. So a model that "corrects" the percent cannot change what is
// stored or shown. This is the product rule: the LLM never produces or alters
// a statistic.
//
// The prompt carries concept names and counts only. It never carries a
// transcript, a quote, or a student's name.

import mongoose from "mongoose";
import { z } from "zod";
import { completeJson, type TextGenerator } from "./llm.ts";
import { Assignment, ProfessorMessage, STRUGGLE_TYPES, ScribeEvent, Session, ThursdayCard } from "./models.ts";
import type { StruggleType } from "./types.ts";

/** One row of the professor's heatmap. */
export type ConceptSummary = {
  concept: string;
  /** Distinct students with at least one struggling turn on this concept. */
  students_struggling: number;
  /** students_struggling / total_students, rounded to a whole percent. 0 when nobody has a session. */
  percent_struggling: number;
  /** Labelled turns on this concept, struggling or not. */
  turns: number;
  /** Turns per struggle type, including none. */
  struggle_types: Record<StruggleType, number>;
};

export type ClassSummary = {
  assignment_id: string;
  /** Distinct students who started at least one session on this assignment. */
  total_students: number;
  total_turns: number;
  /** In the professor's concept order, so the heatmap rows never reshuffle. */
  concepts: ConceptSummary[];
};

/** An empty count for every struggle type, so a missing type reads as 0, not undefined. */
function emptyStruggles(): Record<StruggleType, number> {
  return Object.fromEntries(STRUGGLE_TYPES.map((t) => [t, 0])) as Record<StruggleType, number>;
}

/**
 * Counts the class for one assignment, or null if the assignment does not exist.
 *
 * "Struggling" means a scribe label whose struggle_type is not `none`. A
 * jailbreak with no attempt is labelled none, so it never counts as a
 * struggle. The denominator is students with a session, not students with a
 * labelled turn: a student who opened the assignment and never got stuck
 * lowers the percent, which is what "how much of the class" means. Students
 * are counted once per concept however many turns they took, so one student
 * asking twenty times cannot look like twenty students.
 */
export async function classSummary(assignmentId: string): Promise<ClassSummary | null> {
  if (!mongoose.isValidObjectId(assignmentId)) return null;
  const assignment = await Assignment.findById(assignmentId).select("concepts").lean();
  if (!assignment) return null;

  const studentIds = await Session.distinct("student_id", { assignment_id: assignmentId });
  const totalStudents = studentIds.length;
  const events = await ScribeEvent.find({ assignment_id: assignmentId })
    .select("student_id concept struggle_type")
    .lean();

  const concepts = (assignment.concepts ?? []).map((concept) => {
    const onConcept = events.filter((e) => e.concept === concept);
    const struggling = new Set(onConcept.filter((e) => e.struggle_type !== "none").map((e) => String(e.student_id)));
    const struggleTypes = emptyStruggles();
    for (const e of onConcept) struggleTypes[e.struggle_type as StruggleType] += 1;
    return {
      concept,
      students_struggling: struggling.size,
      percent_struggling: totalStudents === 0 ? 0 : Math.round((100 * struggling.size) / totalStudents),
      turns: onConcept.length,
      struggle_types: struggleTypes,
    };
  });

  return {
    assignment_id: assignmentId,
    total_students: totalStudents,
    total_turns: events.length,
    concepts,
  };
}

/**
 * The concept the class is weakest on, or null if nobody has struggled yet.
 *
 * Highest percent first; a tie goes to the concept with more struggling
 * turns, then to the professor's order. Returning a concept nobody struggled
 * with would put a made-up problem on the Thursday card.
 */
export function weakestConcept(summary: ClassSummary): ConceptSummary | null {
  const strugglingTurns = (c: ConceptSummary) => c.turns - c.struggle_types.none;
  let best: ConceptSummary | null = null;
  for (const c of summary.concepts) {
    if (c.students_struggling === 0) continue;
    if (
      !best ||
      c.percent_struggling > best.percent_struggling ||
      (c.percent_struggling === best.percent_struggling && strugglingTurns(c) > strugglingTurns(best))
    ) {
      best = c;
    }
  }
  return best;
}

/**
 * What the model may return. There is no number field: the percent and the
 * counts are not the model's to state. zod drops any extra key, so a payload
 * that adds `percent_struggling: 90` loses that key before anything is stored.
 */
const cardSchema = z.object({
  reteach_note: z.string().trim().min(1).max(600),
  practice_problems: z.array(z.string().trim().min(1).max(400)).length(3),
});

/**
 * True if text states a statistic: a percentage, or a count like "5 of 13".
 * Ordinary numbers in a practice problem ("sum of [1, 2, 3]") or a slide
 * reference ("Lecture 7") are not statistics and pass.
 */
export function statesStatistic(text: string): boolean {
  return /\d+(\.\d+)?\s*(%|percent\b|per cent\b)/i.test(text) || /\b\d+\s+(out\s+)?of\s+(the\s+)?\d+\b/i.test(text);
}

const COACH_SYSTEM = `You help a professor plan a short reteach for an intro programming class.

You are given one concept the class struggled with and the numbers that code already measured. Those numbers are facts. Do not restate, round, estimate, or change them, and do not write any percentage or "N of M" count. The professor's card shows the numbers separately.

Return JSON with:
- reteach_note: two or three sentences the professor can act on Thursday: what to reteach about this concept and one way to show it. No numbers about the class.
- practice_problems: exactly three short practice problems that exercise this concept. Each must be a different problem from the assignment below, not the assignment itself. State the problem only. Do not include a solution or code that solves it.`;

/** The model's user turn: the assignment, the concept, and the counts as facts. Nothing about any one student. */
function coachUser(prompt: string, weakest: ConceptSummary, totalStudents: number): string {
  const kinds = Object.entries(weakest.struggle_types)
    .filter(([type, n]) => type !== "none" && n > 0)
    .map(([type, n]) => `${type}: ${n} turns`)
    .join(", ");
  return [
    `Assignment the class is working on:\n<<<\n${prompt}\n>>>`,
    `Concept: ${weakest.concept}`,
    `Measured by code (do not change): ${weakest.students_struggling} of ${totalStudents} students struggled, ${weakest.percent_struggling}%.`,
    `Kinds of struggle seen: ${kinds || "none recorded"}.`,
  ].join("\n\n");
}

/** The card's headline, written in code so its numbers are exactly the measured ones. */
export function headline(weakest: ConceptSummary, totalStudents: number): string {
  return `${weakest.percent_struggling}% of your class (${weakest.students_struggling} of ${totalStudents} students) struggled with ${weakest.concept}. Reteach it Thursday.`;
}

/** The stored card. Every number in it comes from classSummary. */
export type ThursdayCardPayload = {
  concept: string;
  percent_struggling: number;
  students_struggling: number;
  total_students: number;
  struggle_types: Record<StruggleType, number>;
  headline: string;
  reteach_note: string;
  practice_problems: string[];
};

export type CardResult =
  | { ok: true; card_id: string; payload: ThursdayCardPayload }
  | { ok: false; reason: "assignment_not_found" | "no_struggles_yet" | "coach_unavailable" };

/**
 * Builds, stores, and messages the Thursday card for one assignment.
 *
 * Nothing is stored unless the whole card is ready: no sessions with a
 * struggle means no card (the dashboard shows its empty state instead of an
 * invented problem), and a model failure means no card rather than a card
 * missing its practice problems. When the card is stored, one
 * professor_messages row is written with the same text; that row is the
 * Photon entry, and /prof/messages lists it.
 */
export async function generateThursdayCard(assignmentId: string, generate?: TextGenerator): Promise<CardResult> {
  const summary = await classSummary(assignmentId);
  if (!summary) return { ok: false, reason: "assignment_not_found" };
  const weakest = weakestConcept(summary);
  if (!weakest) return { ok: false, reason: "no_struggles_yet" };

  const assignment = await Assignment.findById(assignmentId).select("title prompt").lean();
  if (!assignment) return { ok: false, reason: "assignment_not_found" };

  let written: z.infer<typeof cardSchema>;
  try {
    written = await completeJson({
      // llm.ts has no coach role. "scribe" selects the fast model, which is
      // enough for a short note and three problems written once per click.
      role: "scribe",
      schema: cardSchema,
      system: COACH_SYSTEM,
      user: coachUser(assignment.prompt, weakest, summary.total_students),
      generate,
    });
  } catch (error) {
    console.error("coach could not write the card:", (error as Error).name);
    return { ok: false, reason: "coach_unavailable" };
  }

  // The prompt says no statistics, and this enforces it: a note that states a
  // percent or a count is replaced, not trusted, so no number on the card can
  // come from the model.
  const reteachNote = statesStatistic(written.reteach_note)
    ? `Reteach ${weakest.concept} with one worked example on the board, then have students try the practice problems below.`
    : written.reteach_note;

  const payload: ThursdayCardPayload = {
    concept: weakest.concept,
    percent_struggling: weakest.percent_struggling,
    students_struggling: weakest.students_struggling,
    total_students: summary.total_students,
    struggle_types: weakest.struggle_types,
    headline: headline(weakest, summary.total_students),
    reteach_note: reteachNote,
    practice_problems: written.practice_problems,
  };

  const card = await new ThursdayCard({ assignment_id: assignmentId, payload }).save();
  await new ProfessorMessage({ assignment_id: assignmentId, body: messageBody(assignment.title, payload) }).save();
  return { ok: true, card_id: String(card._id), payload };
}

/** The professor message: the weakest concept, the percent, and the three problems, as plain text. */
export function messageBody(title: string, payload: ThursdayCardPayload): string {
  return [
    `Thursday card for "${title}"`,
    payload.headline,
    payload.reteach_note,
    "Practice problems:",
    ...payload.practice_problems.map((p, i) => `${i + 1}. ${p}`),
  ].join("\n");
}
