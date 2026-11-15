// Cases for the batched Thursday card refresh. The coach and the card writer are not reached: the batch rule is checked through
// noteStudentTurn's return value, which is null whenever no refresh was started. No database, no model.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { BATCH_TURNS, noteStudentTurn, resetLiveCards } from "../src/live-card.ts";

describe("the live Thursday card", () => {
  beforeEach(() => resetLiveCards());

  // Case: fewer turns than a batch start nothing, so a quiet class costs no model calls.
  it("waits for a full batch of student turns", () => {
    for (let i = 1; i < BATCH_TURNS; i += 1) assert.equal(noteStudentTurn("a1"), null, `turn ${i}`);
  });

  // Case: each assignment counts its own turns.
  it("counts each assignment separately", () => {
    for (let i = 1; i < BATCH_TURNS; i += 1) noteStudentTurn("a1");
    assert.equal(noteStudentTurn("a2"), null);
  });
});
