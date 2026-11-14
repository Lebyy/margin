import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it, test } from "node:test";
import { createApp } from "../src/app.ts";
import { connectDb, disconnectDb } from "../src/db.ts";
import { CANARY, Message, ScribeEvent, Session } from "../src/models.ts";
import { boxOnImage, stepLeaks } from "../src/vision.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// D-R1 done-when:
//   - a photo of a sum_list missing its base case returns a step and a box,
//     and the step does not contain the solution;
//   - a forced provider error returns 501.
// The photo is test/fixtures/sum_list_no_base_case.png, sent through the real
// route. The vision model is a stand-in here, so the suite spends no credit;
// the same photo was sent to Gemini once by hand (see the commit message).
// Skipped without MONGODB_URI, except the pure checks at the top.

const KEY = "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])";

describe("stepLeaks", () => {
  it("refuses a step that carries the fix, and passes one that names the mistake", () => {
    // Cases: the base case written inline as prose, the base case in
    // backticks, the canary, and the whole key. Then two steps that only say
    // what is wrong, which must pass or the feature never returns anything.
    assert.equal(stepLeaks("Add if not xs: return 0 at the top.", KEY, CANARY), true);
    assert.equal(stepLeaks("Add `if not xs` first.", KEY, CANARY), true);
    assert.equal(stepLeaks(`Missing ${CANARY}`, KEY, CANARY), true);
    assert.equal(stepLeaks(KEY.replace(/\n/g, " "), KEY, CANARY), true);
    assert.equal(stepLeaks("There is no base case, so the recursion never stops on an empty list.", KEY, CANARY), false);
    assert.equal(stepLeaks("Nothing handles the empty list before the recursive call.", KEY, CANARY), false);
  });
});

describe("boxOnImage", () => {
  it("accepts a box on the photo and refuses one off it or with no area", () => {
    assert.equal(boxOnImage({ x: 0.05, y: 0.2, w: 0.6, h: 0.15 }), true);
    assert.equal(boxOnImage({ x: 0.8, y: 0.2, w: 0.5, h: 0.1 }), false);
    assert.equal(boxOnImage({ x: 0.1, y: 0.1, w: 0, h: 0.1 }), false);
  });
});

// Atlas caps database names at 38 bytes, and testUri adds about 15 more.
const uri = testUri("margin_test_vision");
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

const SUM_LIST = {
  course_name: "Intro CS, Python recursion",
  title: "Write sum_list(xs) recursively",
  prompt: "Write sum_list(xs) recursively. It returns the sum of a list of numbers.",
  answer_key: KEY,
  notes: "Lecture 7, slides 12-16.",
  concepts: ["base_case", "recursive_call_progress", "return_value_propagation", "call_stack_tracing"],
  hint_ceiling: 3,
};

const PHOTO = {
  mimeType: "image/png",
  base64: readFileSync(new URL("./fixtures/sum_list_no_base_case.png", import.meta.url)).toString("base64"),
};

const STEP = "There is no base case, so sum_list never stops when the list is empty.";
const BOX = { x: 0.03, y: 0.15, w: 0.7, h: 0.4 };

describe("POST /api/sessions/:id/messages with a photo (D-R1)", { skip }, () => {
  let server: Server;
  let base: string;
  let assignmentId: string;

  // What the vision stand-in does on the next call, and what it was sent.
  let visionReply: () => Promise<string> = async () => "";
  let visionSent = "";
  let visionCalls = 0;

  before(async () => {
    await connectDb(uri);
    await clearCollections();
    server = createApp({
      vision: async ({ system, user }) => {
        visionCalls += 1;
        visionSent = `${system}\n${user}`;
        return visionReply();
      },
      // A photo must not reach the text pipeline. These throw so a test fails
      // loudly if it does.
      scribe: async () => {
        throw new Error("the scribe ran on a photo");
      },
      tutor: async () => {
        throw new Error("the tutor ran on a photo");
      },
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assignmentId = JSON.parse((await post("/api/prof/assignments", SUM_LIST)).text)._id;
  });

  after(async () => {
    server.close();
    await dropTestDatabase();
    await disconnectDb();
  });

  /** Posts JSON to the running app and returns status plus raw text. */
  async function post(path: string, body: unknown) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  }

  /** Starts a session for a new student and returns its id. */
  async function startSession(name: string): Promise<string> {
    return JSON.parse((await post("/api/sessions", { assignment_id: assignmentId, display_name: name })).text).session_id;
  }

  test("the photo returns a step and a box, and the turn is logged as a misconception", async () => {
    // Case: the done-when line. The step names the missing base case without
    // the fix, the box is on the photo, and one student message and one
    // misconception event on base_case are stored. The level does not move.
    visionReply = async () => JSON.stringify({ found: true, step: STEP, concept: "base_case", box: BOX });
    const sessionId = await startSession("Grace");
    const { status, text } = await post(`/api/sessions/${sessionId}/messages`, { image: PHOTO });
    assert.equal(status, 200);
    assert.deepEqual(JSON.parse(text), { step: STEP, box: BOX });
    assert.ok(!text.includes("if not xs") && !text.includes("return 0") && !text.includes(CANARY));

    const message = await Message.findOne({ session_id: sessionId }).lean();
    assert.equal(message?.role, "student");
    assert.ok(message?.content.includes(STEP));
    const event = await ScribeEvent.findOne({ message_id: message?._id }).lean();
    assert.equal(event?.struggle_type, "misconception");
    assert.equal(event?.concept, "base_case");
    assert.equal(event?.attempt_made, true);
    assert.equal((await Session.findById(sessionId).lean())?.current_level, 1);

    // The vision prompt has the assignment and the concepts, and neither the
    // key nor the student's name.
    assert.ok(visionSent.includes("sum_list") && visionSent.includes("base_case"));
    assert.ok(!visionSent.includes("if not xs") && !visionSent.includes(CANARY) && !visionSent.includes("Grace"));
  });

  test("a forced provider error is a 501 with no model text and nothing stored", async () => {
    // Case: the done-when line. The provider throws on every call.
    visionReply = async () => {
      throw new Error("provider down");
    };
    const sessionId = await startSession("Alan");
    const { status, text } = await post(`/api/sessions/${sessionId}/messages`, { image: PHOTO });
    assert.equal(status, 501);
    assert.deepEqual(JSON.parse(text), { error: "vision_unavailable" });
    assert.equal(await Message.countDocuments({ session_id: sessionId }), 0);
  });

  test("a step that carries the fix, a box off the photo, or no mistake found is a 501", async () => {
    // Cases: each answer is well-formed JSON, so only the checks in vision.ts
    // stand between it and the page. Each one is refused whole and stores
    // nothing; the leaking step's text never reaches the response.
    const sessionId = await startSession("Ada");
    const answers = [
      { found: true, step: "Add if not xs: return 0 before the recursive call.", concept: "base_case", box: BOX },
      { found: true, step: STEP, concept: "base_case", box: { x: 0.6, y: 0.2, w: 0.7, h: 0.2 } },
      { found: false, step: "", concept: "base_case", box: { x: 0, y: 0, w: 0, h: 0 } },
      { found: true, step: STEP, concept: "not_a_concept", box: BOX },
    ];
    for (const answer of answers) {
      visionReply = async () => JSON.stringify(answer);
      const { status, text } = await post(`/api/sessions/${sessionId}/messages`, { image: PHOTO });
      assert.equal(status, 501, `answer was not refused: ${JSON.stringify(answer.box)}`);
      assert.ok(!text.includes("return 0"));
    }
    assert.equal(await Message.countDocuments({ session_id: sessionId }), 0);
  });

  test("garbage twice is a 501 after exactly two calls", async () => {
    // Case: completeJson retries a bad payload once, then gives up. Two calls,
    // not a loop, because a photo is a strong-model call on the shared credit.
    visionReply = async () => "I see a function!";
    visionCalls = 0;
    const sessionId = await startSession("Barbara");
    assert.equal((await post(`/api/sessions/${sessionId}/messages`, { image: PHOTO })).status, 501);
    assert.equal(visionCalls, 2);
  });

  test("a type the model cannot open, or bytes that are not base64, are a 400 before any call", async () => {
    visionCalls = 0;
    const sessionId = await startSession("Edsger");
    assert.equal((await post(`/api/sessions/${sessionId}/messages`, { image: { ...PHOTO, mimeType: "application/pdf" } })).status, 400);
    assert.equal((await post(`/api/sessions/${sessionId}/messages`, { image: { ...PHOTO, base64: "not base64!" } })).status, 400);
    assert.equal(visionCalls, 0);
  });
});
