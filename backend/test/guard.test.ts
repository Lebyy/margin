// Cases for the deterministic guard. No case calls a model. The strings below are the input for that case.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assessDraft, checkDeterministic, FALLBACK_REPLY, guardDraft, normalizeDraft } from "../src/guard.ts";
import { FAST_MODEL } from "../src/llm.ts";
import { CANARY } from "../src/models.ts";

// The professor's sum_list solution. A draft that still contains it after folding is a leak.
const KEY = "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])";

describe("checkDeterministic", () => {
  // Case: the solution with a zero-width space inside each keyword, the solution typed in fullwidth letters, and the canary cut by a zero-width joiner.
  // Each one reads as the solution on screen and pastes as the solution. All three have to be held, and a plain question still has to pass.
  it("holds a solution hidden behind invisible or lookalike characters", () => {
    const zeroWidth = KEY.replace(/def/g, "de\u200bf").replace(/return/g, "re\u200bturn").replace(/not/g, "n\u200dot");
    assert.equal(checkDeterministic(zeroWidth, KEY, CANARY).leaks, true);

    const fullwidth = KEY.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
    assert.equal(checkDeterministic(fullwidth, KEY, CANARY).leaks, true);

    const cutCanary = `${CANARY.slice(0, 6)}\u200d${CANARY.slice(6)}`;
    assert.equal(checkDeterministic(`Here: ${cutCanary}`, KEY, CANARY).leaks, true);

    assert.equal(checkDeterministic("What happens when the list is empty?", KEY, CANARY).leaks, false);
  });

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

  // Case: the solution with a space between every letter. Each letter would otherwise become its own name, and the eight-word window would not see the line.
  it("leaks a solution typed with a space between each letter", () => {
    const spaced = KEY.replace(/\s+/g, "").split("").join(" ");
    const verdict = checkDeterministic(spaced, KEY, CANARY);
    assert.equal(verdict.leaks, true);
    assert.equal(verdict.layer, "deterministic");
    assert.equal(verdict.reason.includes("sum_list"), false);
    assert.equal(verdict.reason.includes(spaced), false);
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

describe("guardDraft", () => {
  // Case: the judge returns prose, then prose again on each retry. The student must get the fallback question, not the draft the tutor wrote.
  // Treating the prose as a clean verdict would send the draft. A parse error is a leak.
  it("sends the fallback when the judge returns garbage", async () => {
    const draft = "Count the items by asking what happens when the list is empty.";
    let redrafts = 0;
    const result = await guardDraft({
      draft,
      level: 3,
      answerKey: KEY,
      canary: CANARY,
      generate: async () => "this is not json",
      redraft: async (level) => {
        redrafts += 1;
        return `A different question, retry ${redrafts}, level ${level}.`;
      },
    });
    assert.equal(result.reply, FALLBACK_REPLY);
    assert.equal(result.reply.includes(draft), false);
    assert.equal(result.reply.includes("retry"), false);
    assert.equal(result.retries, 2);
    assert.equal(result.verdict.leaks, true);
    assert.equal(result.verdict.layer, "fallback");
    assert.equal(redrafts, 2);
  });

  // Case: the provider throws. The same hold as garbage JSON. A catch that returns the draft would fail open on a timeout.
  it("sends the fallback when the provider throws", async () => {
    const draft = "Look at the first item, then the rest of the list.";
    const result = await guardDraft({
      draft,
      level: 2,
      answerKey: KEY,
      canary: CANARY,
      generate: async () => {
        throw new Error("provider down");
      },
      redraft: async () => "What is left when you take the first item off?",
    });
    assert.equal(result.reply, FALLBACK_REPLY);
    assert.equal(result.reply.includes(draft), false);
    assert.equal(result.verdict.leaks, true);
    assert.equal(result.verdict.layer, "fallback");
    assert.equal(result.retries, 2);
  });

  // Case: the draft is the solution, and the judge double is ready to call it clean.
  // The string check has to win without asking. A model call here would let that clean judgment release the solution.
  it("leaks a quoted solution from the deterministic layer without a model call", async () => {
    let calls = 0;
    const verdict = await assessDraft(KEY, KEY, CANARY, async () => {
      calls += 1;
      return JSON.stringify({ leaks: false, severity: "none", reason: "clean" });
    });
    assert.equal(calls, 0);
    assert.equal(verdict.leaks, true);
    assert.equal(verdict.layer, "deterministic");

    const turned = await guardDraft({
      draft: KEY,
      level: 3,
      answerKey: KEY,
      canary: CANARY,
      generate: async () => {
        calls += 1;
        return JSON.stringify({ leaks: false, severity: "none", reason: "clean" });
      },
      redraft: async () => KEY,
    });
    assert.equal(calls, 0);
    assert.equal(turned.reply, FALLBACK_REPLY);
    assert.equal(turned.reply.includes("sum_list"), false);
    assert.equal(turned.verdict.leaks, true);
  });

  // Case: the judge holds the first draft and quotes the key in the reason. The retry is one level down, and the reason the tutor sees has the key removed.
  // Passing the reason through unchanged would put the solution in the tutor prompt.
  it("retries at a lower level without sending the key back", async () => {
    let calls = 0;
    let seenLevel = 0;
    let seenFeedback = "";
    const result = await guardDraft({
      draft: "Walk the list from the left and add each head.",
      level: 3,
      answerKey: KEY,
      canary: CANARY,
      generate: async (request) => {
        calls += 1;
        assert.equal(request.model, FAST_MODEL);
        assert.match(request.system, /copy it/);
        assert.match(request.system, /different problem/);
        assert.match(request.user, /Answer key:/);
        if (calls === 1) {
          return JSON.stringify({ leaks: true, severity: "partial", reason: `Held because of ${KEY} and ${CANARY}` });
        }
        return JSON.stringify({ leaks: false, severity: "none", reason: "It is a question." });
      },
      redraft: async (level, feedback) => {
        seenLevel = level;
        seenFeedback = feedback;
        return "What happens when the list is empty?";
      },
    });
    assert.equal(seenLevel, 2);
    assert.equal(seenFeedback.includes("sum_list"), false);
    assert.equal(seenFeedback.includes(CANARY), false);
    assert.equal(seenFeedback.includes("7f3a"), false);
    assert.equal(result.reply, "What happens when the list is empty?");
    assert.equal(result.level, 2);
    assert.equal(result.retries, 1);
    assert.equal(result.verdict.leaks, false);
    assert.equal(result.verdict.layer, "judge");
  });

  // Case: the judge says the draft is clean and also marks it full. The boolean would let it out.
  // The severity is the half that says it is not clean, so the draft stays held and the fallback is what ships.
  it("does not release a draft the judge calls clean and full", async () => {
    const draft = "Take the first number and combine it with the rest.";
    const levels: number[] = [];
    const result = await guardDraft({
      draft,
      level: 1,
      answerKey: KEY,
      canary: CANARY,
      generate: async () => JSON.stringify({ leaks: false, severity: "full", reason: "The steps are the solution." }),
      redraft: async (level) => {
        levels.push(level);
        return "Still the steps.";
      },
    });
    assert.deepEqual(levels, [1, 1]);
    assert.equal(result.reply, FALLBACK_REPLY);
    assert.equal(result.level, 1);
    assert.equal(result.verdict.leaks, true);
  });
});

describe("guard module", () => {
  // Case: the judge goes through completeJson. Importing the Gemini SDK here would make a second door, and a fetch would skip the schema check.
  it("calls the model only through completeJson", () => {
    const source = readFileSync(new URL("../src/guard.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("@google"), false);
    assert.equal(source.includes("GoogleGenAI"), false);
    assert.match(source, /completeJson/);
  });

  // Case: a comment between two pieces of the copied line. Leaving the comment in would split the line, and the copy would no longer match the key.
  it("drops a comment so it cannot split a copied line", () => {
    const commented = "return xs[0] # head\n+ sum_list(xs[1:])";
    const plain = "return xs[0] + sum_list(xs[1:])";
    assert.deepEqual(normalizeDraft(commented), normalizeDraft(plain));
  });
});
