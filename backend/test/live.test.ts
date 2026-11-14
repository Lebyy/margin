// Talk holds audio until the transcript is checked. No case opens a live session.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FALLBACK_REPLY } from "../src/guard.ts";
import { createLiveBridge, extendTranscript, judgeSpeech, liveInstructions, safeNoteResult, type LiveOutbound } from "../src/live.ts";
import { CANARY } from "../src/models.ts";
import { NO_MATCH } from "../src/notes.ts";

const KEY = "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])";
const NOTES = "Lecture 7, slides 12-16. The base case of a list recursion is the empty list.";

function bridge(kind: "code" | "topic" = "code", level: 1 | 2 | 3 = 1) {
  const messages: LiveOutbound[] = [];
  const tools: string[] = [];
  const instructions = liveInstructions({ kind, level, prompt: "Write sum_list(xs) recursively.", notes: NOTES, history: "" });
  const live = createLiveBridge({
    kind,
    answerKey: kind === "topic" ? "" : KEY,
    canary: CANARY,
    notes: NOTES,
    allowSearch: instructions.allowSearch,
    emit: (message) => messages.push(message),
    replyTool: (_id, _name, result) => tools.push(result),
  });
  return { messages, tools, instructions, ...live };
}

function tutorText(messages: LiveOutbound[]): string {
  const caption = messages.find((message) => message.type === "caption" && message.role === "tutor");
  return caption && caption.type === "caption" ? caption.text : "";
}

describe("live talk", () => {
  // Case: the model speaks a question and sends audio. The student hears that audio and sees the question.
  it("plays a question once the transcript is clean", () => {
    const { messages, onEvent } = bridge();
    const pcm = Buffer.from([1, 2, 3, 4]);
    onEvent({ type: "outputText", text: "What happens when the list is empty?" });
    onEvent({ type: "audio", pcm });
    assert.equal(onEvent({ type: "turn" }), false);
    const audio = messages.find((message) => message.type === "audio");
    assert.equal(audio?.type === "audio" && audio.pcm.equals(pcm), true);
    assert.equal(tutorText(messages), "What happens when the list is empty?");
  });

  // Case: the model speaks the solution. The audio is not sent, and the student is shown the fallback sentence.
  it("holds audio when the transcript is the solution", () => {
    const { messages, onEvent } = bridge();
    onEvent({ type: "outputText", text: KEY });
    onEvent({ type: "audio", pcm: Buffer.from([9, 9, 9, 9]) });
    onEvent({ type: "turn" });
    if (messages.some((message) => message.type === "audio")) throw new Error("held audio was sent");
    assert.equal(tutorText(messages), FALLBACK_REPLY);
    const caption = messages.find((message) => message.type === "caption" && message.role === "tutor");
    assert.equal(caption?.type === "caption" && caption.held, true);
  });

  // Case: the transcript is only the canary. Same hold, and the assertion does not print the marker.
  it("holds audio when the transcript is the canary", () => {
    const { messages, onEvent } = bridge();
    onEvent({ type: "outputText", text: CANARY });
    onEvent({ type: "audio", pcm: Buffer.from([9, 9]) });
    onEvent({ type: "turn" });
    if (messages.some((message) => message.type === "audio")) throw new Error("held audio was sent");
    assert.equal(tutorText(messages), FALLBACK_REPLY);
  });

  // Case: the turn ends before any transcript arrives. Waiting, then giving up, drops the audio.
  it("holds the turn when the transcript never arrives", () => {
    const { messages, onEvent, expire } = bridge();
    onEvent({ type: "audio", pcm: Buffer.from([1, 2, 3, 4]) });
    assert.equal(onEvent({ type: "turn" }), true);
    assert.equal(messages.some((message) => message.type === "audio"), false);
    expire();
    assert.equal(tutorText(messages), FALLBACK_REPLY);
    expire();
    assert.equal(messages.filter((message) => message.type === "caption" && message.role === "tutor").length, 1);
  });

  // Case: the transcript shows up just after the turn is marked complete. It is still checked, and a question is played.
  it("plays a transcript that arrives after the turn ends", () => {
    const { messages, onEvent } = bridge();
    onEvent({ type: "audio", pcm: Buffer.from([5, 6]) });
    assert.equal(onEvent({ type: "turn" }), true);
    onEvent({ type: "outputText", text: "What happens when the list is empty?" });
    const audio = messages.find((message) => message.type === "audio");
    assert.equal(audio?.type === "audio", true);
    assert.equal(tutorText(messages), "What happens when the list is empty?");
  });

  // Case: the student starts talking over the model. Playback stops, and the unfinished audio is not released.
  it("drops the turn when the model is interrupted", () => {
    const { messages, onEvent } = bridge();
    onEvent({ type: "audio", pcm: Buffer.from([1, 2]) });
    onEvent({ type: "outputText", text: "What happens when the list is empty?" });
    onEvent({ type: "interrupted" });
    onEvent({ type: "turn" });
    if (messages.some((message) => message.type === "audio")) throw new Error("interrupted audio was sent");
    assert.equal(messages.some((message) => message.type === "stop"), true);
    assert.equal(tutorText(messages), "");
  });

  // Case: level 1 does not get the notes in the prompt, and it refuses a search. Level 2 may search, and a result that is the solution is replaced.
  it("keeps the notes closed at level 1 and scrubs a solution out of a search", () => {
    const level1 = bridge("code", 1);
    if (level1.instructions.system.includes("Lecture 7")) throw new Error("level 1 was given the notes");
    assert.equal(level1.instructions.allowSearch, false);
    level1.onEvent({ type: "tool", id: "1", name: "cite_notes", args: { query: "base case" } });
    assert.equal(level1.tools[0]?.includes("Lecture 7"), false);

    const level2 = bridge("code", 2);
    assert.equal(level2.instructions.allowSearch, true);
    assert.equal(level2.instructions.system.includes("cite_notes"), true);
    if (level2.instructions.system.includes("Lecture 7")) throw new Error("level 2 prompt contained the notes");
    level2.onEvent({ type: "tool", id: "2", name: "cite_notes", args: { query: "base case" } });
    assert.equal(level2.tools[0]?.includes("Lecture 7"), true);

    if (safeNoteResult(KEY, KEY, CANARY, "code") !== NO_MATCH) throw new Error("a solution in the notes was returned");
  });

  // Case: a transcript delivered as the whole text so far is not repeated, and a later piece is kept.
  it("joins a transcript that grows", () => {
    assert.equal(extendTranscript("What", "What happens"), "What happens");
    assert.equal(extendTranscript("What happens", "happens"), "What happens");
    assert.equal(extendTranscript("What", " happens"), "What happens");
  });

  // Case: a written key that is spoken in full is a hold, judged without a bridge.
  it("judges a spoken solution as a hold and does not return the audio", () => {
    const decision = judgeSpeech(KEY, Buffer.from([1]), "code", KEY, CANARY);
    assert.equal(decision.release, "hold");
    assert.equal("audio" in decision, false);
    assert.equal(decision.caption, FALLBACK_REPLY);
  });
});
