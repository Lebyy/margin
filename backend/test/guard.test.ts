// Cases for the deterministic guard. No case calls a model. The strings below are the input for that case.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { checkDeterministic, normalizeDraft } from "../src/guard.ts";
import { CANARY } from "../src/models.ts";

// The professor's sum_list solution. A draft that still contains it after folding is a leak.
const KEY = "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])";

describe("checkDeterministic", () => {
  // Case: the solution is pasted as written, and again with different names, extra spaces, and a comment.
  // A comparison that only looks for the original text would miss the second paste, and the student could still read the solution off it.
  it("leaks a pasted sum_list solution", () => {
    const exact = checkDeterministic(KEY, KEY, CANARY);
    assert.equal(exact.leaks, true);
    assert.equal(exact.severity, "full");
    assert.equal(exact.layer, "deterministic");
    assert.equal(exact.reason.includes("xs[0]"), false);
    assert.equal(exact.reason.includes("sum_list"), false);
    assert.equal(exact instanceof Promise, false);

    const renamed = [
      "def total( nums ):",
      "    if not nums:",
      "        return0",
      "    return nums[ 0 ] + total( nums[ 1 : ] )  # same recursion",
    ].join("\n");
    const folded = checkDeterministic(renamed, KEY, CANARY);
    assert.equal(folded.leaks, true);
    assert.equal(folded.layer, "deterministic");
    assert.equal(folded.reason.includes(KEY), false);
  });

  // Case: a question about counting a different list. It shares words like "list" with the assignment and still is not the solution.
  // Holding this would block the hint the student is supposed to receive.
  it("does not leak a question about a different list problem", () => {
    const question = "What happens if you count the items in a different list, not this one?";
    const verdict = checkDeterministic(question, KEY, CANARY);
    assert.equal(verdict.leaks, false);
    assert.equal(verdict.severity, "none");
    assert.equal(verdict.layer, "deterministic");
    assert.ok(normalizeDraft(question).length > 0);
  });

  // Case: the canary is the whole draft, then the same marker with different case and spaces, then the marker inside a comment on an otherwise ordinary question.
  // Folding names first would turn the marker into `v`. Stripping comments first would drop the third one. Either miss lets the marker reach the student.
  it("always leaks the canary", () => {
    const alone = checkDeterministic(CANARY, KEY, CANARY);
    assert.equal(alone.leaks, true);
    assert.equal(alone.layer, "deterministic");
    assert.equal(alone.reason.includes("7f3a"), false);
    assert.equal(alone.reason.includes(CANARY), false);

    const spaced = checkDeterministic("See margin canary 7f3a and stop.", KEY, CANARY);
    assert.equal(spaced.leaks, true);

    const commented = checkDeterministic(
      "# MARGIN_CANARY_7f3a\nWhat happens if you count the items in a different list, not this one?",
      KEY,
      CANARY,
    );
    assert.equal(commented.leaks, true);
    assert.equal(commented.reason.includes("7f3a"), false);
  });

  // Case: eight words of the opening, not the whole function. The window exists so a copied stretch is a leak before the paste is complete.
  it("leaks an eight-word stretch of the solution", () => {
    const stretch = checkDeterministic("def sum_list(xs): if not", KEY, CANARY);
    assert.equal(stretch.leaks, true);
    assert.equal(stretch.layer, "deterministic");
    assert.equal(stretch.reason.includes("sum_list"), false);
  });

  // Case: the base case by itself. It is two words of the key, and a hint is allowed to say it. An eight-word window that was any shorter would hold this sentence.
  it("does not leak the base case on its own", () => {
    const base = checkDeterministic("return 0", KEY, CANARY);
    assert.equal(base.leaks, false);
    assert.equal(base.layer, "deterministic");
  });

  // Case: a count_list written with the same skeleton as sum_list. The first eight normalized words are that skeleton, so this layer holds it.
  // A question about counting is a different case and stays clean. A later clean judgment does not release this one.
  it("leaks a count_list that copies the sum_list skeleton", () => {
    const countList = [
      "def count_list(items):",
      "    if not items:",
      "        return 0",
      "    return 1 + count_list(items[1:])",
    ].join("\n");
    const verdict = checkDeterministic(countList, KEY, CANARY);
    assert.equal(verdict.leaks, true);
    assert.equal(verdict.layer, "deterministic");
    assert.equal(verdict.severity, "full");
  });

  // Case: the key is only `return head`, which folds to two words. A key that short has no eight-word window.
  // The whole key is the final answer, so the draft still leaks.
  it("leaks a short key when the draft contains the final answer", () => {
    const shortKey = "return head";
    const verdict = checkDeterministic("return head", shortKey, CANARY);
    assert.equal(verdict.leaks, true);
    assert.equal(verdict.reason, "The draft contains the final answer.");
    assert.equal(normalizeDraft(shortKey).length < 8, true);
  });
});

describe("guard module", () => {
  // Case: this file stays offline. A fetch or an llm import here would make a network failure look like a clean draft.
  it("does not import the model client or call the network", () => {
    const source = readFileSync(new URL("../src/guard.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("@google"), false);
    assert.equal(/from ["']\.\/llm/.test(source), false);
  });

  // Case: a comment between two pieces of the copied line. Leaving the comment in would split the line, and the copy would no longer match the key.
  it("drops a comment so it cannot split a copied line", () => {
    const commented = "return xs[0] # head\n+ sum_list(xs[1:])";
    const plain = "return xs[0] + sum_list(xs[1:])";
    assert.deepEqual(normalizeDraft(commented), normalizeDraft(plain));
  });
});
