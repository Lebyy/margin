import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { Assignment, CANARY } from "../src/models.ts";
import { searchNotes } from "../src/notes.ts";
import { MAX_NOTES_CHARS } from "../src/routes.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// D-B3 done-when: GET /api/assignments/:id is read as raw text, and the test
// fails if that text contains the key's field name, the canary, or any line
// of the solution. Reading text rather than parsed JSON matters: a key nested
// under another name, or pasted into the prompt, still fails the check.
// This was confirmed to go red by changing the student serializer
// (`findStudentAssignment`) to include `answer_key`.
//
// The same file covers the update half of POST /api/prof/assignments.
// Runs in a database unique to this process; skipped without MONGODB_URI.

// Atlas caps database names at 38 bytes, and testUri adds about 15 more.
const uri = testUri("margin_test_routes");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

const KEY = "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])";

// Every line of the key that would help a student, trimmed. `def sum_list(xs):`
// is left out on purpose: the prompt names the function, so its signature is
// already public and checking it would fail on the prompt, not on a leak.
const SOLUTION_LINES = KEY.split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("def "));

const SUM_LIST = {
  course_name: "Intro CS, Python recursion",
  title: "Write sum_list(xs) recursively",
  prompt: "Write sum_list(xs) recursively. It returns the sum of a list of numbers.",
  answer_key: KEY,
  notes: "Lecture 7, slides 12-16.",
  concepts: ["base_case", "recursive_call_progress", "return_value_propagation", "call_stack_tracing"],
  hint_ceiling: 3,
};

/** Fails if a response body carries the key name, the canary, or a solution line. */
function assertNoKey(text: string, where: string): void {
  assert.ok(!text.includes("answer_key"), `${where} names answer_key`);
  assert.ok(!text.includes(CANARY), `${where} contains the canary`);
  for (const line of SOLUTION_LINES) {
    assert.ok(!text.includes(line), `${where} contains the solution line "${line}"`);
  }
}

describe("assignment routes (D-B3)", { skip }, () => {
  let server: Server;
  let base: string;

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

  /** Creates the sum_list assignment through the route and returns its id. */
  async function createSumList(): Promise<string> {
    const { status, text } = await call("POST", "/api/prof/assignments", SUM_LIST);
    assert.equal(status, 201);
    return JSON.parse(text)._id;
  }

  test("the student view has the assignment and none of the key", async () => {
    // The case: a student opens sum_list. They get the prompt, notes, concepts,
    // and ceiling, and the raw body has no key name, canary, or solution line.
    const id = await createSumList();
    const { status, text } = await call("GET", `/api/assignments/${id}`);
    assert.equal(status, 200);
    assertNoKey(text, "the student view");

    const view = JSON.parse(text);
    assert.equal(view.id, id);
    assert.equal(view.title, SUM_LIST.title);
    assert.equal(view.prompt, SUM_LIST.prompt);
    assert.deepEqual(view.concepts, SUM_LIST.concepts);
    assert.equal(view.hint_ceiling, 3);
  });

  test("an unknown or malformed id is a 404", async () => {
    // The cases: a well-formed id with no assignment, and a string that is not
    // an id. Neither may become a 500 from a cast error.
    assert.equal((await call("GET", "/api/assignments/000000000000000000000000")).status, 404);
    assert.equal((await call("GET", "/api/assignments/not-an-id")).status, 404);
  });

  test("an edit without a key keeps the stored key and the canary", async () => {
    // The case: the professor fixes the title and lowers the ceiling. The form
    // never had the key, so it does not send one, and the key must survive.
    const id = await createSumList();
    const { answer_key: _omit, ...withoutKey } = SUM_LIST;
    const { status, text } = await call("POST", "/api/prof/assignments", {
      ...withoutKey,
      id,
      title: "sum_list, recursively",
      hint_ceiling: 2,
    });
    assert.equal(status, 200);
    assertNoKey(text, "the update response");

    const stored = await Assignment.findById(id).select("+answer_key +canary").lean();
    assert.equal(stored?.title, "sum_list, recursively");
    assert.equal(stored?.hint_ceiling, 2);
    assert.equal(stored?.answer_key, KEY);
    assert.equal(stored?.canary, CANARY);
    assert.equal(await Assignment.countDocuments({ _id: id }), 1);
  });

  test("an edit with a key replaces it, and a client canary is ignored", async () => {
    // The case: the professor corrects the solution and the request also tries
    // to set its own canary. The new key is stored; the canary is not changed.
    const id = await createSumList();
    const newKey = "def sum_list(xs):\n    return 0 if xs == [] else xs[0] + sum_list(xs[1:])";
    const { status } = await call("POST", "/api/prof/assignments", {
      ...SUM_LIST,
      id,
      answer_key: newKey,
      canary: "CLIENT_CHOSEN",
    });
    assert.equal(status, 200);
    const stored = await Assignment.findById(id).select("+answer_key +canary").lean();
    assert.equal(stored?.answer_key, newKey);
    assert.equal(stored?.canary, CANARY);
  });

  test("an edit of a missing or malformed id does not create anything", async () => {
    // The cases: an id with no assignment is a 404, a malformed id is a 400,
    // and neither adds a document.
    const count = await Assignment.countDocuments();
    const missing = await call("POST", "/api/prof/assignments", { ...SUM_LIST, id: "000000000000000000000000" });
    assert.equal(missing.status, 404);
    const malformed = await call("POST", "/api/prof/assignments", { ...SUM_LIST, id: "nope" });
    assert.equal(malformed.status, 400);
    assert.equal(await Assignment.countDocuments(), count);
  });

  test("a long notes paste is saved whole and searched for the citation (D-R5)", async () => {
    // Case: a lecture pasted at once, about 120 KB, with the base case slide
    // near the end. It saves, comes back unchanged on both reads, and the
    // level-2 search finds "Lecture 7" in the stored copy. One character over
    // the cap is a 400 naming the notes field, and nothing is stored.
    const filler = "This slide repeats the main point with another example from the reading. ";
    const lectures = Array.from({ length: 12 }, (_, l) =>
      [`Lecture ${l + 1}`, ...Array.from({ length: 12 }, (_, k) => `Slide ${k + 1}\n${filler.repeat(10)}`)].join("\n"),
    );
    lectures[6] += "\nSlide 13\nEvery recursive function needs a base case that returns without recursing.";
    const notes = lectures.join("\n\n");
    assert.ok(notes.length > 100_000);

    const created = await call("POST", "/api/prof/assignments", { ...SUM_LIST, notes });
    assert.equal(created.status, 201);
    const id = JSON.parse(created.text)._id;
    assert.equal(JSON.parse((await call("GET", `/api/assignments/${id}`)).text).notes, notes);
    assert.equal(JSON.parse((await call("GET", `/api/prof/assignments/${id}`)).text).notes, notes);
    const stored = await Assignment.findById(id).lean();
    assert.match(searchNotes(stored?.notes ?? "", "base case").split("\n\n")[0], /^Lecture 7, Slide 13/);

    const count = await Assignment.countDocuments();
    const tooLong = await call("POST", "/api/prof/assignments", { ...SUM_LIST, notes: "x".repeat(MAX_NOTES_CHARS + 1) });
    assert.equal(tooLong.status, 400);
    assert.ok(JSON.parse(tooLong.text).issues.some((i: { path: string }) => i.path === "notes"));
    assert.equal(await Assignment.countDocuments(), count);
  });
});
