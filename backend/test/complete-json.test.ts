// Cases for completeJson. The generator stands in for Gemini so the suite does not need a network.
// Each case names what must happen. The strings below are the input for that case.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { FAST_MODEL, completeJson, stripIdentity } from "../src/llm.ts";

const okSchema = z.object({ ok: z.boolean() });

describe("completeJson", () => {
  // Case: one JSON object that matches the schema is returned, and the scribe role uses the fast model.
  // A vision role uses the strong model, because a photo is not a short label.
  // Swapping the two models would send every guard call to the slow model, or a page photo to the cheap one.
  it("parses a JSON object from the generator", async () => {
    let scribeModel = "";
    const parsed = await completeJson({
      role: "scribe",
      schema: okSchema,
      system: "Return JSON.",
      user: "The student tried a base case.",
      generate: async ({ model }) => {
        scribeModel = model;
        return '{"ok":true}';
      },
    });
    assert.deepEqual(parsed, { ok: true });
    assert.equal(scribeModel, FAST_MODEL);

    let visionModel = "";
    await completeJson({
      role: "vision",
      schema: okSchema,
      system: "Return JSON.",
      user: "A photo of a missing base case.",
      generate: async ({ model }) => {
        visionModel = model;
        return '{"ok":true}';
      },
    });
    assert.equal(visionModel, FAST_MODEL);
  });

  // Case: prose is not a verdict. The generator is called a second time, then the call throws.
  // The thrown error does not repeat the prose, because a guard prompt can contain the answer key.
  // Returning the prose as a successful result would let a parse error reach the student.
  it("throws when the payload is not JSON", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        completeJson({
          role: "guard",
          schema: okSchema,
          system: "Return JSON.",
          user: "Does this draft leak?",
          generate: async () => {
            calls += 1;
            return "this is not json";
          },
        }),
      /after one retry/,
    );
    assert.equal(calls, 2);
  });

  // Case: an email, a phone number, and a long id are removed before the generator runs.
  // Lecture 7 and slides 12-16 stay, because those are the level-2 citation, not an identity.
  // Stripping after the call would send the address to Gemini and only hide it from our own logs.
  it("strips an email, a phone number, and a long id before the call", async () => {
    let sent = "";
    await completeJson({
      role: "scribe",
      schema: okSchema,
      system: "Lecture 7, slides 12-16.",
      user: "Email ada@uni.edu or call (415) 555-0134. Student id 10058432.",
      generate: async ({ system, user }) => {
        sent = `${system}\n${user}`;
        return '{"ok":true}';
      },
    });
    assert.equal(sent.includes("ada@uni.edu"), false);
    assert.equal(sent.includes("415"), false);
    assert.equal(sent.includes("10058432"), false);
    assert.equal(sent.includes("[redacted]"), true);
    assert.equal(sent.includes("Lecture 7, slides 12-16."), true);
    assert.equal(stripIdentity("Lecture 7, slides 12-16."), "Lecture 7, slides 12-16.");
  });
});
