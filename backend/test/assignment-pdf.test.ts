import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { Assignment, CANARY } from "../src/models.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";
import { twoPagePdf } from "./support/pdf.ts";

// Assignments made from a Question PDF and an Answer key PDF: the two-step
// draft, the preview that never carries an answer, saving into the class in
// the URL, editing, and the question sheet route. The PDF reader is a
// stand-in that counts its calls, so this file makes no model calls.
// Skipped without MONGODB_URI.

const uri = testUri("margin_test_assignment_pdf");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

const ANSWER_1 = "F = k q1 q2 / r^2 = 3.37 N, attractive, toward q2";
const ANSWER_2 = "E at the midpoint = 7.19e6 N/C, pointing toward q2";
const READ = {
  kind: "math",
  concepts: ["coulombs_law", "electric_field_superposition", "capacitance"],
  questions: [
    { prompt: "1. Find the force between q1 = +3.0 uC and q2 = -5.0 uC 0.20 m apart.", answer: ANSWER_1 },
    { prompt: "2. Find the field at the midpoint.", answer: ANSWER_2 },
  ],
};

describe("assignments from two PDFs", { skip }, () => {
  let server: Server;
  let base: string;
  let courseId: string;
  let reply: string = JSON.stringify(READ);
  let readerCalls = 0;
  const questionPdf = twoPagePdf(["1. Find the force between the charges", "2. Find the field at the midpoint"]);
  const answerPdf = twoPagePdf(["1. 3.37 N attractive", "2. 7.19e6 N/C toward q2"]);

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp({
      offline: true,
      assignmentReader: async () => {
        readerCalls += 1;
        return reply;
      },
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    courseId = JSON.parse((await json("POST", "/api/prof/courses", { name: "Undergraduate Electrostatics 101" })).text).id;
  });

  after(async () => {
    server.close();
    await dropTestDatabase();
    await disconnectDb();
  });

  async function json(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, text: await res.text() };
  }

  async function rawPdf(path: string, bytes: Buffer) {
    const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/pdf" }, body: new Uint8Array(bytes) });
    return { status: res.status, text: await res.text() };
  }

  /** Reads both PDFs into a draft and returns the preview body. */
  async function draft(): Promise<{ draft_id: string; questions: { prompt: string; has_answer: boolean }[]; concepts: string[]; kind: string }> {
    const opened = await rawPdf(`/api/prof/courses/${courseId}/assignment-drafts`, questionPdf);
    assert.equal(opened.status, 201, opened.text);
    const read = await rawPdf(`/api/prof/assignment-drafts/${JSON.parse(opened.text).draft_id}/answer-key`, answerPdf);
    assert.equal(read.status, 200, read.text);
    assert.ok(!read.text.includes(ANSWER_1) && !read.text.includes("3.37") && !read.text.includes(CANARY) && !read.text.includes("\"answer\":"), "the preview carries no answer");
    return JSON.parse(read.text);
  }

  test("the preview lists the questions and whether each answer was found, and nothing more", async () => {
    const preview = await draft();
    assert.deepEqual(preview.questions.map((q) => q.has_answer), [true, true]);
    assert.equal(preview.kind, "math");
    assert.deepEqual(preview.concepts, READ.concepts);
  });

  test("saving puts the questions and keys on an assignment in the class from the URL, with the full ladder", async () => {
    const preview = await draft();
    const saved = await json("POST", `/api/prof/courses/${courseId}/assignments`, { draft_id: preview.draft_id, title: "Problem Set 3", due_at: null, margin_enabled: true });
    assert.equal(saved.status, 201, saved.text);
    assert.ok(!saved.text.includes("3.37") && !saved.text.includes(CANARY));
    const doc = await Assignment.findById(JSON.parse(saved.text)._id).select("+answer_key +question_keys").lean();
    assert.equal(doc?.course_name, "Undergraduate Electrostatics 101");
    assert.equal(doc?.answer_key, ANSWER_1);
    assert.deepEqual(doc?.question_keys, [ANSWER_2]);
    assert.equal(doc?.hint_ceiling, 3);
    assert.ok(doc?.question_pdf_id);

    // Students see the questions and can open the sheet; the student view says a sheet exists and carries no key.
    const view = await json("GET", `/api/assignments/${doc!._id}`);
    assert.equal(JSON.parse(view.text).questions.length, 2);
    assert.equal(JSON.parse(view.text).has_question_pdf, true);
    assert.ok(!view.text.includes("3.37") && !view.text.includes("question_pdf_id"));
    const sheet = await fetch(`${base}/api/assignments/${doc!._id}/question-pdf`);
    assert.equal(sheet.status, 200);
    assert.deepEqual(Buffer.from(await sheet.arrayBuffer()), questionPdf);

    // A draft is used once.
    const again = await json("POST", `/api/prof/courses/${courseId}/assignments`, { draft_id: preview.draft_id, title: "Copy" });
    assert.equal(again.status, 400);
  });

  test("a non-PDF is refused, and a reader that fails saves nothing", async () => {
    assert.equal((await rawPdf(`/api/prof/courses/${courseId}/assignment-drafts`, Buffer.from("MZ not a pdf"))).status, 415);
    const opened = JSON.parse((await rawPdf(`/api/prof/courses/${courseId}/assignment-drafts`, questionPdf)).text);
    reply = "not json at all";
    const before = await Assignment.countDocuments();
    const read = await rawPdf(`/api/prof/assignment-drafts/${opened.draft_id}/answer-key`, answerPdf);
    reply = JSON.stringify(READ);
    assert.equal(read.status, 503);
    assert.equal((await json("POST", `/api/prof/courses/${courseId}/assignments`, { draft_id: opened.draft_id, title: "Half read" })).status, 400);
    assert.equal(await Assignment.countDocuments(), before);
  });

  test("an assignment typed in before PDFs cannot be saved until both PDFs are read", async () => {
    // Case: an older text assignment. Changing only its title is refused; with a draft it becomes a PDF assignment.
    const old = JSON.parse(
      (await json("POST", "/api/prof/assignments", { course_name: "Undergraduate Electrostatics 101", title: "Old set", prompt: "Find V.", kind: "math", answer_key: "V = 2.0 V", concepts: ["capacitance"] })).text,
    );
    assert.equal((await json("PATCH", `/api/prof/assignments/${old._id}`, { title: "Renamed" })).status, 400);
    const preview = await draft();
    const edited = await json("PATCH", `/api/prof/assignments/${old._id}`, { title: "Renamed", draft_id: preview.draft_id, margin_enabled: false });
    assert.equal(edited.status, 200, edited.text);
    const doc = await Assignment.findById(old._id).select("+answer_key").lean();
    assert.equal(doc?.title, "Renamed");
    assert.equal(doc?.answer_key, ANSWER_1);
    assert.equal(doc?.margin_enabled, false);
    assert.deepEqual(doc?.concepts, ["capacitance"], "an existing assignment keeps its concepts when its PDFs are replaced");
    // Now it has a sheet, a title-only edit is allowed and keeps the questions.
    assert.equal((await json("PATCH", `/api/prof/assignments/${old._id}`, { title: "Renamed again" })).status, 200);
    assert.equal((await Assignment.findById(old._id).select("+answer_key").lean())?.answer_key, ANSWER_1);
  });

  test("the reader was called once per pair of PDFs", () => {
    // Five drafts were read above (one of them failing), so five calls: none on save, edit, or the sheet.
    assert.equal(readerCalls, 5);
  });
});
