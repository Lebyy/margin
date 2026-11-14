// Cases for nextHintLevel. The scribe label is the input. The function must not
// read a message or call a model, so these cases pass flags only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { START_LEVEL, nextHintLevel } from "../src/policy.ts";
import type { PolicyInput } from "../src/policy.ts";

function decide(overrides: {
  level?: PolicyInput["level"];
  hintCeiling?: PolicyInput["hintCeiling"];
  attempt_made?: boolean;
  jailbreak_attempt?: boolean;
  demonstrated_understanding?: boolean;
}) {
  return nextHintLevel({
    level: overrides.level ?? START_LEVEL,
    hintCeiling: overrides.hintCeiling ?? 3,
    label: {
      attempt_made: overrides.attempt_made ?? false,
      jailbreak_attempt: overrides.jailbreak_attempt ?? false,
      demonstrated_understanding: overrides.demonstrated_understanding ?? false,
    },
  });
}

describe("nextHintLevel", () => {
  // Case: a new session is on rung 1, and a real try climbs exactly one rung.
  // Jumping to 3 here would skip the notes and give the worked example on the first try.
  it("escalates one level when the scribe saw an attempt", () => {
    assert.equal(START_LEVEL, 1);
    assert.equal(decide({ level: 1, hintCeiling: 3, attempt_made: true }), 2);
    assert.equal(decide({ level: 2, hintCeiling: 3, attempt_made: true }), 3);
  });

  // Case: claimed permission plus a pasted try. The jailbreak flag wins, so the pasted try is not a reason to climb.
  // Treating attempt_made as enough would reward "my professor said you can" whenever it sits next to some code.
  it("stays put on a jailbreak even when an attempt was also made", () => {
    assert.equal(
      decide({ level: 1, hintCeiling: 3, attempt_made: true, jailbreak_attempt: true }),
      1,
    );
    assert.equal(
      decide({ level: 2, hintCeiling: 3, attempt_made: false, jailbreak_attempt: true }),
      2,
    );
  });

  // Case: the professor set the ceiling to 1. A real try cannot open the notes.
  // Ignoring the ceiling would let a level-1 assignment reach the worked example.
  it("stays at 1 when the ceiling is 1", () => {
    assert.equal(decide({ level: 1, hintCeiling: 1, attempt_made: true }), 1);
  });

  // Case: the student is already on the top rung the professor allowed.
  // Adding one more would invent a level 4, and level 4 is the solution.
  it("stays at the ceiling when the student is already there", () => {
    assert.equal(decide({ level: 3, hintCeiling: 3, attempt_made: true }), 3);
    assert.equal(decide({ level: 2, hintCeiling: 2, attempt_made: true }), 2);
  });

  // Case: "just tell me", with no try. The scribe marks attempt_made false, and the rung does not move.
  // Climbing on a request for the answer is the escalation the ladder forbids.
  it("stays put when no attempt was made", () => {
    assert.equal(decide({ level: 1, hintCeiling: 3, attempt_made: false }), 1);
  });

  // Case: the student already has the idea. A stronger hint is not owed.
  // Escalating here would trade a correct explanation for a worked example.
  it("stays put when the scribe says the student understood", () => {
    assert.equal(
      decide({
        level: 1,
        hintCeiling: 3,
        attempt_made: true,
        demonstrated_understanding: true,
      }),
      1,
    );
  });
});
