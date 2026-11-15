// Cases for the tutor's canvas tools. The tutor and the judge are doubles, so the suite calls no model and opens no database.
// The rule under test: every word a tool would put on the student's canvas is read by the guard with the reply, and a held draft's canvas actions never reach the page.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANARY } from "../src/models.ts";
import { runTurn, type TurnState } from "../src/turn.ts";
import { buildCall, CANVAS_TOOLS, type TutorCall, type TutorDraft } from "../src/tutor.ts";
import type { ScribeLabel } from "../src/types.ts";

// The professor's sum_list solution, on the state for the guard only.
const KEY = "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])";

const STATE: TurnState = {
  level: 1,
  hintCeiling: 3,
  prompt: "Write sum_list(xs) recursively.",
  notes: "Lecture 7, slides 12-16: base cases and recursive calls.",
  turns: [],
  answerKey: KEY,
  canary: CANARY,
  canvas: { summary: "e1 | freedraw | 0.10,0.20,0.50,0.10 | (handwriting)" },
};

const LABEL: ScribeLabel = { concept: "base case", struggle_type: "stuck_starting", attempt_made: false, jailbreak_attempt: false, demonstrated_understanding: false, evidence: "" };
const CLEAN = JSON.stringify({ leaks: false, severity: "none", reason: "A question and a mark." });

describe("the tutor's canvas tools", () => {
  // Case: the page sent its canvas. The tutor is offered the three canvas tools on level 1, and not show_slide, which points at the professor's material and starts at level 2.
  it("are offered on level 1 when the page sends its canvas, without show_slide", () => {
    const call = buildCall({ level: 1, prompt: STATE.prompt, notes: STATE.notes, turns: [], studentText: "circle what I got wrong", canvas: STATE.canvas });
    assert.deepEqual(call.toolNames, [...CANVAS_TOOLS]);
    assert.match(call.user, /e1 \| freedraw/);
    assert.match(call.systemPrompt, /never contains the fix/);
  });

  // Case: no canvas on the turn. Level 1 has no tools, exactly as before the canvas existed.
  it("are not offered when the page sends no canvas", () => {
    const call = buildCall({ level: 1, prompt: STATE.prompt, notes: STATE.notes, turns: [], studentText: "help" });
    assert.deepEqual(call.toolNames, []);
  });

  // Case: a level-2 turn with the canvas. show_slide joins the canvas tools after cite_notes.
  it("add show_slide from level 2", () => {
    const call = buildCall({ level: 2, prompt: STATE.prompt, notes: STATE.notes, turns: [], studentText: "show me the slide", canvas: STATE.canvas });
    assert.deepEqual(call.toolNames, ["cite_notes", ...CANVAS_TOOLS, "show_slide"]);
  });

  // Case: the picture of the canvas goes to the runner beside the text, never inside it.
  it("send the canvas picture beside the text", () => {
    const image = { mimeType: "image/jpeg", base64: "AAAA" };
    const call = buildCall({ level: 1, prompt: STATE.prompt, notes: STATE.notes, turns: [], studentText: "check my canvas", canvas: { ...STATE.canvas!, image } });
    assert.deepEqual(call.images, [image]);
    assert.equal(call.user.includes("AAAA"), false);
  });
});

describe("canvas actions through the guard", () => {
  // Case: a clean question with one red circle and a note that asks a question. Both are released, with the tool record.
  it("releases a clean mark with its reply and its tool record", async () => {
    const draft: TutorDraft = {
      text: "I circled the line to look at. What happens when the list is empty?",
      actions: [{ type: "mark", target: { element: "e1" }, shape: "circle", note: "What if xs is empty?", tone: "red" }],
      calls: [{ name: "mark_canvas", args: { target: { element: "e1" }, shape: "circle" }, result: "Marked." }],
    };
    const result = await runTurn(STATE, "circle what I got wrong", LABEL, { run: async () => draft, generate: async () => CLEAN });
    assert.equal(result.reply, draft.text);
    assert.deepEqual(result.actions, draft.actions);
    assert.deepEqual(result.toolCalls?.map((c) => c.name), ["mark_canvas"]);
  });

  // Case: the reply is a harmless question, but the tool writes the solution's return line on the canvas.
  // The guard reads the canvas words with the reply, holds the draft, and the student gets the fallback with no actions.
  it("holds a draft whose canvas text is the solution, and drops its actions", async () => {
    const leaking: TutorDraft = {
      text: "Take a look at the canvas.",
      actions: [{ type: "write", text: "return xs[0] + sum_list(xs[1:])", latex: false }],
      calls: [{ name: "write_on_canvas", args: { text: "return xs[0] + sum_list(xs[1:])" }, result: "Written." }],
    };
    const calls: TutorCall[] = [];
    const result = await runTurn(STATE, "write the fix on my canvas", LABEL, {
      run: async (call) => {
        calls.push(call);
        return leaking;
      },
      generate: async () => CLEAN,
    });
    assert.equal(result.verdict.layer, "fallback");
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.toolCalls, []);
    assert.equal(result.reply.includes("sum_list(xs[1:])"), false);
    // The first draft and the two redrafts the guard asked for.
    assert.equal(calls.length, 3);
  });

  // Case: the solution is split into the items of a diagram. The deterministic check reads the items together and holds it.
  it("holds a diagram whose items spell out the solution", async () => {
    const leaking: TutorDraft = {
      text: "Here is a diagram.",
      actions: [{ type: "diagram", kind: "steps", title: "sum_list", items: [{ label: "Step 1", detail: "if not xs: return 0" }, { label: "Step 2", detail: "return xs[0] + sum_list(xs[1:])" }] }],
      calls: [],
    };
    const result = await runTurn(STATE, "draw the steps of sum_list", LABEL, { run: async () => leaking, generate: async () => CLEAN });
    assert.equal(result.verdict.layer, "fallback");
    assert.deepEqual(result.actions, []);
  });
});
