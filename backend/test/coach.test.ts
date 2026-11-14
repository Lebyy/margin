import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it, test } from "node:test";
import { createApp } from "../src/app.ts";
import { statesStatistic } from "../src/coach.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { ProfessorMessage, ThursdayCard } from "../src/models.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// D-B8 done-when:
//   - a coach stand-in that returns different percents cannot change the
//     stored percents,
//   - the card names the weakest concept among the sessions that exist.
// The class is built through the real routes: four students start sessions
// and take turns through the message route. The scribe, tutor, judge, and
// coach are stand-ins, so no model credit is spent. Skipped without MONGODB_URI.

describe("statesStatistic", () => {
  it("flags a percent or an N-of-M count and passes ordinary numbers", () => {
    // Cases: the shapes a model would use to restate the class numbers, and
    // the numbers a practice problem or a slide reference legitimately has.
    assert.equal(statesStatistic("90% of students missed it"), true);
    assert.equal(statesStatistic("about 40 percent struggled"), true);
    assert.equal(statesStatistic("3 of 4 students"), true);
    assert.equal(statesStatistic("7 out of 10 students"), true);
    assert.equal(statesStatistic("Write count_list for [1, 2, 3]."), false);
    assert.equal(statesStatistic("Review Lecture 7, slides 12-16."), false);
  });
});

// Atlas caps database names at 38 bytes, and testUri adds about 15 more.
const uri = testUri("margin_test_coach");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

const SUM_LIST = {
  course_name: "Intro CS, Python recursion",
  title: "Write sum_list(xs) recursively",
  prompt: "Write sum_list(xs) recursively. It returns the sum of a list of numbers.",
  answer_key: "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])",
  notes: "Lecture 7, slides 12-16.",
  concepts: ["base_case", "recursive_call_progress", "return_value_propagation", "call_stack_tracing"],
  hint_ceiling: 3,
};

const PROBLEMS = [
  "Write count_list(xs) recursively: how many items are in xs?",
  "Write max_list(xs) recursively for a non-empty list.",
  "Write reverse_string(s) recursively.",
];

describe("class summary and Thursday card (D-B8)", { skip }, () => {
  let server: Server;
  let base: string;
  let sumListId: string;
  let emptyId: string;

  // What the stand-ins answer. Set per turn and per test.
  let scribeLabel = { concept: "base_case", struggle_type: "misconception", evidence: "" };
  let coachReply = "";
  let coachSent = "";

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp({
      scribe: async () =>
        JSON.stringify({
          ...scribeLabel,
          attempt_made: true,
          jailbreak_attempt: false,
          demonstrated_understanding: false,
        }),
      tutor: async () => "What happens when the list is empty?",
      judge: async () => JSON.stringify({ leaks: false, severity: "none", reason: "A question." }),
      coach: async ({ system, user }) => {
        coachSent = `${system}\n${user}`;
        return coachReply;
      },
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    sumListId = JSON.parse((await call("POST", "/api/prof/assignments", SUM_LIST)).text)._id;
    emptyId = JSON.parse((await call("POST", "/api/prof/assignments", { ...SUM_LIST, title: "Nobody has opened this" })).text)._id;

    // The class: four students open sum_list.
    //   Ada: two base_case misconception turns (counts once for base_case).
    //   Bob: one base_case stuck_starting turn.
    //   Cy:  one recursive_call_progress misconception turn.
    //   Dee: opens the assignment and sends nothing.
    // So base_case is 2 of 4 students (50%), recursive_call_progress 1 of 4 (25%).
    const turns: [string, string, string, string][] = [
      ["Ada", "base_case", "misconception", "Ada thinks the empty list returns None"],
      ["Ada", "base_case", "misconception", "Ada still returns None for []"],
      ["Bob", "base_case", "stuck_starting", "Bob does not know where to stop"],
      ["Cy", "recursive_call_progress", "misconception", "Cy calls sum_list(xs) again"],
    ];
    const sessions = new Map<string, string>();
    for (const name of ["Ada", "Bob", "Cy", "Dee"]) {
      const s = JSON.parse((await call("POST", "/api/sessions", { assignment_id: sumListId, display_name: name })).text);
      sessions.set(name, s.session_id);
    }
    for (const [name, concept, struggle, text] of turns) {
      scribeLabel = { concept, struggle_type: struggle, evidence: text };
      const res = await call("POST", `/api/sessions/${sessions.get(name)}/messages`, { text });
      assert.equal(res.status, 200);
    }
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

  test("the class summary is counted in code from the sessions that exist", async () => {
    // Case: the class above. Four students, base_case 2 of 4, progress 1 of 4,
    // the other two concepts zero, and Ada's two turns count her once.
    const { status, text } = await call("GET", `/api/prof/class-summary?assignment_id=${sumListId}`);
    assert.equal(status, 200);
    const summary = JSON.parse(text);
    assert.equal(summary.total_students, 4);
    assert.equal(summary.total_turns, 4);
    const row = (c: string) => summary.concepts.find((x: { concept: string }) => x.concept === c);
    assert.deepEqual(summary.concepts.map((c: { concept: string }) => c.concept), SUM_LIST.concepts);
    assert.equal(row("base_case").students_struggling, 2);
    assert.equal(row("base_case").percent_struggling, 50);
    assert.equal(row("base_case").turns, 3);
    assert.equal(row("base_case").struggle_types.misconception, 2);
    assert.equal(row("base_case").struggle_types.stuck_starting, 1);
    assert.equal(row("recursive_call_progress").percent_struggling, 25);
    assert.equal(row("call_stack_tracing").percent_struggling, 0);
    assert.ok(!text.includes("Ada") && !text.includes("None for []"), "the summary carries a name or a quote");
  });

  test("a coach that returns different percents cannot change the stored percents", async () => {
    // Case: the done-when line. The stand-in coach adds its own numbers as
    // extra fields. The stored card keeps 50% and 2 of 4, names base_case,
    // and one professor message with the same numbers is written.
    coachReply = JSON.stringify({
      reteach_note: "Walk through what sum_list([]) should return before any recursive call.",
      practice_problems: PROBLEMS,
      percent_struggling: 99,
      students_struggling: 40,
      total_students: 41,
      concept: "call_stack_tracing",
    });
    const { status, text } = await call("POST", `/api/prof/thursday-card?assignment_id=${sumListId}`);
    assert.equal(status, 201);
    const card = JSON.parse(text);
    assert.equal(card.concept, "base_case");
    assert.equal(card.percent_struggling, 50);
    assert.equal(card.students_struggling, 2);
    assert.equal(card.total_students, 4);
    assert.deepEqual(card.practice_problems, PROBLEMS);
    assert.ok(!text.includes("99") && !text.includes("41"), "a model number reached the card");

    const stored = await ThursdayCard.findById(card.card_id).lean();
    const payload = stored?.payload as Record<string, unknown>;
    assert.equal(payload.percent_struggling, 50);
    assert.equal(payload.students_struggling, 2);
    assert.equal(payload.concept, "base_case");

    const messages = await ProfessorMessage.find({ assignment_id: sumListId }).lean();
    assert.equal(messages.length, 1);
    assert.match(messages[0].body, /50% of your class \(2 of 4 students\) struggled with base_case/);
    for (const p of PROBLEMS) assert.ok(messages[0].body.includes(p));

    // The coach got the concept and the counts, and nothing about a student.
    assert.ok(coachSent.includes("base_case") && coachSent.includes("2 of 4 students"));
    assert.ok(!coachSent.includes("Ada") && !coachSent.includes("returns None"), "the coach prompt carries a name or a quote");
  });

  test("a note that states its own statistic is replaced, not stored", async () => {
    // Case: the stand-in writes "90% of the class" into the prose. That note
    // is dropped for a sentence written in code; the numbers stay 50 and 2 of 4.
    coachReply = JSON.stringify({
      reteach_note: "90% of the class forgot the base case, so reteach it.",
      practice_problems: PROBLEMS,
    });
    const { status, text } = await call("POST", `/api/prof/thursday-card?assignment_id=${sumListId}`);
    assert.equal(status, 201);
    assert.ok(!text.includes("90%"));
    const card = JSON.parse(text);
    assert.equal(card.percent_struggling, 50);
    assert.match(card.reteach_note, /^Reteach base_case/);
  });

  test("no card is invented for an assignment nobody has struggled with", async () => {
    // Case: an assignment with no sessions. The summary is all zeros, the card
    // is a 409, and no card or message is stored.
    const summary = JSON.parse((await call("GET", `/api/prof/class-summary?assignment_id=${emptyId}`)).text);
    assert.equal(summary.total_students, 0);
    assert.ok(summary.concepts.every((c: { percent_struggling: number }) => c.percent_struggling === 0));

    const { status, text } = await call("POST", `/api/prof/thursday-card?assignment_id=${emptyId}`);
    assert.equal(status, 409);
    assert.deepEqual(JSON.parse(text), { error: "no_struggles_yet" });
    assert.equal(await ThursdayCard.countDocuments({ assignment_id: emptyId }), 0);
    assert.equal(await ProfessorMessage.countDocuments({ assignment_id: emptyId }), 0);
  });

  test("a coach failure stores nothing", async () => {
    // Case: the model answers prose twice. The route is a 503 and neither a
    // card nor a message is written.
    const cards = await ThursdayCard.countDocuments();
    const messages = await ProfessorMessage.countDocuments();
    coachReply = "Here is your card!";
    const { status } = await call("POST", `/api/prof/thursday-card?assignment_id=${sumListId}`);
    assert.equal(status, 503);
    assert.equal(await ThursdayCard.countDocuments(), cards);
    assert.equal(await ProfessorMessage.countDocuments(), messages);
  });

  test("an unknown or malformed assignment is a 404 on both routes", async () => {
    // Cases: an id with no assignment, a string that is not an id, and no id.
    assert.equal((await call("GET", "/api/prof/class-summary?assignment_id=000000000000000000000000")).status, 404);
    assert.equal((await call("GET", "/api/prof/class-summary?assignment_id=nope")).status, 404);
    assert.equal((await call("GET", "/api/prof/class-summary")).status, 404);
    assert.equal((await call("POST", "/api/prof/thursday-card?assignment_id=nope")).status, 404);
  });
});
