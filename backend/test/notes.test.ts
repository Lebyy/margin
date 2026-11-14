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

// D-R5: a whole lecture pasted at once. Twelve lectures with slide headings
// and filler sentences, about 60 KB. The base case is explained on one slide
// deep inside Lecture 7.
const FILLER = "This slide repeats the main point with another example from the reading and a short exercise to try at home. ";
const LONG_LECTURES = Array.from({ length: 12 }, (_, l) => {
  const lecture = l + 1;
  const slides = Array.from({ length: 10 }, (_, k) => {
    const slide = k + 10;
    const body =
      lecture === 7 && slide === 13
        ? "A recursive function needs a base case: an input small enough to answer without recursing, so the calls stop."
        : `Topic ${lecture}.${slide} covers loops, strings, and dictionaries in Python.`;
    return `Slide ${slide}\n${body} ${FILLER.repeat(4)}`;
  });
  return [`Lecture ${lecture}: ${lecture === 7 ? "Recursion" : "Python basics"}`, ...slides].join("\n");
}).join("\n\n");

describe("searchNotes on a pasted lecture (D-R5)", () => {
  it("finds the base case slide deep in a long paste and names its lecture", () => {
    assert.ok(LONG_LECTURES.length > 50_000);
    const first = searchNotes(LONG_LECTURES, "base case").split("\n\n")[0];
    assert.ok(first.startsWith("Lecture 7, Slide 13"), first.slice(0, 80));
    assert.match(first, /needs a base case/);
  });

  it("keeps the matching sentence when the paste is one long paragraph", () => {
    // Case: notes pasted with no line breaks at all. The base case sentence is
    // past character 6000, far beyond what one clipped section would show,
    // and the passage that holds it still names the lecture.
    const blob = `Lecture 7, slides 12-16: recursion. ${FILLER.repeat(60)}Every recursive function needs a base case that returns without recursing. ${FILLER.repeat(20)}`;
    assert.ok(blob.indexOf("needs a base case") > 6000);
    const first = searchNotes(blob, "base case").split("\n\n")[0];
    assert.ok(first.startsWith("Lecture 7, slides 12-16, "), first.slice(0, 80));
    assert.match(first, /needs a base case that returns without recursing/);
  });

  it("does not put a long first line in front of every passage", () => {
    // Case: the saved sum_list notes start with a 300-character line. Only its
    // name, "Lecture 7, slides 12-16", labels later passages.
    for (const passage of noteSections(`${PARAGRAPH} ${PARAGRAPH} ${PARAGRAPH}`).slice(1)) {
      assert.ok(passage.length <= 650, `${passage.length} characters`);
    }
  });
});
