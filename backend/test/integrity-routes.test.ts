import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { trapToken } from "../src/integrity.ts";
import { Message, Session } from "../src/models.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// The integrity record through the real routes. The student page receives the
// copy notes and nothing else: no clock, no activity, no typing record. The
// professor's review reads what the page reported and what the server saw.
// The scribe, tutor, and judge are stand-ins, so no model is called.
// Skipped without MONGODB_URI.

const uri = testUri("margin_test_integrity");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

const ASSIGNMENT = {
  course_name: "Intro CS",
  title: "Temperatures",
  prompt: "Write `celsius_to_fahrenheit(c)`.",
  answer_key: "def celsius_to_fahrenheit(c):\n    return c * 9 / 5 + 32",
  notes: "",
  concepts: ["base_case", "recursive_call_progress", "return_value_propagation", "call_stack_tracing"],
  hint_ceiling: 3,
  questions: [{ prompt: "Write `is_even(n)`.", answer_key: "def is_even(n):\n    return n % 2 == 0" }],
};

describe("the integrity record", { skip }, () => {
  let server: Server;
  let base: string;
  let assignmentId: string;

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp({
      offline: true,
      scribe: async () => JSON.stringify({ concept: "base_case", struggle_type: "stuck_starting", evidence: "", attempt_made: false, jailbreak_attempt: false, demonstrated_understanding: false }),
      tutor: async () => "What does the formula do to 100 degrees?",
      judge: async () => JSON.stringify({ leaks: false, severity: "none", reason: "A question." }),
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assignmentId = JSON.parse((await call("POST", "/api/prof/assignments", ASSIGNMENT)).text)._id;
  });

  after(async () => {
    server.close();
    await dropTestDatabase();
    await disconnectDb();
  });

  async function call(method: string, path: string, body?: unknown, type = "application/json") {
    const res = await fetch(base + path, { method, headers: body === undefined ? {} : { "content-type": type }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    return { status: res.status, text: await res.text() };
  }

  test("the student page gets the copy notes and never the clock or the typing record", async () => {
    const started = await call("POST", "/api/sessions", { assignment_id: assignmentId, display_name: "Ada" });
    assert.equal(started.status, 201);
    const s = JSON.parse(started.text);
    // Case: one note per question, each carrying that question's token.
    assert.equal(s.copy_notes.length, 2);
    assert.ok(s.copy_notes[1].includes(trapToken(s.session_id, 1)));

    // Case: a typed turn with its typing record, and an activity report sent the way sendBeacon sends it (text/plain).
    const text = "I am not sure where the 32 goes";
    const typing = { keys: 40, typed: 36, inserted: 0, filled: 0, deleted: 5, synthetic: 0, paste_blocked: 2, compose_ms: 20_000, iki_n: 30, iki_median_ms: 170, iki_cv_milli: 900, away_ms: 0, longest_away_ms: 0, typed_after_away: 0 };
    const turn = await call("POST", `/api/sessions/${s.session_id}/messages`, { text, typing });
    assert.equal(turn.status, 200, turn.text);
    const beacon = await call("POST", `/api/sessions/${s.session_id}/activity`, JSON.stringify({ question_index: 0, active_ms: 30_000, away_ms: 4000, away_count: 1, longest_away_ms: 4000, paste_blocked: 2, copies: 1 }), "text/plain");
    assert.equal(beacon.status, 204);
    assert.equal(beacon.text, "");

    // Case: a report for a question the student has not reached adds nothing.
    await call("POST", `/api/sessions/${s.session_id}/activity`, { question_index: 1, active_ms: 600_000, away_ms: 0, away_count: 0, longest_away_ms: 0, paste_blocked: 0, copies: 0 });
    const stored = await Session.findById(s.session_id).lean();
    assert.deepEqual(stored?.activity, [{ index: 0, active_ms: 30_000, away_ms: 4000, away_count: 1, longest_away_ms: 4000, paste_blocked: 2, copies: 1 }]);
    const saved = await Message.findOne({ session_id: s.session_id, role: "student" }).lean();
    assert.equal((saved?.typing as { untracked: number }).untracked, 0);

    // Every body the student page reads: none mentions the clock, activity, or typing.
    for (const body of [started.text, turn.text, (await call("GET", `/api/sessions/${s.session_id}/messages`)).text, (await call("POST", `/api/sessions/${s.session_id}/finish-question`, {})).text]) {
      for (const field of ["question_times", "activity", "typing", "active_ms", "away_ms", "integrity", "seconds"]) {
        assert.ok(!body.includes(`"${field}"`), `a student body carried ${field}`);
      }
    }
  });

  test("the professor's review shows evidence for the copy trap and for text that was never typed, and the accommodation switch", async () => {
    const s = JSON.parse((await call("POST", "/api/sessions", { assignment_id: assignmentId, display_name: "Bo" })).text);
    const answer = `def celsius_to_fahrenheit(c):\n    ${trapToken(s.session_id, 0)} = c * 1.8\n    return ${trapToken(s.session_id, 0)} + 32`;
    // Case: the text arrived with a typing record that explains five characters of it.
    const typing = { keys: 5, typed: 5, inserted: 0, filled: 0, deleted: 0, synthetic: 0, paste_blocked: 0, compose_ms: 3000, iki_n: 4, iki_median_ms: 100, iki_cv_milli: 700, away_ms: 0, longest_away_ms: 0, typed_after_away: 0 };
    assert.equal((await call("POST", `/api/sessions/${s.session_id}/messages`, { text: answer, typing })).status, 200);

    const report = JSON.parse((await call("GET", `/api/prof/integrity?assignment_id=${assignmentId}`)).text);
    const bo = report.students.find((r: { display_name: string }) => r.display_name === "Bo");
    assert.equal(bo.level, "evidence");
    assert.deepEqual(bo.findings.map((f: { code: string }) => f.code).sort(), ["copy_trap", "untracked_text"]);
    // Evidence is listed first; Ada, who typed her question, is clear.
    assert.equal(report.students[0].display_name, "Bo");
    assert.equal(report.students.find((r: { display_name: string }) => r.display_name === "Ada").level, "clear");

    // Case: the accommodation hides the typing finding and keeps the trap.
    assert.equal((await call("PUT", `/api/prof/sessions/${s.session_id}/integrity-exempt`, { exempt: true })).status, 200);
    const after = JSON.parse((await call("GET", `/api/prof/integrity?assignment_id=${assignmentId}`)).text);
    const bo2 = after.students.find((r: { display_name: string }) => r.display_name === "Bo");
    assert.deepEqual(bo2.findings.map((f: { code: string }) => f.code), ["copy_trap"]);
    assert.equal(bo2.exempt, true);
  });
});
