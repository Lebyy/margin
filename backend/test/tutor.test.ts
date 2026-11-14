// Cases for draftHint. The runner stands in for the deepagent, so the suite does not call Gemini.
// Each case names what must happen. The strings below are the input for that case.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENT_PLATFORM_HOST, CLOUD_PROJECT, MODEL_LOCATION, TUTOR_MODEL } from "../src/llm.ts";
import { buildCall, draftHint, searchNotes, TimedChatGoogle, type TutorCall } from "../src/tutor.ts";

const NOTES = "Lecture 7, slides 12-16: base cases and recursive calls.";

async function capture(level: 1 | 2 | 3, studentText = "I tried a recursive call and it never stops."): Promise<TutorCall> {
  let seen: TutorCall | undefined;
  await draftHint(
    {
      level,
      prompt: "Write sum_list(xs) recursively.",
      notes: NOTES,
      turns: [],
      studentText,
    },
    async (call) => {
      seen = call;
      return "What happens when the list is empty?";
    },
  );
  if (!seen) throw new Error("the runner was not called");
  return seen;
}

describe("draftHint", () => {
  // Case: level 1 is a question, built with no tools, and the system prompt forbids the solution.
  // A tool at level 1 would let the first hint search the notes. A prompt that allows the solution would make the guard the only line.
  it("forbids the solution and builds level 1 with no tools", async () => {
    const call = await capture(1);
    assert.match(call.systemPrompt, /Do not write the solution/);
    assert.match(call.systemPrompt, /one friendly refusal sentence/);
    assert.match(call.systemPrompt, /The hint level is 1/);
    assert.deepEqual(call.toolNames, []);
    assert.equal(call.model, TUTOR_MODEL);
  });

  // Case: the chat class defaults to AI Studio. These fields are the Agent Platform path, including global.
  // Dropping them sends the express key to generativelanguage.googleapis.com, which answers 402.
  it("points the chat client at the Agent Platform", async () => {
    const call = await capture(1);
    assert.equal(call.baseUrl, AGENT_PLATFORM_HOST);
    assert.equal(call.baseUrl.includes("generativelanguage.googleapis.com"), false);
    assert.match(call.apiVersion, new RegExp(`projects/${CLOUD_PROJECT}/locations/${MODEL_LOCATION}/publishers/google`));
    assert.equal(call.apiVersion.endsWith("/models"), false);
  });

  // Case: level 2's only tool is cite_notes. Level 3 has no tool and names count_list.
  // A level-3 tool that can read the notes could quote sum_list back if the notes ever contained it.
  it("gives cite_notes only at level 2, and count_list at level 3", async () => {
    const level2 = await capture(2);
    assert.deepEqual(level2.toolNames, ["cite_notes"]);

    const level3 = await capture(3);
    assert.deepEqual(level3.toolNames, []);
    assert.match(level3.systemPrompt, /count_list/);
    assert.match(level3.systemPrompt, /count_list is not sum_list/);
  });

  // Case: a caller spreads an assignment and the answer key rides along. The runner must not be entered.
  // The type has no such field. This is the runtime stop for a value that was cast past the type.
  it("refuses an answer key and does not call the runner", async () => {
    let called = false;
    const input = {
      level: 1 as const,
      prompt: "Write sum_list(xs) recursively.",
      notes: NOTES,
      turns: [],
      studentText: "I am stuck.",
      answer_key: "def sum_list(xs):\n    return 0",
    };
    await assert.rejects(
      () => draftHint(input, async () => {
        called = true;
        return "no";
      }),
      /answer key/,
    );
    assert.equal(called, false);
  });

  // Case: an email in the attempt is removed before the runner sees it.
  // Stripping after the call would mean the address had already been handed to the model.
  it("strips an email before the runner", async () => {
    const call = await capture(1, "I am ada@college.edu and the base case is missing.");
    assert.equal(call.user.includes("ada@college.edu"), false);
    assert.match(call.user, /\[redacted\]/);
  });

  // Case: the guard held the previous draft and passed its reason. The next prompt is one level lower and includes that reason.
  // The held draft itself stays out. Pasting it back would hand the tutor the solution it just wrote.
  it("includes the guard reason and not a second copy of the draft", () => {
    const call = buildCall({
      level: 2,
      prompt: "Write sum_list(xs) recursively.",
      notes: NOTES,
      turns: [],
      studentText: "I tried a recursive call and it never stops.",
      feedback: "The draft was held.",
    });
    assert.match(call.user, /The draft was held/);
    assert.match(call.systemPrompt, /The hint level is 2/);
    assert.equal(call.user.includes("Do not repeat the held draft"), true);

    const first = buildCall({
      level: 2,
      prompt: "Write sum_list(xs) recursively.",
      notes: NOTES,
      turns: [],
      studentText: "I tried a recursive call and it never stops.",
    });
    assert.equal(first.user.includes("previous draft"), false);
  });

  // Case: the demo notes mention the base case, so the search returns Lecture 7, slides 12-16.
  // A search that misses that line would make the level-2 hint cite a lecture the professor did not write.
  it("finds Lecture 7, slides 12-16 in the demo notes", () => {
    assert.match(searchNotes(NOTES, "base case"), /Lecture 7, slides 12-16/);
    const call = buildCall({
      level: 2,
      prompt: "Write sum_list(xs) recursively.",
      notes: NOTES,
      turns: [],
      studentText: "Where do I look?",
    });
    assert.equal(call.notes.includes("Lecture 7, slides 12-16"), true);
  });
});

// The hedged requests in runDeepAgent's client. The Google SDK call is
// replaced by a stand-in that answers, fails with a status, answers after a
// delay, or hangs until its signal fires (the way the SDK aborts a fetch).
// The hedge is 30 ms and the cap 150 ms. No network, no model credit.
describe("TimedChatGoogle", () => {
  type Reply = "answer" | "hang" | 400 | 429 | 503 | { after: number };

  /** A client whose SDK call follows `script`, one entry per request sent. */
  function client(script: Reply[]) {
    const model = new TimedChatGoogle({ model: TUTOR_MODEL, apiKey: "test-key", maxRetries: 0 });
    model.hedgeAfterMs = 30;
    model.requestTimeoutMs = 150;
    let calls = 0;
    let cancelled = 0;
    (model as unknown as { client: { generateContent: unknown } }).client.generateContent = (
      _request: unknown,
      { signal }: { signal?: AbortSignal },
    ) => {
      const reply = script[calls] ?? "hang";
      calls += 1;
      const id = calls;
      if (reply === "answer") return Promise.resolve({ response: { text: () => `answer ${id}` } });
      if (typeof reply === "number") return Promise.reject(Object.assign(new Error(`status ${reply}`), { status: reply }));
      return new Promise((resolve, reject) => {
        if (reply !== "hang") setTimeout(() => resolve({ response: { text: () => `answer ${id}` } }), reply.after);
        signal?.addEventListener("abort", () => {
          cancelled += 1;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    };
    return { model, calls: () => calls, cancelled: () => cancelled };
  }

  const request = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
  const text = (r: unknown) => (r as { response: { text: () => string } }).response.text();

  it("sends one request when the model answers before the hedge", async () => {
    const { model, calls } = client(["answer"]);
    assert.equal(text(await model.completionWithRetry(request)), "answer 1");
    assert.equal(calls(), 1);
  });

  it("sends a second copy when the first hangs, and cancels the first", async () => {
    // Case: the 146 s request from the trace. The copy sent at the hedge
    // answers, the hung one is cancelled, and the turn gets its reply.
    const { model, calls, cancelled } = client(["hang", "answer"]);
    assert.equal(text(await model.completionWithRetry(request)), "answer 2");
    assert.equal(calls(), 2);
    assert.equal(cancelled(), 1);
  });

  it("uses whichever copy answers first", async () => {
    // Case: the first copy is only slow. It answers after the hedge was sent
    // but before the second copy, so its answer is used and the copy is cancelled.
    const { model, calls, cancelled } = client([{ after: 50 }, { after: 120 }]);
    assert.equal(text(await model.completionWithRetry(request)), "answer 1");
    assert.equal(calls(), 2);
    assert.equal(cancelled(), 1);
  });

  it("gives up at the cap with two requests, instead of looping", async () => {
    const { model, calls } = client(["hang", "hang", "hang"]);
    const started = Date.now();
    await assert.rejects(model.completionWithRetry(request));
    assert.equal(calls(), 2);
    assert.ok(Date.now() - started < 1000);
  });

  it("sends the second copy at once after a 429 or a 5xx, and does not resend a 400", async () => {
    // Case: what maxRetries: 1 used to cover. A busy provider gets the second
    // copy immediately; a bad request would fail the same way again.
    for (const status of [429, 503] as const) {
      const { model, calls } = client([status, "answer"]);
      const started = Date.now();
      await model.completionWithRetry(request);
      assert.equal(calls(), 2, `status ${status}`);
      assert.ok(Date.now() - started < 30, `status ${status} waited for the hedge`);
    }
    const { model, calls } = client([400, "answer"]);
    await assert.rejects(model.completionWithRetry(request));
    assert.equal(calls(), 1);
  });

  it("stops both copies when the turn itself is aborted", async () => {
    const { model, calls } = client(["hang", "hang"]);
    const turn = new AbortController();
    setTimeout(() => turn.abort(), 10);
    await assert.rejects(model.completionWithRetry(request, { signal: turn.signal } as never));
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(calls(), 1, "a copy was sent after the turn was over");
  });
});
