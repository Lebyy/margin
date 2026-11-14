import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { CANARY } from "../src/models.ts";
import { slideNotes, titleFromFilename } from "../src/slides.ts";
import { searchNotes } from "../src/notes.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";
import { twoPagePdf } from "./support/pdf.ts";

// Lecture slides: upload checks, per-page text, the file route, linking a
// lecture to an assignment, and the level-2 citation that names a real
// lecture and page. The tutor and judge are stand-ins, so this file makes no
// model calls. Skipped without MONGODB_URI.

const uri = testUri("margin_test_slides");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

const KEY = "Q = C V, so V = Q / C = 4.0e-6 / 2.0e-6 = 2.0 V";

describe("lecture slides", { skip }, () => {
  let server: Server;
  let base: string;
  let courseId: string;
  let otherCourseId: string;
  let assignmentId: string;
  let lectureId: string;
  const pdf = twoPagePdf(["Coulomb law: like charges repel", "Capacitance: C equals Q over V"]);
  let tutorNotes: string[] = [];

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp({
      offline: true,
      scribe: async () => JSON.stringify({ concept: "capacitance", struggle_type: "misconception", attempt_made: true, jailbreak_attempt: false, demonstrated_understanding: false, evidence: "" }),
      tutor: async (call) => {
        tutorNotes.push(call.notes);
        return "Look at [Lecture 3, slide 2] for what C = Q / V says about V.";
      },
      judge: async () => JSON.stringify({ leaks: false, severity: "none", reason: "A pointer." }),
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    courseId = JSON.parse((await json("POST", "/api/prof/courses", { name: "Undergraduate Electrostatics 101" })).text).id;
    otherCourseId = JSON.parse((await json("POST", "/api/prof/courses", { name: "Calculus I" })).text).id;
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

  async function upload(bytes: Buffer, type: string, query = "") {
    const res = await fetch(`${base}/api/prof/courses/${courseId}/lectures${query}`, { method: "POST", headers: { "content-type": type }, body: new Uint8Array(bytes) });
    return { status: res.status, text: await res.text() };
  }

  test("an upload that is not a PDF is refused, whatever it is called", async () => {
    // Case one: text bytes declared as a PDF. Case two: an executable's MZ header sent as lecture.pdf. Case three: a real PDF declared as text.
    assert.equal((await upload(Buffer.from("just some notes"), "application/pdf", "?filename=notes.pdf")).status, 415);
    assert.equal((await upload(Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(200)]), "application/pdf", "?filename=lecture.pdf")).status, 415);
    assert.equal((await upload(pdf, "text/plain")).status, 415);
    // Case four: a file that starts like a PDF but is not one pdf.js can open.
    assert.equal((await upload(Buffer.from("%PDF-1.4\nthis is not a pdf body"), "application/pdf")).status, 422);
    const listed = JSON.parse((await json("GET", `/api/courses/${courseId}/lectures`)).text).lectures;
    assert.equal(listed.length, 0, "nothing was stored by a refused upload");
  });

  test("an upload over 20 MB is refused", async () => {
    const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(20 * 1024 * 1024 + 10)]);
    assert.equal((await upload(big, "application/pdf")).status, 413);
  });

  test("a PDF is stored under a random id, read per page, and served back unchanged", async () => {
    // Case: the file name tries to climb out of a directory. It only becomes a cleaned title.
    const res = await upload(pdf, "application/pdf", `?filename=${encodeURIComponent("../../etc/passwd.pdf")}&lecture_number=3&lecture_date=2026-11-10`);
    assert.equal(res.status, 201, res.text);
    const lecture = JSON.parse(res.text);
    lectureId = lecture.id;
    assert.equal(lecture.title, "passwd");
    assert.equal(lecture.lecture_number, 3);
    assert.equal(lecture.page_count, 2);
    assert.equal(lecture.unreadable_pages, 0);
    assert.equal(lecture.lecture_date, "2026-11-10");

    const file = await fetch(`${base}/api/courses/${courseId}/lectures/${lectureId}/file`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "application/pdf");
    assert.equal(file.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf);

    // The same lecture through another class's URL is not served.
    assert.equal((await fetch(`${base}/api/courses/${otherCourseId}/lectures/${lectureId}/file`)).status, 404);
  });

  test("a professor renames and renumbers a lecture", async () => {
    const res = await json("PATCH", `/api/prof/lectures/${lectureId}`, { title: "Electrostatics", lecture_number: 3 });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.text).title, "Electrostatics");
  });

  test("an assignment that covers the lecture gives the tutor its slides, labelled by lecture and page", async () => {
    // Case: the assignment links Lecture 3. Its notes are empty, so the slides are what the level-2 search reads.
    const saved = await json("POST", "/api/prof/assignments", {
      course_name: "Undergraduate Electrostatics 101",
      title: "Problem Set 3",
      prompt: "A 2.0 μF capacitor holds 4.0 μC. Find the voltage.",
      kind: "math",
      answer_key: KEY,
      notes: "",
      concepts: ["capacitance"],
      hint_ceiling: 3,
      lecture_ids: [lectureId],
    });
    assert.equal(saved.status, 201, saved.text);
    assignmentId = JSON.parse(saved.text)._id;
    const s = JSON.parse((await json("POST", "/api/sessions", { assignment_id: assignmentId, display_name: "Wen" })).text);
    tutorNotes = [];
    const turn = await json("POST", `/api/sessions/${s.session_id}/messages`, { text: "How do I find V?", attempt: "V = C / Q = 0.5" });
    assert.equal(turn.status, 200, turn.text);
    assert.ok(tutorNotes.some((n) => n.includes("Lecture 3, slide 2: Capacitance")), "the tutor saw page 2 under its label");

    // The level-2 search over those notes cites the page, and that page exists.
    const cited = searchNotes(tutorNotes.at(-1) ?? "", "capacitance");
    assert.match(cited, /Lecture 3, slide 2/);
    const reply = JSON.parse(turn.text).reply as string;
    const m = /\[Lecture (\d+), slide (\d+)\]/.exec(reply);
    assert.ok(m, "the reply carries a bracketed citation");
    const lectures = JSON.parse((await json("GET", `/api/courses/${courseId}/lectures`)).text).lectures as { lecture_number: number; page_count: number }[];
    const target = lectures.find((l) => l.lecture_number === Number(m![1]));
    assert.ok(target && Number(m![2]) <= target.page_count, "the citation resolves to an existing lecture and page");
  });

  test("lecture routes carry no answer key", async () => {
    for (const path of [`/api/courses/${courseId}/lectures`, `/api/courses/${courseId}`, `/api/assignments/${assignmentId}`]) {
      const text = (await json("GET", path)).text;
      assert.ok(!text.includes("4.0e-6 / 2.0e-6") && !text.includes(CANARY) && !text.includes("question_keys"), path);
    }
  });

  test("deleting a lecture removes its file and unlinks it from the assignment", async () => {
    assert.equal((await json("DELETE", `/api/prof/lectures/${lectureId}`)).status, 204);
    assert.equal((await fetch(`${base}/api/courses/${courseId}/lectures/${lectureId}/file`)).status, 404);
    const again = await json("POST", "/api/prof/assignments", {
      id: assignmentId,
      course_name: "Undergraduate Electrostatics 101",
      title: "Problem Set 3",
      prompt: "A 2.0 μF capacitor holds 4.0 μC. Find the voltage.",
      kind: "math",
      notes: "",
      concepts: ["capacitance"],
    });
    assert.equal(again.status, 200, "the stored lecture list no longer names the deleted lecture");
  });
});

describe("slide text helpers", () => {
  test("a file name is a title, never a path", () => {
    assert.equal(titleFromFilename("../../etc/passwd.pdf"), "passwd");
    assert.equal(titleFromFilename("C:\\decks\\lecture_3_electrostatics.PDF"), "lecture 3 electrostatics");
    assert.equal(titleFromFilename(".."), "Lecture slides");
  });

  test("slide notes label each page and skip pages with no text", () => {
    const notes = slideNotes([{ lecture_number: 3, pages: [{ page_number: 1, text: "Title" }, { page_number: 2, text: "" }, { page_number: 3, text: "Gauss's law\nFlux through a closed surface" }] }]);
    assert.match(notes, /^Lecture 3, slide 1: Title/);
    assert.ok(!notes.includes("slide 2"));
    assert.match(searchNotes(notes, "flux"), /Lecture 3, slide 3/);
  });
});
