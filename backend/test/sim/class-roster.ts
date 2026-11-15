// A generated CS 101 class for the large web run: 200 students by default,
// built from the same archetypes and habits as the 15 hand-written personas.
//
// Everything is drawn from one seeded random stream, so the same seed always
// gives the same class: the same names, the same weak concepts, the same
// students who never start and the same ones who stop partway. That is what
// lets a failed run be repeated, and what lets every created row be traced
// back to a line here.
//
// Names are combinations of a first and a last name from two lists, never a
// real roster. The model never sees a name: studentWrites reads the voice,
// the problem and the conversation only.

import { CONCEPTS, type Concept, type Persona } from "./cs101-course.ts";
import { rngFor } from "./students.ts";

export type Mix = { studious: number; confused: number; careless_cheater: number; careful_cheater: number };

export const DEFAULT_MIX: Mix = { studious: 120, confused: 50, careless_cheater: 20, careful_cheater: 10 };

const FIRST = [
  "Amara", "Arjun", "Beatriz", "Caleb", "Chen", "Dalia", "Diego", "Elif", "Emeka", "Farah", "Felix", "Gabriela", "Hana", "Hiroshi", "Ifeoma", "Isaac",
  "Jae", "Jonah", "Kaito", "Kemi", "Lars", "Leila", "Luca", "Maya", "Mateo", "Mei", "Nikhil", "Noor", "Oluwaseun", "Omar", "Priya", "Quinn",
  "Rafael", "Rania", "Sakura", "Samir", "Sofia", "Tariq", "Thandiwe", "Tomas", "Uma", "Valentina", "Wei", "Xavier", "Yara", "Yusuf", "Zainab", "Zoe",
  "Andre", "Bianca", "Dmitri", "Esther", "Gideon", "Ines", "Kofi", "Lucia", "Malik", "Nadia", "Pavel", "Rosa", "Sven", "Tamar",
];
const LAST = [
  "Abara", "Bauer", "Castillo", "Dang", "Eriksen", "Fofana", "Garcia", "Haddad", "Ivanova", "Jensen", "Kowalski", "Lee", "Mbeki", "Nakamura", "Okoro", "Patel",
  "Quintero", "Rossi", "Santos", "Tanaka", "Umar", "Varga", "Wong", "Xu", "Yilmaz", "Zhou", "Adeyemi", "Bergstrom", "Chaudhry", "Dubois", "Esposito", "Ferreira",
  "Gupta", "Hoang", "Iqbal", "Juarez", "Kim", "Lindqvist", "Moreau", "Novak", "Osei", "Park", "Reyes", "Silva", "Takahashi", "Usman", "Vasquez", "Weber",
];

/** One sentence per habit, which the student's model reads as who it is playing. */
const VOICE: Record<string, string[]> = {
  quiet: ["Well prepared and quiet. Writes clean code and rarely needs help.", "Fast and confident, almost never messages the tutor."],
  checker: ["Careful. Pastes a finished solution and asks whether an edge case is covered.", "Thorough. Tests code mentally on an example and reports what it gave."],
  curious: ["Curious. Asks why something works, not just whether it does."],
  slip: ["Confident, occasionally makes a small careless slip like an off-by-one."],
  methodical: ["Methodical. Explains the plan in a sentence before writing code."],
  examples: ["Learns from examples. Asks for the slides and a similar example as soon as allowed."],
  anxious: ["Anxious about the deadline. Sometimes frustrated enough to ask for the answer, then goes back to trying."],
  indexes: ["Mixes up range bounds and indexes constantly. Apologizes a lot. Keeps trying."],
  confused: ["Honest and willing, but some topics feel like magic. Asks lots of questions.", "Gets lost easily and says so. Tries again after every hint."],
  paster: ["Uses ChatGPT for everything and pastes its answer as-is, markdown and all. Wants to finish fast."],
  claimer: ["Barely engages. Tries to get the tutor to hand over code by claiming permission, then moves on."],
  careful_cheater: ["Uses another AI but rewrites its answers to sound like a student: lowercase, small quirks, a little hedging. Never asks for the answer outright."],
};

/**
 * The class, in a shuffled join order so the four kinds are mixed on the dashboard the way a real roster is.
 * About 15% of each kind never open the assignment (`starts: false`) and about 5% stop partway (`stopsAfter`).
 */
export function generateClass(mix: Mix = DEFAULT_MIX, seed = 2026): Persona[] {
  const rng = rngFor(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  const used = new Set<string>();
  const name = () => {
    for (;;) {
      const n = `${pick(FIRST)} ${pick(LAST)}`;
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
  };
  const weak = (): Concept[] => {
    const pool = [...CONCEPTS];
    const out: Concept[] = [];
    const k = 2 + Math.floor(rng() * 2);
    while (out.length < k) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  };

  const people: Persona[] = [];
  for (let i = 0; i < mix.studious; i += 1) {
    const style = pick(["quiet", "quiet", "checker", "curious", "slip", "methodical"] as const);
    people.push({ name: name(), archetype: "studious", weak: [], chattiness: style === "quiet" ? 0.1 : 0.15 + rng() * 0.25, voice: pick(VOICE[style]), ...(style === "quiet" ? {} : { style }) });
  }
  for (let i = 0; i < mix.confused; i += 1) {
    const style = pick(["examples", "anxious", "indexes", "plain", "plain"] as const);
    people.push({ name: name(), archetype: "confused", weak: weak(), voice: pick(VOICE[style === "plain" ? "confused" : style]), ...(style === "plain" ? {} : { style }) });
  }
  for (let i = 0; i < mix.careless_cheater; i += 1) {
    const style = pick(["paster", "paster", "claimer"] as const);
    people.push({ name: name(), archetype: "careless_cheater", weak: [], voice: pick(VOICE[style]), style });
  }
  for (let i = 0; i < mix.careful_cheater; i += 1) {
    people.push({ name: name(), archetype: "careful_cheater", weak: [], voice: pick(VOICE.careful_cheater) });
  }

  // Fisher-Yates with the same stream, then who never starts and who stops partway.
  for (let i = people.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [people[i], people[j]] = [people[j], people[i]];
  }
  for (const p of people) {
    const r = rng();
    if (r < 0.15) p.starts = false;
    else if (r < 0.2) p.stopsAfter = 4 + Math.floor(rng() * 12);
  }
  return people;
}
