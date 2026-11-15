import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { LocalStore, useBlobStore } from "../src/storage.ts";
import type { TutorDraft } from "../src/tutor.ts";
import type { AnalystRunner } from "../src/analyst.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// The professor's analytics include work done outside typed chat. One student
// turn carries canvas work (a picture and the words on the board) and an
// attached file, through the real message route. The scribe, tutor, and judge
// are stand-ins, so no model credit is spent; stored files go to a temporary
// folder. Skipped without MONGODB_URI.

const uri = testUri("margin_test_work");
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
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// The analyst stand-in calls its tools the way the model would, and keeps what they returned, so the test can check what the model would have seen.
let toolOutputs: string[] = [];
const analyst: AnalystRunner = async ({ tools }) => {
  toolOutputs = [];
  for (const t of tools) {
    const args = t.name === "student_work" ? { student: "S1" } : {};
    toolOutputs.push(String(await (t as { invoke: (a: unknown) => Promise<unknown> }).invoke(args)));
  }
  return { text: "S1 struggled with the base case on the canvas.", calls: [] };
};

describe("the professor's view of canvas and file work", { skip }, () => {
  let server: Server;
  let base: string;
  let assignmentId: string;
  let sessionId: string;
  let scribeSaw = "";
  let storeDir: string;

  before(async () => {
    storeDir = await mkdtemp(path.join(tmpdir(), "margin-work-"));
    useBlobStore(new LocalStore(storeDir));
    await connectDb(uri);
    await clearCollections();
    const draft: TutorDraft = {
      text: "I circled where your base case should be. What happens when the list is empty?",
      actions: [{ type: "mark", target: { element: "e1" }, shape: "circle", note: "What if xs is empty?", tone: "red" }],
      calls: [{ name: "mark_canvas", args: { shape: "circle" }, result: "Marked." }],
    };
    server = createApp({
      offline: true,
      scribe: async (request) => {
        scribeSaw = request.user;
        return JSON.stringify({ concept: "base_case", struggle_type: "misconception", attempt_made: true, jailbreak_attempt: false, demonstrated_understanding: false, evidence: "no base case" });
      },
      tutor: async () => draft,
      judge: async () => JSON.stringify({ leaks: false, severity: "none", reason: "A question and a mark." }),
      analyst,
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    assignmentId = JSON.parse((await call("POST", "/api/prof/assignments", SUM_LIST)).text)._id;
    const s = JSON.parse((await call("POST", "/api/sessions", { assignment_id: assignmentId, display_name: "Ada" })).text);
    sessionId = s.session_id;
    const file = JSON.parse((await call("POST", `/api/sessions/${sessionId}/attachments`, { name: "attempt.md", base64: Buffer.from("return xs[0] + sum_list(xs[1:])").toString("base64") })).text);
    const sent = await call("POST", `/api/sessions/${sessionId}/messages`, {
      text: "Check my canvas",
      attachments: [file.id],
      canvas: { summary: 'e1 | text | 0.1,0.1,0.5,0.1 | "sum_list(xs) = xs[0] + sum_list(xs[1:])"', image: { mimeType: "image/png", base64: PNG }, scene: [] },
    });
    assert.equal(sent.status, 200);
  });

  after(async () => {
    server.close();
    await dropTestDatabase();
    await disconnectDb();
    await rm(storeDir, { recursive: true, force: true });
  });

  async function call(method: string, p: string, body?: unknown) {
    const res = await fetch(base + p, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, text: await res.text(), type: res.headers.get("content-type") ?? "" };
  }

  test("the scribe labels the turn from the canvas and the file, not only the typed words", () => {
    // Case: the typed message is three words. The struggle label is built from the work, so the scribe has to have seen it.
    assert.match(scribeSaw, /canvas was shared with this message \(a picture of it is attached\)/);
    assert.match(scribeSaw, /Words on the canvas/);
    assert.match(scribeSaw, /\[attempt\.md\]/);
  });

  test("the work summary counts canvas work, files, and Askretes' marks in code", async () => {
    const res = await call("GET", `/api/prof/work-summary?assignment_id=${assignmentId}`);
    assert.equal(res.status, 200);
    const w = JSON.parse(res.text);
    assert.deepEqual(w.canvas, { students: 1, turns: 1, pictures: 1 });
    assert.equal(w.files.count, 1);
    assert.deepEqual(w.files.by_kind, { text: 1 });
    assert.equal(w.margin.marks, 1);
    assert.equal(w.concepts[0].concept, "base_case");
    assert.equal(w.concepts[0].students_struggling, 1);
    assert.equal(w.concepts[0].percent_struggling, 100);
    assert.deepEqual(w.recent.map((r: { kind: string }) => r.kind).sort(), ["canvas", "file"]);
    assert.deepEqual(w.recent.find((r: { kind: string }) => r.kind === "canvas").margin.notes, ["What if xs is empty?"]);
    // Case: the summary is about the class's work, and never carries the professor's key.
    assert.equal(res.text.includes("sum_list(xs[1:])\\n"), false);
    assert.equal(res.text.includes("if not xs"), false);
  });

  test("the canvas picture and the file are stored and served back", async () => {
    const w = JSON.parse((await call("GET", `/api/prof/work-summary?assignment_id=${assignmentId}`)).text);
    const canvas = w.recent.find((r: { kind: string }) => r.kind === "canvas");
    const picture = await call("GET", `/api/sessions/${sessionId}/messages/${canvas.message_id}/canvas-picture`);
    assert.equal(picture.status, 200);
    assert.equal(picture.type, "image/png");
    const file = w.recent.find((r: { kind: string }) => r.kind === "file");
    const stored = await call("GET", `/api/sessions/${sessionId}/attachments/${file.file.id}`);
    assert.equal(stored.status, 200);
    assert.match(stored.type, /^text\/plain/);
    assert.equal(stored.text, "return xs[0] + sum_list(xs[1:])");
  });

  test("the analyst reads the class through its tools, sees students only as labels, and keeps the conversation", async () => {
    const asked = await call("POST", `/api/prof/analyst?assignment_id=${assignmentId}`, { text: "Who is stuck and on what?" });
    assert.equal(asked.status, 200);
    const body = JSON.parse(asked.text);
    // Case: every tool ran and its record came back, and the page gets the label map to show the name.
    assert.deepEqual(body.tool_calls.map((c: { name: string }) => c.name), ["class_overview", "list_students", "student_work", "canvas_and_files", "assignment", "integrity_review"]);
    assert.equal(body.names.S1.name, "Ada");
    // Case: what the model saw names nobody, and never carries the answer key.
    const seen = toolOutputs.join("\n");
    assert.equal(seen.includes("Ada"), false);
    assert.match(seen, /"S1"/);
    assert.equal(seen.includes("if not xs"), false);
    // Case: the question and the answer are stored, with the tool record, and come back with the history.
    const history = JSON.parse((await call("GET", `/api/prof/analyst?assignment_id=${assignmentId}`)).text);
    assert.deepEqual(history.messages.map((m: { role: string }) => m.role), ["professor", "analyst"]);
    assert.equal(history.messages[1].tool_calls.length, 6);
  });
});
