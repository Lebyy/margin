import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import type { ClassRunner } from "../src/class-assistant.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { Assignment } from "../src/models.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// A professor makes an assignment by asking for it in the class chat, then
// reviews and posts it. The chat model and the assignment reader are
// stand-ins, so no model is called. Skipped without MONGODB_URI.

const uri = testUri("margin_test_classchat");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

// The chat stand-in drafts the way the model would: it calls draft_assignment with the questions the professor typed.
const classChat: ClassRunner = async ({ tools }) => {
  const draft = tools.find((t) => t.name === "draft_assignment") as { invoke: (a: unknown) => Promise<unknown> };
  const out = String(await draft.invoke({ title: "Problem Set 4", questions_text: "1. Find $E$ at $r = 3$ m.\n2. State Gauss's law.", due_at: "2026-11-20T23:59:00.000Z" }));
  return { text: `Drafted. ${out}` };
};

// The reader stand-in splits the questions; there is no key, so both answers are empty.
const assignmentReader = async () =>
  JSON.stringify({
    kind: "math",
    concepts: ["electric_field", "gauss_law", "flux"],
    questions: [
      { prompt: "Find $E$ at $r = 3$ m.", answer: "" },
      { prompt: "State Gauss's law.", answer: "" },
    ],
  });

describe("making an assignment from the class chat", { skip }, () => {
  let server: Server;
  let base: string;
  let courseId: string;

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp({ offline: true, classChat, assignmentReader }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    courseId = JSON.parse((await call("POST", "/api/prof/courses", { name: "PHYS 102", description: "", notes: "" })).text).id;
  });

  after(async () => {
    server.close();
    await dropTestDatabase();
    await disconnectDb();
  });

  async function call(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, text: await res.text() };
  }

  test("the chat drafts it, the professor edits a question and posts it, and the conversation is kept", async () => {
    const asked = await call("POST", `/api/prof/courses/${courseId}/chat`, { text: "Make Problem Set 4 from these questions, due the 20th." });
    assert.equal(asked.status, 200);
    const { draft } = JSON.parse(asked.text);
    // Case: the draft is the preview, typeset-ready, and says no question has a key. No answer is in the body.
    assert.equal(draft.title, "Problem Set 4");
    assert.equal(draft.questions.length, 2);
    assert.equal(draft.missing_answers, 2);
    assert.match(draft.questions[0].prompt, /\$E\$/);

    // Case: the professor rewords question 2 in the builder and posts. A missing key does not block saving.
    const posted = await call("POST", `/api/prof/courses/${courseId}/assignments`, { draft_id: draft.draft_id, title: draft.title, due_at: draft.due_at, margin_enabled: true, questions: [draft.questions[0].prompt, "State Gauss's law in words and as an equation."] });
    assert.equal(posted.status, 201);
    const saved = await Assignment.findById(JSON.parse(posted.text)._id).select("+answer_key").lean();
    assert.equal(saved?.questions?.[0]?.prompt, "State Gauss's law in words and as an equation.");
    assert.equal(saved?.answer_key, "");

    const history = JSON.parse((await call("GET", `/api/prof/courses/${courseId}/chat`)).text);
    assert.deepEqual(history.messages.map((m: { role: string }) => m.role), ["professor", "analyst"]);
    assert.equal(history.messages[1].draft.draft_id, draft.draft_id);
  });
});
