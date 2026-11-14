import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { Assignment, CANARY, Student } from "../src/models.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// D-B2 done-when: saving the sum_list assignment through
// POST /api/prof/assignments stores exactly one document, and the students
// collection stays empty, because only starting a session creates a student.
//
// Runs against the MONGODB_URI server in a database named for this process.
// node --test runs each file in its own process at the same time, so sharing
// models.test.ts's database would let one file's cleanup delete the other's
// documents mid-test. Without MONGODB_URI the suite is skipped, which means
// nothing was verified.

const uri = testUri("margin_test_assignments");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

// The assignment the board names for D-B2, as a professor would type it.
const KEY = "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])";
const SUM_LIST = {
  course_name: "Intro CS, Python recursion",
  title: "Write sum_list(xs) recursively",
  prompt: "Write sum_list(xs) recursively. It returns the sum of a list of numbers.",
  answer_key: KEY,
  notes: "Lecture 7, slides 12-16: every recursive function needs a base case and a call on a smaller input.",
  concepts: ["base_case", "recursive_call_progress", "return_value_propagation", "call_stack_tracing"],
  hint_ceiling: 3,
};

describe("POST /api/prof/assignments (D-B2)", { skip }, () => {
  let server: Server;
  let base: string;

  before(async () => {
    await connectDb(uri);
    // Start from an empty test database so the counts below mean this run.
    await clearCollections();
    server = createApp({ offline: true }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    await dropTestDatabase();
    await disconnectDb();
  });

  /** Posts JSON to the running app and returns status plus raw text. */
  async function post(path: string, body: unknown) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  }

  test("saving sum_list stores one document and creates no student", async () => {
    // The case: a professor saves the first assignment. One document, the
    // server's canary, the key stored but not echoed, and no students.
    const { status, text } = await post("/api/prof/assignments", SUM_LIST);
    assert.equal(status, 201);
    assert.ok(!text.includes("answer_key"), "the response names answer_key");
    assert.ok(!text.includes(CANARY), "the response contains the canary");
    assert.ok(!text.includes("sum_list(xs[1:])"), "the response contains the solution");

    assert.equal(await Assignment.countDocuments(), 1);
    const stored = await Assignment.findOne().select("+answer_key +canary").lean();
    assert.equal(stored?.answer_key, KEY);
    assert.equal(stored?.canary, CANARY);
    assert.deepEqual(stored?.concepts, SUM_LIST.concepts);
    assert.equal(stored?.hint_ceiling, 3);
    assert.equal(await Student.countDocuments(), 0);
  });

  test("a client cannot choose the canary or add unknown fields", async () => {
    // The case: a request sets its own canary and an is_synthetic flag. The
    // server stores its own canary and drops the extra field.
    const { status, text } = await post("/api/prof/assignments", {
      ...SUM_LIST,
      canary: "CLIENT_CHOSEN",
      is_synthetic: true,
    });
    assert.equal(status, 201);
    const id = JSON.parse(text)._id;
    const stored = await Assignment.findById(id).select("+canary").lean();
    assert.equal(stored?.canary, CANARY);
    assert.equal((stored as Record<string, unknown>).is_synthetic, undefined);
  });

  test("an incomplete or out-of-range assignment is rejected and not stored", async () => {
    // The cases: no answer key, a hint ceiling of 4, no concepts, a repeated
    // concept, and a body that is not JSON. Each is a 400 and stores nothing.
    const before = await Assignment.countDocuments();
    const { answer_key: _omit, ...noKey } = SUM_LIST;
    for (const body of [
      noKey,
      { ...SUM_LIST, hint_ceiling: 4 },
      { ...SUM_LIST, concepts: [] },
      { ...SUM_LIST, concepts: ["base_case", "base_case"] },
    ]) {
      const { status, text } = await post("/api/prof/assignments", body);
      assert.equal(status, 400, `expected 400 for ${JSON.stringify(Object.keys(body))}`);
      assert.ok(!text.includes("sum_list(xs[1:])"), "a rejection echoed the solution");
    }

    const bad = await fetch(base + "/api/prof/assignments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(bad.status, 400);
    assert.equal(await Assignment.countDocuments(), before);
  });

  test("twenty questions save and a twenty-first is refused", async () => {
    // The case: a full intro problem set is twenty questions, question 1 plus
    // nineteen later ones, and must save with every key kept in order. One
    // more is a 400 that stores nothing, so the cap the form shows is the cap
    // the server enforces.
    const later = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ prompt: `Question ${i + 2}: write f${i + 2}(x).`, answer_key: `def f${i + 2}(x):\n    return x * ${i + 2}` }));

    const ok = await post("/api/prof/assignments", { ...SUM_LIST, questions: later(19) });
    assert.equal(ok.status, 201);
    const stored = await Assignment.findById(JSON.parse(ok.text)._id).select("+question_keys").lean();
    assert.equal(stored?.questions.length, 19);
    assert.equal(stored?.question_keys?.[18], "def f20(x):\n    return x * 20");

    const before = await Assignment.countDocuments();
    const over = await post("/api/prof/assignments", { ...SUM_LIST, questions: later(20) });
    assert.equal(over.status, 400);
    assert.equal(await Assignment.countDocuments(), before);
  });
});
