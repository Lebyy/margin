import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { CANARY, Session, Student } from "../src/models.ts";
import { START_LEVEL } from "../src/policy.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// D-B4 done-when: a second session for the same student and assignment is a
// new id, and the level stored on the row is START_LEVEL from policy.ts, the
// number the hint policy reads on the first message. The session never holds
// the answer key. Runs in a database unique to this process; skipped without
// MONGODB_URI.

// Atlas caps database names at 38 bytes, and testUri adds about 15 more.
const uri = testUri("margin_test_sessions");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

const KEY = "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])";
const SUM_LIST = {
  course_name: "Intro CS, Python recursion",
  title: "Write sum_list(xs) recursively",
  prompt: "Write sum_list(xs) recursively. It returns the sum of a list of numbers.",
  answer_key: KEY,
  notes: "Lecture 7, slides 12-16.",
  concepts: ["base_case", "recursive_call_progress", "return_value_propagation", "call_stack_tracing"],
  hint_ceiling: 3,
};

describe("POST /api/sessions (D-B4)", { skip }, () => {
  let server: Server;
  let base: string;
  let assignmentId: string;

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp({ offline: true }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // The assignment comes from the professor route, the same way the product
    // gets it. Nothing is inserted behind the API's back.
    const created = await post("/api/prof/assignments", SUM_LIST);
    assignmentId = JSON.parse(created.text)._id;
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

  test("a first visit creates the student and a session at START_LEVEL", async () => {
    // The case: a new student types their name and opens sum_list. One student
    // and one session appear, the row's level is START_LEVEL, and neither the
    // response nor the row carries the key.
    assert.equal(await Student.countDocuments(), 0);
    const { status, text } = await post("/api/sessions", { assignment_id: assignmentId, display_name: "Ada" });
    assert.equal(status, 201);
    assert.ok(!text.includes("answer_key") && !text.includes(CANARY) && !text.includes("sum_list(xs[1:])"));

    const body = JSON.parse(text);
    assert.equal(body.level, START_LEVEL);
    assert.equal(await Student.countDocuments(), 1);

    const row = await Session.findById(body.session_id).lean();
    assert.ok(row, "the session was not stored");
    assert.equal(row.current_level, START_LEVEL);
    assert.equal(String(row.student_id), body.student_id);
    assert.equal(String(row.assignment_id), assignmentId);
    assert.ok(!JSON.stringify(row).includes("sum_list(xs[1:])"), "the session row holds the key");
    assert.equal((row as Record<string, unknown>).answer_key, undefined);
  });

  test("a second session for the same pair is a new id at START_LEVEL", async () => {
    // The case: the same student comes back to the same assignment. They get a
    // new session id, start again at START_LEVEL, and no second student.
    const first = JSON.parse((await post("/api/sessions", { assignment_id: assignmentId, display_name: "Grace" })).text);
    const studentsBefore = await Student.countDocuments();

    const again = await post("/api/sessions", { assignment_id: assignmentId, student_id: first.student_id });
    assert.equal(again.status, 201);
    const second = JSON.parse(again.text);
    assert.notEqual(second.session_id, first.session_id);
    assert.equal(second.student_id, first.student_id);
    assert.equal(second.level, START_LEVEL);
    assert.equal(await Student.countDocuments(), studentsBefore);
    assert.equal(await Session.countDocuments({ student_id: first.student_id, assignment_id: assignmentId }), 2);
  });

  test("unknown ids and bad bodies are refused and create nothing", async () => {
    // The cases: an assignment that does not exist (with a new name, so no
    // student may be left behind), a student id that does not exist, both a
    // name and an id, neither, and a malformed assignment id.
    const students = await Student.countDocuments();
    const sessions = await Session.countDocuments();
    const missing = "000000000000000000000000";

    assert.equal((await post("/api/sessions", { assignment_id: missing, display_name: "Linus" })).status, 404);
    assert.equal((await post("/api/sessions", { assignment_id: assignmentId, student_id: missing })).status, 404);
    assert.equal(
      (await post("/api/sessions", { assignment_id: assignmentId, student_id: missing, display_name: "Linus" })).status,
      400,
    );
    assert.equal((await post("/api/sessions", { assignment_id: assignmentId })).status, 400);
    assert.equal((await post("/api/sessions", { assignment_id: "nope", display_name: "Linus" })).status, 400);

    assert.equal(await Student.countDocuments(), students);
    assert.equal(await Session.countDocuments(), sessions);
  });
});
