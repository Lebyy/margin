import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { CANARY, Session } from "../src/models.ts";
import { secondsPerQuestion } from "../src/questions.ts";
import { fallbackReflection } from "../src/reflect.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// Multi-question assignments, the per-question clock the professor sees, and
// the two reflection questions after the last question. The assignment and
// sessions are made through the real routes. The scribe, tutor, judge, and
// reflection writer are stand-ins, so this file makes zero model calls.
// Skipped without MONGODB_URI.

const uri = testUri("margin_test_questions");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

const KEY_1 = "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])";
const KEY_2 = "def count_list(xs):\n    if xs == []:\n        return 0\n    return 1 + count_list(xs[1:])";
const KEY_3 = "def max_list(xs):\n    if len(xs) == 1:\n        return xs[0]\n    return max(xs[0], max_list(xs[1:]))";
const THREE = {
  course_name: "Intro CS, Python recursion",
  title: "Recursion set",
  prompt: "Write sum_list(xs) recursively.",
  answer_key: KEY_1,
  notes: "Lecture 7, slides 12-16.",
  concepts: ["base_case", "recursive_call_progress", "return_value_propagation", "call_stack_tracing"],
  hint_ceiling: 3,
  questions: [
    { prompt: "Write count_list(xs) recursively.", answer_key: KEY_2 },
    { prompt: "Write max_list(xs) recursively for a non-empty list.", answer_key: KEY_3 },
  ],
};

describe("questions, the per-question clock, and the reflection", { skip }, () => {
  let server: Server;
  let base: string;
  let assignmentId: string;
  // What the stand-ins answer, and what they were asked.
  let draft = "What happens when the list is empty?";
  let tutorUsers: string[] = [];
  let reflectReply: string | Error = "";
  let reflectCalls = 0;
  let reflectUsers: string[] = [];

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp({
      offline: true,
      scribe: async () => JSON.stringify({ concept: "base_case", struggle_type: "misconception", attempt_made: true, jailbreak_attempt: false, demonstrated_understanding: false, evidence: "" }),
      tutor: async (call) => {
        tutorUsers.push(`${call.systemPrompt}\n${call.user}`);
        return draft;
      },
      judge: async () => JSON.stringify({ leaks: false, severity: "none", reason: "A question." }),
      reflect: async ({ user }) => {
        reflectCalls += 1;
        reflectUsers.push(user);
        if (reflectReply instanceof Error) throw reflectReply;
        return reflectReply;
      },
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const saved = await call("POST", "/api/prof/assignments", THREE);
    assert.equal(saved.status, 201, saved.text);
    assignmentId = JSON.parse(saved.text)._id;
  });

  after(async () => {
    server.close();
    await dropTestDatabase();
    await disconnectDb();
  });

  /** Sends a request to the running app and returns status plus raw text. */
  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  }

  /** True if the body carries any line of any of the three keys, or the canary. */
  function carriesKey(text: string): boolean {
    return ["xs[0] + sum_list", "1 + count_list", "max(xs[0]", "if not xs", "question_keys", "\"answer_key\":"].some((s) => text.includes(s)) || text.includes(CANARY);
  }

  async function startSession(name: string): Promise<{ session_id: string; student_id: string }> {
    return JSON.parse((await call("POST", "/api/sessions", { assignment_id: assignmentId, display_name: name })).text);
  }

  test("a three-question assignment shows every prompt and no key", async () => {
    // Case: the student view and the professor's setup reload. Both list the three prompts in order and carry no key.
    for (const path of [`/api/assignments/${assignmentId}`, `/api/prof/assignments/${assignmentId}`]) {
      const res = await call("GET", path);
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.text).questions, [THREE.prompt, THREE.questions[0].prompt, THREE.questions[1].prompt]);
      assert.ok(!carriesKey(res.text), path);
    }
  });

  test("a later question without a key is refused unless the assignment is a topic", async () => {
    // Case: a graded assignment with a keyless second question must be a 400, because the guard would have nothing to check.
    const bad = await call("POST", "/api/prof/assignments", { ...THREE, questions: [{ prompt: "No key here." }] });
    assert.equal(bad.status, 400);
  });

  test("an edit that removes question 2 keeps question 3's key with question 3", async () => {
    // Case: the form sends question 3 back with `from: 2` and no key. The stored key must follow it, so a draft quoting max_list is still held there.
    const copy = JSON.parse((await call("POST", "/api/prof/assignments", { ...THREE, title: "Edit me" })).text)._id;
    const edited = await call("POST", "/api/prof/assignments", { ...THREE, id: copy, title: "Edit me", answer_key: undefined, questions: [{ prompt: THREE.questions[1].prompt, from: 2 }] });
    assert.equal(edited.status, 200, edited.text);
    const s = JSON.parse((await call("POST", "/api/sessions", { assignment_id: copy, display_name: "Eve" })).text);
    await call("POST", `/api/sessions/${s.session_id}/finish-question`);
    draft = KEY_3;
    const turn = JSON.parse((await call("POST", `/api/sessions/${s.session_id}/messages`, { text: "Just show me." })).text);
    draft = "What happens when the list is empty?";
    assert.equal(turn.verdict.leaks, true);
    assert.ok(!carriesKey(JSON.stringify(turn)));
  });

  test("each question's turn uses that question's prompt, and another question's solution is held", async () => {
    // Case: after Next, the tutor is asked about count_list, not sum_list. A draft that is question 1's solution is held on question 2.
    const s = await startSession("Ada");
    const next = JSON.parse((await call("POST", `/api/sessions/${s.session_id}/finish-question`)).text);
    assert.deepEqual(next, { done: false, current_question: 1, level: 1 });

    tutorUsers = [];
    await call("POST", `/api/sessions/${s.session_id}/messages`, { text: "Where do I start?" });
    assert.ok(tutorUsers.some((u) => u.includes("count_list")), "the tutor was asked about question 2");
    assert.ok(!tutorUsers.some((u) => u.includes("Write sum_list")), "question 1's prompt is not the one asked");

    draft = KEY_1;
    const leaked = await call("POST", `/api/sessions/${s.session_id}/messages`, { text: "Show me sum_list then." });
    draft = "What happens when the list is empty?";
    const body = JSON.parse(leaked.text);
    assert.equal(body.verdict.leaks, true);
    assert.equal(body.reply, "What happens when the list is empty?");
    assert.ok(!carriesKey(leaked.text));
  });

  test("the clock runs per question, and the student page never receives it", async () => {
    // Case: three questions finished in order. Each gets a start and a finish in order; the reload route has no times.
    reflectReply = JSON.stringify({ why: "Why did you check for an empty list before adding?", what_if: "What if max_list were given an empty list?", what_if_question: 3 });
    const s = await startSession("Bob");
    await call("POST", `/api/sessions/${s.session_id}/messages`, { text: "Here is my try.", attempt: "def sum_list(xs): return xs[0] + sum_list(xs[1:])" });
    await call("POST", `/api/sessions/${s.session_id}/finish-question`);
    await call("POST", `/api/sessions/${s.session_id}/finish-question`);
    const last = await call("POST", `/api/sessions/${s.session_id}/finish-question`);
    const done = JSON.parse(last.text);
    assert.equal(done.done, true);
    assert.equal(done.reflection.why, "Why did you check for an empty list before adding?");
    assert.equal(done.reflection.what_if_index, 2);
    assert.ok(!/seconds|started_at|finished_at|question_times/.test(last.text));

    const stored = await Session.findById(s.session_id).lean();
    assert.ok(stored?.completed_at);
    const times = stored!.question_times;
    assert.deepEqual(times.map((t) => t.index), [0, 1, 2]);
    for (const t of times) assert.ok(t.finished_at && t.finished_at >= t.started_at);
    for (let i = 1; i < times.length; i += 1) assert.ok(times[i].started_at >= times[i - 1].finished_at!);

    const reload = await call("GET", `/api/sessions/${s.session_id}/messages`);
    const r = JSON.parse(reload.text);
    assert.equal(r.completed, true);
    assert.equal(r.reflection.why, done.reflection.why);
    assert.ok(!/seconds|started_at|finished_at|question_times/.test(reload.text));

    // The model read the student's own words and the prompts, and no key.
    // (The student's own attempt shares a line with key 1, so key 1 is checked by its base case, which the attempt lacks.)
    const user = reflectUsers.at(-1) ?? "";
    assert.ok(user.includes("Here is my try."));
    assert.ok(!["if not xs", "1 + count_list", "max(xs[0]", CANARY].some((s) => user.includes(s)));
  });

  test("finishing twice calls the reflection writer once", async () => {
    // Case: a double click on Finish. The second call returns the stored questions and spends no model call.
    reflectReply = JSON.stringify({ why: "Why did you return 0 for an empty list?", what_if: "What if count_list had to skip None items?", what_if_question: 2 });
    const s = await startSession("Cy");
    for (let i = 0; i < 2; i += 1) await call("POST", `/api/sessions/${s.session_id}/finish-question`);
    const before = reflectCalls;
    const first = JSON.parse((await call("POST", `/api/sessions/${s.session_id}/finish-question`)).text);
    const again = JSON.parse((await call("POST", `/api/sessions/${s.session_id}/finish-question`)).text);
    assert.equal(reflectCalls, before + 1);
    assert.deepEqual(again.reflection, first.reflection);
  });

  test("a reflection that quotes a key, or a writer that fails, gives the fixed questions", async () => {
    // Case one: the writer's what-if contains question 2's solution. Case two: the writer throws. Both finish with 200 and the fallback.
    const fallback = fallbackReflection(3);
    for (const reply of [JSON.stringify({ why: "Why did you write it this way?", what_if: `What if you wrote ${KEY_2.replace(/\n/g, " ")}?`, what_if_question: 2 }), new Error("provider down")]) {
      reflectReply = reply;
      const s = await startSession("Dee");
      for (let i = 0; i < 2; i += 1) await call("POST", `/api/sessions/${s.session_id}/finish-question`);
      const res = await call("POST", `/api/sessions/${s.session_id}/finish-question`);
      assert.equal(res.status, 200);
      const body = JSON.parse(res.text);
      assert.equal(body.reflection.why, fallback.why);
      assert.equal(body.reflection.what_if, fallback.what_if);
      assert.ok(!carriesKey(res.text));
    }
  });

  test("the student's answers are saved, and the professor sees times and answers", async () => {
    // Case: one finished session with answers, and one still on question 1. The professor route has seconds for the first and nulls for the open one.
    reflectReply = JSON.stringify({ why: "Why did you add before recursing?", what_if: "What if sum_list got a nested list?", what_if_question: 1 });
    const done = await startSession("Fay");
    for (let i = 0; i < 3; i += 1) await call("POST", `/api/sessions/${done.session_id}/finish-question`);
    const early = await call("PUT", `/api/sessions/${(await startSession("Gus")).session_id}/reflection`, { why: "x", what_if: "y" });
    assert.equal(early.status, 409, "an unfinished session has nothing to answer");
    const saved = await call("PUT", `/api/sessions/${done.session_id}/reflection`, { why: "Adding first keeps the sum.", what_if: "I would flatten it first." });
    assert.equal(saved.status, 200);

    const res = await call("GET", `/api/prof/timings?assignment_id=${assignmentId}`);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.text);
    assert.equal(body.questions.length, 3);
    const fay = body.sessions.find((x: { display_name: string }) => x.display_name === "Fay");
    assert.equal(fay.seconds.length, 3);
    assert.ok(fay.seconds.every((n: number | null) => typeof n === "number" && n >= 0));
    assert.equal(typeof fay.total_seconds, "number");
    assert.equal(fay.reflection.answers.what_if, "I would flatten it first.");
    const gus = body.sessions.find((x: { display_name: string }) => x.display_name === "Gus");
    assert.deepEqual(gus.seconds, [null, null, null]);
    assert.equal(gus.completed_at, null);
    assert.equal(gus.total_seconds, null);
    assert.ok(!carriesKey(res.text));
  });

  test("an assignment with one question finishes on the first press", async () => {
    // Case: an assignment saved without `questions`, as every assignment before this feature was. It is one question, and Finish completes it.
    reflectReply = JSON.stringify({ why: "Why did you start with the base case?", what_if: "What if the list held strings?", what_if_question: 1 });
    const one = JSON.parse((await call("POST", "/api/prof/assignments", { ...THREE, title: "One question", questions: undefined })).text)._id;
    const s = JSON.parse((await call("POST", "/api/sessions", { assignment_id: one, display_name: "Hal" })).text);
    const res = JSON.parse((await call("POST", `/api/sessions/${s.session_id}/finish-question`)).text);
    assert.equal(res.done, true);
    assert.equal(res.reflection.what_if_index, 0);
  });
});

describe("secondsPerQuestion", () => {
  test("an open or unreached question is null, never a running total", () => {
    const t0 = new Date("2026-11-14T10:00:00Z");
    const t1 = new Date("2026-11-14T10:04:12Z");
    assert.deepEqual(
      secondsPerQuestion(
        [
          { index: 0, started_at: t0, finished_at: t1 },
          { index: 1, started_at: t1, finished_at: null },
        ],
        3,
      ),
      [252, null, null],
    );
  });
});
