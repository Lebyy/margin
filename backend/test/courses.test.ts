import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { CANARY } from "../src/models.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// The course portal: joining a class, My courses with due dates, the course
// page's assignment list with status, the professor's course cards, and the
// per-assignment Margin switch. Everything is made through the real routes.
// The scribe, tutor, judge, and coach are stand-ins that count their calls,
// so this file makes zero model calls. Skipped without MONGODB_URI.

const uri = testUri("margin_test_courses");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

const KEY = "Q = C V, so V = Q / C = 4.0e-6 / 2.0e-6 = 2.0 V";
const ELECTRO = {
  course_name: "Undergraduate Electrostatics 101",
  title: "Problem Set 3: Electrostatics",
  prompt: "A 2.0 μF capacitor holds 4.0 μC. Find the voltage across it.",
  kind: "math",
  answer_key: KEY,
  notes: "Lecture 3, slide 9: capacitance. C = Q / V.",
  concepts: ["capacitance"],
  hint_ceiling: 3,
};

describe("the course portal", { skip }, () => {
  let server: Server;
  let base: string;
  let courseId: string;
  let liveId: string;
  let offId: string;
  let laterId: string;
  const calls = { scribe: 0, tutor: 0, judge: 0 };

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp({
      offline: true,
      scribe: async () => {
        calls.scribe += 1;
        return JSON.stringify({ concept: "capacitance", struggle_type: "misconception", attempt_made: true, jailbreak_attempt: false, demonstrated_understanding: false, evidence: "" });
      },
      tutor: async () => {
        calls.tutor += 1;
        return "What does C = Q / V tell you about V?";
      },
      judge: async () => {
        calls.judge += 1;
        return JSON.stringify({ leaks: false, severity: "none", reason: "A question." });
      },
      coach: async () => JSON.stringify({ reteach_note: "Start from C = Q / V.", practice_problems: ["One.", "Two.", "Three."] }),
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const later = new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString();
    liveId = JSON.parse((await call("POST", "/api/prof/assignments", { ...ELECTRO, due_at: soon })).text)._id;
    offId = JSON.parse((await call("POST", "/api/prof/assignments", { ...ELECTRO, title: "Lab 1: Field lines", due_at: soon, margin_enabled: false })).text)._id;
    laterId = JSON.parse((await call("POST", "/api/prof/assignments", { ...ELECTRO, title: "Problem Set 4", due_at: later })).text)._id;
    courseId = JSON.parse((await call("GET", `/api/assignments/${liveId}`)).text).course_id;
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

  /** True if the body carries the key, the question keys field, or the canary. */
  function carriesKey(text: string): boolean {
    return text.includes("4.0e-6 / 2.0e-6") || text.includes("question_keys") || text.includes("\"answer_key\":") || text.includes(CANARY);
  }

  test("a course carries code, term, and an accent from the fixed set, and edits keep the rest", async () => {
    // Case: the professor sets a code and term. The accent comes from the id until one is chosen, and is always a token name.
    const saved = await call("POST", "/api/prof/courses", { id: courseId, name: ELECTRO.course_name, code: "PHYS 101", term: "Fall 2026" });
    assert.equal(saved.status, 200, saved.text);
    const course = JSON.parse((await call("GET", `/api/courses/${courseId}`)).text);
    assert.equal(course.code, "PHYS 101");
    assert.equal(course.term, "Fall 2026");
    assert.ok(["red", "blue", "green", "amber", "teal", "slate"].includes(course.accent));
    // An edit that leaves notes and description out keeps them.
    await call("POST", "/api/prof/courses", { id: courseId, name: ELECTRO.course_name, description: "Electrostatics.", notes: "Syllabus: Coulomb, Gauss, capacitance." });
    await call("POST", "/api/prof/courses", { id: courseId, name: ELECTRO.course_name, term: "Fall 2026" });
    const kept = JSON.parse((await call("GET", `/api/courses/${courseId}`)).text);
    assert.equal(kept.notes, "Syllabus: Coulomb, Gauss, capacitance.");
    assert.equal(kept.description, "Electrostatics.");
    const bad = await call("POST", "/api/prof/courses", { id: courseId, name: ELECTRO.course_name, accent: "#ff0000" });
    assert.equal(bad.status, 400, "an accent must be a token name, never a colour value");
  });

  test("joining puts the class in My courses with due-this-week and Due soon, and no key", async () => {
    // Case: a first visit joins with a name. Two assignments are due within a week, one in twenty days.
    const joined = await call("POST", `/api/courses/${courseId}/join`, { display_name: "Rae" });
    assert.equal(joined.status, 200);
    const { student_id } = JSON.parse(joined.text);
    const again = await call("POST", `/api/courses/${courseId}/join`, { student_id });
    assert.equal(again.status, 200, "joining twice is harmless");

    const mine = await call("GET", `/api/students/${student_id}/courses`);
    assert.equal(mine.status, 200);
    const body = JSON.parse(mine.text);
    assert.equal(body.courses.length, 1);
    assert.equal(body.courses[0].due_this_week, 2);
    assert.deepEqual(body.due_soon.map((a: { id: string }) => a.id).sort(), [liveId, offId, laterId].sort());
    assert.ok(!carriesKey(mine.text));
  });

  test("the course page lists work by due date with the student's status, and no key", async () => {
    // Case: one student starts the live assignment. It reads in progress for them and not started for anyone else.
    const s = JSON.parse((await call("POST", "/api/sessions", { assignment_id: liveId, display_name: "Sol" })).text);
    const forSol = await call("GET", `/api/courses/${courseId}?student_id=${s.student_id}`);
    const items = JSON.parse(forSol.text).items as { id: string; status: string; margin_enabled: boolean; due_at: string | null }[];
    assert.equal(items.at(-1)!.id, laterId, "the latest due date is last");
    assert.equal(items.find((i) => i.id === liveId)!.status, "in_progress");
    assert.equal(items.find((i) => i.id === offId)!.margin_enabled, false);
    assert.ok(!carriesKey(forSol.text));
    const anon = JSON.parse((await call("GET", `/api/courses/${courseId}`)).text).items as { status: string }[];
    assert.ok(anon.every((i) => i.status === "not_started"));

    // Starting a session enrolled Sol, so the class is in Sol's My courses.
    const mine = JSON.parse((await call("GET", `/api/students/${s.student_id}/courses`)).text);
    assert.equal(mine.courses[0].id, courseId);
  });

  test("the student assignment view has the due date and the switch, and no key", async () => {
    const res = await call("GET", `/api/assignments/${offId}`);
    const view = JSON.parse(res.text);
    assert.equal(view.margin_enabled, false);
    assert.ok(view.due_at);
    assert.ok(!carriesKey(res.text));
  });

  test("an assignment with Margin off never reaches the scribe, the tutor, or the judge", async () => {
    // Case: a session cannot be started on it, and a session that existed before it was switched off is refused too.
    const before = { ...calls };
    const start = await call("POST", "/api/sessions", { assignment_id: offId, display_name: "Ty" });
    assert.equal(start.status, 403);
    assert.equal(JSON.parse(start.text).error, "margin_disabled");

    const s = JSON.parse((await call("POST", "/api/sessions", { assignment_id: laterId, display_name: "Uma" })).text);
    await call("POST", "/api/prof/assignments", { ...ELECTRO, id: laterId, title: "Problem Set 4", answer_key: undefined, margin_enabled: false });
    for (const [method, path, body] of [
      ["POST", `/api/sessions/${s.session_id}/messages`, { text: "Help." }],
      ["POST", `/api/sessions/${s.session_id}/smaller`, undefined],
      ["POST", `/api/sessions/${s.session_id}/finish-question`, undefined],
    ] as const) {
      const res = await call(method, path, body);
      assert.equal(res.status, 403, path);
    }
    assert.deepEqual(calls, before, "no stand-in was called");
  });

  test("the professor's card shows the weakest concept from the newest Thursday card", async () => {
    // Case: before any card the class has no Margin data; after one, the card's concept and stored percent.
    const empty = JSON.parse((await call("GET", "/api/prof/courses")).text).courses.find((c: { id: string }) => c.id === courseId);
    assert.equal(empty.weakest, null);
    const s = JSON.parse((await call("POST", "/api/sessions", { assignment_id: liveId, display_name: "Vic" })).text);
    await call("POST", `/api/sessions/${s.session_id}/messages`, { text: "Is V = C / Q?" });
    const gen = await call("POST", `/api/prof/thursday-card?assignment_id=${liveId}`);
    assert.equal(gen.status, 201, gen.text);
    const card = JSON.parse((await call("GET", "/api/prof/courses")).text).courses.find((c: { id: string }) => c.id === courseId);
    assert.equal(card.weakest.concept, "capacitance");
    assert.equal(typeof card.weakest.percent_struggling, "number");
  });

  test("an edit that leaves out the due date and the switch keeps them", async () => {
    // Case: a form from before these fields saves the assignment again. Its due date and Margin-off setting stay.
    await call("POST", "/api/prof/assignments", { ...ELECTRO, id: offId, title: "Lab 1: Field lines", answer_key: undefined });
    const view = JSON.parse((await call("GET", `/api/assignments/${offId}`)).text);
    assert.equal(view.margin_enabled, false);
    assert.ok(view.due_at);
  });

  test("a named profile is one student, enrolled in its class, however often it is chosen", async () => {
    // Case: choosing the profile twice returns the same student and one enrollment. An unknown class is a 404 and creates no student.
    const first = await call("POST", "/api/profiles/students", { display_name: "Grace McKinney", course_name: ELECTRO.course_name });
    assert.equal(first.status, 200, first.text);
    const again = await call("POST", "/api/profiles/students", { display_name: "Grace McKinney", course_name: ELECTRO.course_name });
    assert.equal(JSON.parse(again.text).student_id, JSON.parse(first.text).student_id);
    const mine = JSON.parse((await call("GET", `/api/students/${JSON.parse(first.text).student_id}/courses`)).text);
    assert.deepEqual(mine.courses.map((c: { id: string }) => c.id), [courseId]);
    const missing = await call("POST", "/api/profiles/students", { display_name: "Nobody Yet", course_name: "No Such Class" });
    assert.equal(missing.status, 404);
  });

  test("an assignment cannot name a lecture that is not in its class", async () => {
    const res = await call("POST", "/api/prof/assignments", { ...ELECTRO, title: "Bad link", lecture_ids: ["6af8ba55c4d65a2cd5c63304"] });
    assert.equal(res.status, 400);
  });
});
