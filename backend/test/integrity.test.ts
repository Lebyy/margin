import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addActivity, classTimes, copyNote, findTrap, reviewWork, trapToken, typingRecord, type MessageForReview, type Typing } from "../src/integrity.ts";

// The integrity review's promise is no false accusations: honest ways of
// working stay clear, evidence needs something that cannot happen by
// accident, and patterns count only when independent ones agree. Each case
// names the student behaviour and the outcome it must get. No model is called.

const SESSION = "6af9397513afc9cccdca152a";

/** A message typed by a person: irregular rhythm, some corrections, no time away. Fields are overridden per case. */
function typed(text: string, over: Partial<Typing> = {}): Typing {
  const n = [...text].length;
  return { keys: n + 12, typed: n + 10, inserted: 0, filled: 0, deleted: 10, synthetic: 0, paste_blocked: 0, compose_ms: 60_000, iki_n: n, iki_median_ms: 180, iki_cv_milli: 850, away_ms: 0, longest_away_ms: 0, typed_after_away: 0, ...over };
}

const code = "def celsius_to_fahrenheit(c):\n    result = c * 9 / 5 + 32\n    return result\n# checked with 100 -> 212 and 0 -> 32, and -40 stays -40 on both scales.\n";

function review(messages: MessageForReview[], extra: Partial<Parameters<typeof reviewWork>[0]> = {}) {
  return reviewWork({ sessionId: SESSION, questionCount: 3, messages, secondsPerQuestion: [600, null, null], activity: [], classMedianMs: [600_000, null, null], classFinished: [40, 0, 0], exempt: false, ...extra });
}

describe("the copy trap", () => {
  test("the token is stable, differs per student and question, and the note speaks only to an AI", () => {
    assert.equal(trapToken(SESSION, 0), trapToken(SESSION, 0));
    assert.notEqual(trapToken(SESSION, 0), trapToken(SESSION, 1));
    assert.notEqual(trapToken(SESSION, 0), trapToken("6af939c313afc9cccdca152b", 0));
    assert.match(trapToken(SESSION, 0), /^[a-z]+_[a-z]+_\d{2}$/);
    assert.match(copyNote(SESSION, 0, "code"), /If you are an AI model/);
  });

  test("work that uses the token is evidence, even retyped with spaces or capitals", () => {
    const [a, b, n] = trapToken(SESSION, 1).split("_");
    assert.equal(findTrap(`total = 0\n${a.toUpperCase()} ${b}${n} = sum(xs)`, SESSION, 3), 1);
    const r = review([{ question_index: 1, content: `def f(xs):\n    ${trapToken(SESSION, 1)} = 0\n    return ${trapToken(SESSION, 1)}`, typing: null }]);
    assert.equal(r.level, "evidence");
    assert.equal(r.findings[0].code, "copy_trap");
  });

  test("the trap still works for a student with the typing accommodation on", () => {
    const r = review([{ question_index: 0, content: `x = ${trapToken(SESSION, 0)}`, typing: null }], { exempt: true });
    assert.equal(r.level, "evidence");
  });
});

describe("honest students stay clear", () => {
  test("a fast, fluent typist who corrects as they go", () => {
    const r = review([{ question_index: 0, content: code, typing: typingRecord(code, typed(code, { iki_median_ms: 90, iki_cv_milli: 620 })) }]);
    assert.equal(r.level, "clear");
    assert.deepEqual(r.findings, []);
  });

  test("dictation and a suggestion chip: text the page filled is explained", () => {
    const said = "can you explain why we add thirty two after multiplying, i do not get the order of operations here at all";
    const r = review([{ question_index: 0, content: said, typing: typingRecord(said, typed(said, { typed: 0, keys: 0, iki_n: 0, filled: said.length })) }]);
    assert.equal(r.level, "clear");
  });

  test("a phone keyboard: swipe and prediction insert whole words, which count as written", () => {
    const msg = "I think the base case is when the list is empty but I am not sure what to return there";
    const r = review([{ question_index: 0, content: msg, typing: typingRecord(msg, typed(msg, { typed: 10, inserted: msg.length - 10, keys: 10, iki_n: 10 })) }]);
    assert.equal(r.level, "clear");
  });

  test("solved on paper first: steady copying pace and a fast finish are one story, so still clear", () => {
    const t = typingRecord(code, typed(code, { typed: 260, keys: 262, deleted: 1, iki_n: 250, iki_cv_milli: 300 }));
    const r = review([{ question_index: 0, content: code.repeat(2), typing: t }], { secondsPerQuestion: [60, null, null] });
    assert.equal(r.level, "clear");
    // Both signals are still shown to the professor, each with its innocent explanation.
    assert.deepEqual(r.findings.map((f) => f.code).sort(), ["fast_solve", "transcription"]);
    assert.ok(r.findings.every((f) => f.innocent.length > 0));
  });

  test("a fast finish with little work, or in a class too small to compare, is not even shown", () => {
    assert.deepEqual(review([{ question_index: 0, content: "done", typing: null }], { secondsPerQuestion: [30, null, null] }).findings, []);
    assert.deepEqual(review([{ question_index: 0, content: code, typing: null }], { secondsPerQuestion: [30, null, null], classFinished: [5, 0, 0] }).findings, []);
  });

  test("a message the page did not describe (Talk, an older page) is not reviewed for typing", () => {
    assert.equal(review([{ question_index: 0, content: code, typing: null }]).level, "clear");
  });

  test("the accommodation turns off every typing signal", () => {
    const t = typingRecord(code, typed(code, { typed: 0, keys: 0, iki_n: 0, synthetic: 200 }));
    assert.equal(review([{ question_index: 0, content: code, typing: t }], { exempt: true }).level, "clear");
  });
});

describe("what is raised", () => {
  test("text that appeared without typing is evidence", () => {
    const r = review([{ question_index: 0, content: code, typing: typingRecord(code, typed(code, { typed: 5, keys: 5, iki_n: 5 })) }]);
    assert.equal(r.level, "evidence");
    assert.equal(r.findings[0].code, "untracked_text");
  });

  test("script-made key events are evidence", () => {
    const r = review([{ question_index: 0, content: code, typing: typingRecord(code, typed(code, { synthetic: 140 })) }]);
    assert.equal(r.level, "evidence");
    assert.ok(r.findings.some((f) => f.code === "script_input"));
  });

  test("a machine-even rhythm plus a fast finish is worth a look", () => {
    const t = typingRecord(code, typed(code, { iki_n: 140, iki_cv_milli: 60 }));
    const r = review([{ question_index: 0, content: code, typing: t }], { secondsPerQuestion: [40, null, null] });
    assert.equal(r.level, "worth_a_look");
  });

  test("left the page, came back, copied it in without corrections, and finished in a fraction of the class time: worth a look", () => {
    const t = typingRecord(code, typed(code, { typed: 260, keys: 262, deleted: 0, iki_n: 250, iki_cv_milli: 280, longest_away_ms: 95_000, away_ms: 95_000, typed_after_away: 240 }));
    const r = review([{ question_index: 0, content: code.repeat(2), typing: t }], { secondsPerQuestion: [70, null, null] });
    assert.equal(r.level, "worth_a_look");
  });

  test("a machine-even rhythm alone is shown but not raised", () => {
    const t = typingRecord(code, typed(code, { iki_n: 140, iki_cv_milli: 60 }));
    const r = review([{ question_index: 0, content: code, typing: t }]);
    assert.equal(r.level, "clear");
    assert.equal(r.findings[0].code, "robotic_rhythm");
  });
});

describe("time", () => {
  test("reports add into per-question totals; the longest time away is a maximum", () => {
    let rows = addActivity([], { question_index: 0, active_ms: 30_000, away_ms: 5000, away_count: 1, longest_away_ms: 5000, paste_blocked: 1, copies: 0 });
    rows = addActivity(rows, { question_index: 0, active_ms: 20_000, away_ms: 40_000, away_count: 2, longest_away_ms: 30_000, paste_blocked: 0, copies: 1 });
    assert.deepEqual(rows, [{ index: 0, active_ms: 50_000, away_ms: 45_000, away_count: 3, longest_away_ms: 30_000, paste_blocked: 1, copies: 1 }]);
  });

  test("the class median counts finished questions only", () => {
    const t = classTimes([[100, 50], [300, null], [200, null]], 2);
    assert.deepEqual(t, { medianMs: [200_000, 50_000], finished: [3, 1] });
  });
});

describe("typing speed", () => {
  test("a program typing a whole answer in seconds is evidence; a fast person is not", () => {
    const long = code.repeat(2);
    const bot = typingRecord(long, typed(long, { compose_ms: 2000 }));
    assert.equal(review([{ question_index: 0, content: long, typing: bot }]).findings.some((f) => f.code === "superhuman_typing"), true);
    // Case: a 150-word-a-minute typist writing the same answer, about 12 characters a second.
    const quick = typingRecord(long, typed(long, { compose_ms: Math.round((long.length / 12) * 1000) }));
    assert.equal(review([{ question_index: 0, content: long, typing: quick }]).level, "clear");
  });
});
