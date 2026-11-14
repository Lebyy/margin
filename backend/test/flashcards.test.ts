import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { clearFlashcardCache } from "../src/flashcards.ts";
import { CANARY } from "../src/models.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// D-R4 done-when: the cards for a base_case student talk about base cases
// and do not contain the sum_list solution, and the guard's deterministic
// check is run on the card text. Students take turns through the real
// message route; the scribe, tutor, judge, and card writer are stand-ins, so
// no model credit is spent. Skipped without MONGODB_URI.

const uri = testUri("margin_test_cards");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

const KEY = "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])";
const NOTES =
  "Lecture 7, slides 12-16: recursion. Every recursive function needs a base case that returns without recursing, and a recursive call on a smaller input that moves toward the base case. The return value of each call is combined with the current element on the way back up the call stack.";
const SUM_LIST = {
  course_name: "Intro CS, Python recursion",
  title: "Write sum_list(xs) recursively",
  prompt: "Write sum_list(xs) recursively. It returns the sum of a list of numbers.",
  answer_key: KEY,
  notes: NOTES,
  concepts: ["base_case", "recursive_call_progress", "return_value_propagation", "call_stack_tracing"],
  hint_ceiling: 3,
};

// What the card writer answers: two cards about base cases, and one that
// hands over the base case of the solution, which the guard must drop.
const GOOD = [
  { front: "What is a base case?", back: "The case that returns without recursing, so the recursion stops. See Lecture 7, slides 12-16." },
  { front: "Why does every recursive function need a base case?", back: "Without one, the calls never stop." },
];
const LEAKING = { front: "How does sum_list stop?", back: "Write if not xs: return 0 at the top." };

describe("GET /api/students/:id/flashcards (D-R4)", { skip }, () => {
  let server: Server;
  let base: string;
  let assignmentId: string;
  let ada: string;
  let dee: string;

  let scribeConcept = "base_case";
  let cardReply: () => Promise<string> = async () => JSON.stringify({ cards: [...GOOD, LEAKING] });
  let cardCalls = 0;
  let cardPrompt = "";

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp({
      scribe: async () =>
        JSON.stringify({
          concept: scribeConcept,
          struggle_type: "misconception",
          attempt_made: true,
          jailbreak_attempt: false,
          demonstrated_understanding: false,
          evidence: "",
        }),
      tutor: async () => "What happens when the list is empty?",
      judge: async () => JSON.stringify({ leaks: false, severity: "none", reason: "A question." }),
      flashcards: async ({ system, user }) => {
        cardCalls += 1;
        cardPrompt = `${system}\n${user}`;
        return cardReply();
      },
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assignmentId = JSON.parse((await call("POST", "/api/prof/assignments", SUM_LIST)).text)._id;

    // Ada: two base_case turns and one recursive_call_progress turn, so base_case is her weakest.
    const a = JSON.parse((await call("POST", "/api/sessions", { assignment_id: assignmentId, display_name: "Ada" })).text);
    ada = a.student_id;
    for (const concept of ["base_case", "recursive_call_progress", "base_case"]) {
      scribeConcept = concept;
      assert.equal((await call("POST", `/api/sessions/${a.session_id}/messages`, { text: "I tried return xs[0] + sum_list(xs[1:])" })).status, 200);
    }
    // Dee: opened the assignment and has not struggled with anything.
    dee = JSON.parse((await call("POST", "/api/sessions", { assignment_id: assignmentId, display_name: "Dee" })).text).student_id;
  });

  beforeEach(() => {
    clearFlashcardCache();
    cardCalls = 0;
    cardReply = async () => JSON.stringify({ cards: [...GOOD, LEAKING] });
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

  const cardsFor = (student: string, concept?: string) =>
    call("GET", `/api/students/${student}/flashcards?assignment_id=${assignmentId}${concept ? `&concept=${concept}` : ""}`);

  test("a base_case student gets base case cards, and the card with the solution is dropped", async () => {
    // Case: the done-when line. Ada's weakest concept is base_case. The two
    // cards about the idea come back; the one with "if not xs: return 0"
    // failed the guard's check and is gone.
    const { status, text } = await cardsFor(ada);
    assert.equal(status, 200);
    const body = JSON.parse(text);
    assert.equal(body.concept, "base_case");
    assert.deepEqual(body.cards, GOOD);
    assert.ok(body.cards.every((c: { front: string; back: string }) => /base case/i.test(`${c.front} ${c.back}`) || /stop/i.test(c.back)));
    assert.ok(!text.includes("if not xs") && !text.includes("return 0") && !text.includes(CANARY));
  });

  test("the card prompt has the notes and the concept, and nothing secret or personal", async () => {
    // Case: the board's "Do not": no free prompt that can see the key. The
    // assignment prompt and the student's name are left out too.
    await cardsFor(ada);
    assert.ok(cardPrompt.includes("Lecture 7, slides 12-16") && cardPrompt.includes("base case"));
    assert.ok(!cardPrompt.includes("if not xs") && !cardPrompt.includes(CANARY), "the key reached the card prompt");
    assert.ok(!cardPrompt.includes("Ada"), "the student's name reached the card prompt");
    assert.ok(!cardPrompt.includes("sum of a list"), "the assignment prompt reached the card prompt");
  });

  test("cards are written once per concept and shared", async () => {
    // Case: Ada asks twice, then Dee asks for base_case. One model call.
    await cardsFor(ada);
    await cardsFor(ada);
    await cardsFor(dee, "base_case");
    assert.equal(cardCalls, 1);
  });

  test("a student with no struggle gets no concept, no cards, and no model call", async () => {
    const body = JSON.parse((await cardsFor(dee)).text);
    assert.deepEqual(body, { concept: null, cards: [] });
    assert.equal(cardCalls, 0);
  });

  test("the concept buttons can ask for another concept, but only one on the assignment", async () => {
    cardReply = async () => JSON.stringify({ cards: [{ front: "What must each recursive call do?", back: "Work on a smaller input that moves toward the base case." }] });
    const body = JSON.parse((await cardsFor(ada, "recursive_call_progress")).text);
    assert.equal(body.concept, "recursive_call_progress");
    assert.equal(body.cards.length, 1);
    assert.equal((await cardsFor(ada, "not_a_concept")).status, 400);
  });

  test("a model that answers garbage is a 503, and nothing is cached", async () => {
    cardReply = async () => "Here are your cards!";
    assert.equal((await cardsFor(ada)).status, 503);
    cardReply = async () => JSON.stringify({ cards: GOOD });
    assert.equal((await cardsFor(ada)).status, 200);
  });

  test("an unknown student or assignment is a 404", async () => {
    assert.equal((await call("GET", `/api/students/000000000000000000000000/flashcards?assignment_id=${assignmentId}`)).status, 404);
    assert.equal((await call("GET", `/api/students/${ada}/flashcards?assignment_id=nope`)).status, 404);
  });
});
