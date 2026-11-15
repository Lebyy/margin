// Cases for reading an assignment's questions and key from any source. The vision model is a stand-in, so no model is called; no database.
// The rules under test: typed text, CSV, Excel, Word, and handwriting all become text, and a file Askretes cannot read says why.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { readSource, SourceError } from "../src/assignment-sources.ts";

const b64 = (b: Uint8Array | Buffer | string) => Buffer.from(b).toString("base64");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

describe("reading an assignment source", () => {
  // Case: the professor typed the questions. They are used as typed.
  it("takes typed text as it is", async () => {
    const out = await readSource({ text: "1. Find $F$ when $q = 2$." });
    assert.equal(out.text, "1. Find $F$ when $q = 2$.");
    assert.equal(out.pdf, null);
  });

  // Case: an answer key kept as a CSV table of question numbers and answers.
  it("reads a CSV key", async () => {
    const out = await readSource({ file: { name: "key.csv", base64: b64("question,answer\n1,42 N\n2,3.1 m/s\n") } });
    assert.match(out.text, /1,42 N/);
  });

  // Case: an answer key in an Excel workbook. Shared strings are resolved and each row reads as one line.
  it("reads an Excel key, row by row", async () => {
    const shared = '<sst><si><t>Q</t></si><si><t>Answer</t></si><si><t>42 N</t></si></sst>';
    const sheet = '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c><v>1</v></c><c t="s"><v>2</v></c></row></sheetData></worksheet>';
    const xlsx = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "xl/sharedStrings.xml": strToU8(shared), "xl/worksheets/sheet1.xml": strToU8(sheet) });
    const out = await readSource({ file: { name: "key.xlsx", base64: b64(xlsx) } });
    assert.equal(out.text, "Q | Answer\n1 | 42 N");
  });

  // Case: a photo of handwritten questions. The vision model's transcription (here a stand-in, with LaTeX) is the text.
  it("transcribes a photo of handwriting", async () => {
    let asked = "";
    const out = await readSource({ file: { name: "questions.png", base64: b64(PNG) } }, async (request) => {
      asked = request.system;
      return JSON.stringify({ text: "1. Show that $\\nabla \\cdot E = \\rho / \\epsilon_0$." });
    });
    assert.match(asked, /do not solve/);
    assert.match(asked, /LaTeX/);
    assert.equal(out.text, "1. Show that $\\nabla \\cdot E = \\rho / \\epsilon_0$.");
  });

  // Case: a file Askretes cannot read is refused with a sentence the professor can act on.
  it("refuses a binary file with a reason", async () => {
    await assert.rejects(readSource({ file: { name: "x.exe", base64: b64(Buffer.from([0x4d, 0x5a, 0, 1])) } }), (e: unknown) => e instanceof SourceError && /cannot be read/.test(e.message));
  });
});
