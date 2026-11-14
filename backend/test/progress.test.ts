import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { CANARY } from "../src/models.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// D-B7 done-when: GET /api/students/:id/progress for student A does not
// contain student B's quote. Both students take real turns through the
// message route, so the rows are the ones the product writes. The scribe,
// tutor, and judge are stand-ins, so no model credit is spent. Skipped without
// MONGODB_URI.

// Atlas caps database names at 38 bytes, and testUri adds about 15 more.
const uri = testUri("margin_test_progress");
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

// Each student's turn and the phrase the scribe quotes from it. The quotes
// are distinct so a leak of one into the other's progress is visible.
const A_TEXT = "I tried return xs[0] + sum_list(xs) and Ada's version loops forever";
const A_QUOTE = "Ada's version loops forever";
const B_TEXT = "my attempt returns None for Bob's empty list";
const B_QUOTE = "returns None for Bob's empty list";

describe("GET /api/students/:id/progress (D-B7)", { skip }, () => {
  let server: Server;
  let base: string;
  let studentA: string;
  let studentB: string;

  // The scribe stand-in quotes whichever student's text it was sent, so each
  // stored evidence string really comes from that student's turn.
  let current = { concept: "base_case", struggle: "misconception", quote: "" };

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp({
      scribe: async () =>
        JSON.stringify({
          concept: current.concept,
          struggle_type: current.struggle,
          attempt_made: true,
          jailbreak_attempt: false,
          demonstrated_understanding: false,
          evidence: current.quote,
        }),
      tutor: async () => "What happens when the list is empty?",
      judge: async () => JSON.stringify({ leaks: false, severity: "none", reason: "A question." }),
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const assignmentId = JSON.parse((await call("POST", "/api/prof/assignments", SUM_LIST)).text)._id;

    // Student A: one turn about recursive progress.
    const a = JSON.parse((await call("POST", "/api/sessions", { assignment_id: assignmentId, display_name: "Ada" })).text);
    studentA = a.student_id;
    current = { concept: "recursive_call_progress", struggle: "misconception", quote: A_QUOTE };
    assert.equal((await call("POST", `/api/sessions/${a.session_id}/messages`, { text: A_TEXT })).status, 200);

    // Student B: one turn about the base case, on the same assignment.
    const b = JSON.parse((await call("POST", "/api/sessions", { assignment_id: assignmentId, display_name: "Bob" })).text);
    studentB = b.student_id;
    current = { concept: "base_case", struggle: "stuck_starting", quote: B_QUOTE };
    assert.equal((await call("POST", `/api/sessions/${b.session_id}/messages`, { text: B_TEXT })).status, 200);
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

  test("student A's progress has A's quote and not B's", async () => {
    // Case: the done-when line. A's raw response contains A's quote, and
    // nothing of B: not B's quote, B's concept label, or B's name.
    const { status, text } = await call("GET", `/api/students/${studentA}/progress`);
    assert.equal(status, 200);
    assert.ok(text.includes(A_QUOTE), "A's own quote is missing");
    assert.ok(!text.includes(B_QUOTE), "A's progress contains B's quote");
    assert.ok(!text.includes("Bob"), "A's progress contains B's name");
    assert.ok(!text.includes(studentB), "A's progress contains B's id");
  });

  test("the progress lists concepts, struggle types, and levels, and nothing else of note", async () => {
    // Case: A's one turn. The label carries A's concept and struggle type, the
    // tutor answered it at level 2 (an attempt from level 1), and the session
    // shows the stored level. No key, canary, score, or integrity flag.
    const { text } = await call("GET", `/api/students/${studentA}/progress`);
    const body = JSON.parse(text);
    assert.equal(body.student_id, studentA);
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0].current_level, 2);
    assert.equal(body.sessions[0].assignment_title, SUM_LIST.title);
    assert.equal(body.labels.length, 1);
    assert.equal(body.labels[0].concept, "recursive_call_progress");
    assert.equal(body.labels[0].struggle_type, "misconception");
    assert.equal(body.labels[0].hint_level, 2);
    assert.equal(body.labels[0].session_id, body.sessions[0].session_id);

    assert.ok(!text.includes("answer_key") && !text.includes(CANARY) && !text.includes("if not xs"));
    assert.ok(!text.includes("jailbreak"), "the student log shows an integrity flag");
    assert.ok(!/score|rank|average|percent/i.test(text), "the student log compares the student to others");
  });

  test("student B's progress is only B's", async () => {
    // Case: the same check from the other side.
    const { text } = await call("GET", `/api/students/${studentB}/progress`);
    assert.ok(text.includes(B_QUOTE));
    assert.ok(!text.includes(A_QUOTE));
    assert.ok(!text.includes("Ada"));
  });

  test("an unknown or malformed student id is a 404", async () => {
    // Cases: an id with no student, and a string that is not an id.
    assert.equal((await call("GET", "/api/students/000000000000000000000000/progress")).status, 404);
    assert.equal((await call("GET", "/api/students/nope/progress")).status, 404);
  });
});
