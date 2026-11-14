import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_MATCH, noteSections, searchNotes } from "../src/notes.ts";

// D-R3: the level-2 search over the professor's notes. The sum_list notes
// must be able to return "Lecture 7, slides 12-16". No model, no database.

// The notes saved on the sum_list assignment: one paragraph, citation first.
const PARAGRAPH =
  "Lecture 7, slides 12-16: recursion. Every recursive function needs a base case that returns without recursing, and a recursive call on a smaller input that moves toward the base case. The return value of each call is combined with the current element on the way back up the call stack.";

// Notes the way a professor often pastes them: headings on their own lines,
// the explanation underneath, no blank lines in between.
const SECTIONED = [
  "Lecture 6, slides 1-8",
  "Functions, parameters, and return values.",
  "Lecture 7, slides 12-16",
  "Every recursive function needs a base case.",
  "The recursive call must work on a smaller input.",
  "Lecture 8, slides 3-9",
  "Tail recursion and rewriting recursion as a loop.",
].join("\n");

describe("noteSections", () => {
  it("keeps each lecture heading with the lines under it", () => {
    assert.deepEqual(noteSections(SECTIONED), [
      "Lecture 6, slides 1-8\nFunctions, parameters, and return values.",
      "Lecture 7, slides 12-16\nEvery recursive function needs a base case.\nThe recursive call must work on a smaller input.",
      "Lecture 8, slides 3-9\nTail recursion and rewriting recursion as a loop.",
    ]);
  });
});

describe("searchNotes", () => {
  it("returns the sum_list citation for the ways a model names the concept", () => {
    // Cases: the scribe's concept id, plain words, a related word, and a typo.
    for (const query of ["base_case", "base case", "recursive call", "recurson"]) {
      assert.match(searchNotes(PARAGRAPH, query), /Lecture 7, slides 12-16/, query);
    }
  });

  it("returns the heading with the matching line when the heading is on its own line", () => {
    // Case: the line that says "base case" has no slide number. The section
    // carries its heading, so the citation is still there, and it comes first.
    const result = searchNotes(SECTIONED, "base case");
    assert.ok(result.startsWith("Lecture 7, slides 12-16\nEvery recursive function needs a base case."), result);
  });

  it("ranks the section about the query first", () => {
    assert.ok(searchNotes(SECTIONED, "loop").startsWith("Lecture 8, slides 3-9"));
    assert.ok(searchNotes(SECTIONED, "return values").startsWith("Lecture 6, slides 1-8"));
  });

  it("says so when nothing matches, instead of returning something", () => {
    // Cases: an unrelated topic, empty notes, and an empty query. A miss is the
    // fixed sentence the tutor prompt tells the model to treat as nothing to cite.
    assert.equal(searchNotes(SECTIONED, "dictionary comprehension"), NO_MATCH);
    assert.equal(searchNotes("", "base case"), NO_MATCH);
    assert.equal(searchNotes(SECTIONED, "   "), NO_MATCH);
  });

  it("does not stretch short words into other words", () => {
    // Case: typo matching is off for words under 5 letters, so "last" does not
    // pull in a section that only says "list".
    assert.equal(searchNotes("Week 2\nWorking with a list of numbers.", "last"), NO_MATCH);
  });
});
