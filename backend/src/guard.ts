// The first layer of the guard. It runs before any judge call, and it does not call a model.
//
// The string check runs before the model. If the normalized key, or eight words of it, is already in the draft, the model is not asked. A later judgment of clean must not be able to release a draft that already contains the solution. The caller keeps this verdict when `leaks` is true.
// The reason names the kind of hit. It does not quote the key, because the reason is shown in the drawer and sent back to the tutor on a retry.

import type { GuardVerdict } from "./types.ts";

// Eight consecutive normalized words is a copied stretch. Seven can be the base case plus a few words of a hint, which this layer is not supposed to hold.
const WINDOW = 8;

// Python keywords stay themselves. Every other name becomes `v`, so renaming `xs` to `nums` does not hide the solution.
// `in` and `not` are keywords. A word that only starts with one of them, such as `nothing`, is still one name and becomes `v`. Splitting it would turn ordinary English into the keyword `not`.
const KEYWORDS = new Set([
  "false",
  "none",
  "true",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

// Longest keyword first, so `nonlocal` is not read as `not`.
const KEYWORDS_BY_LENGTH = [...KEYWORDS].sort((left, right) => right.length - left.length);

/**
 * The deterministic verdict for one draft.
 * `answerKey` is the hidden solution. `canary` is the marker stored beside it. Neither string is copied into the reason.
 * The return value is a plain object. A promise here would mean this layer had waited on a model, and a timeout would look like a clean draft.
 */
export function checkDeterministic(draft: string, answerKey: string, canary: string): GuardVerdict {
  if (containsCanary(draft, canary)) {
    return hit("The draft contains the canary.");
  }
  const draftWords = normalizeDraft(draft);
  const keyWords = normalizeDraft(answerKey);
  if (keyWords.length > 0 && containsSequence(draftWords, keyWords)) {
    return hit("The draft contains the final answer.");
  }
  if (containsWindow(draftWords, keyWords)) {
    return hit("The draft contains an eight-word stretch of the solution.");
  }
  return {
    leaks: false,
    severity: "none",
    reason: "The draft does not contain the solution.",
    layer: "deterministic",
  };
}

/**
 * Words of the draft after the same folding the check uses.
 * Tests use this to show why a question does not match. The verdict itself comes from `checkDeterministic`.
 */
export function normalizeDraft(source: string): string[] {
  const stripped = stripComments(source).toLowerCase();
  const words: string[] = [];
  for (let i = 0; i < stripped.length; ) {
    if (/\s/.test(stripped[i])) {
      i += 1;
      continue;
    }
    const rest = stripped.slice(i);
    const ident = /^[a-z_][a-z0-9_]*/.exec(rest);
    if (ident) {
      const split = keywordThenNumber(ident[0]);
      if (split) {
        words.push(split);
        i += split.length;
        continue;
      }
      words.push(KEYWORDS.has(ident[0]) ? ident[0] : "v");
      i += ident[0].length;
      continue;
    }
    const number = /^\d+/.exec(rest);
    if (number) {
      words.push(number[0]);
      i += number[0].length;
      continue;
    }
    words.push(stripped[i]);
    i += 1;
  }
  return words;
}

function hit(reason: string): GuardVerdict {
  // This layer has two outcomes: a copied solution or the canary, which is the whole solution leaking, or nothing. `partial` belongs to the judge, which reads a shorter leak.
  return { leaks: true, severity: "full", reason, layer: "deterministic" };
}

/**
 * The canary is checked on the raw draft, before names are folded.
 * Folding names would turn `MARGIN_CANARY_7f3a` into `v`, and the marker would never match.
 * Spaces, underscores, and other separators are removed, so `margin canary 7f3a` is still the marker. A comment around it still counts, because a comment is text the student can read.
 */
function containsCanary(draft: string, canary: string): boolean {
  const folded = fold(canary);
  if (folded.length === 0) return false;
  return fold(draft).includes(folded);
}

function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Any eight consecutive normalized words from the key.
 * The first eight words of the demo key are `def`, the name, the parentheses, and `if not`. A `count_list` written with that same opening is also a hit. A question is not, and a later judge does not get to release the hit.
 */
function containsWindow(draftWords: string[], keyWords: string[]): boolean {
  if (keyWords.length < WINDOW || draftWords.length < WINDOW) return false;
  for (let start = 0; start <= keyWords.length - WINDOW; start += 1) {
    if (containsSequence(draftWords, keyWords.slice(start, start + WINDOW))) return true;
  }
  return false;
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let same = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        same = false;
        break;
      }
    }
    if (same) return true;
  }
  return false;
}

/**
 * `#` starts a comment only outside a string. A hash inside a string is part of the text, and stripping from there would hide a solution that sits later on the same line.
 * The comment is removed so a note between two pieces of the solution cannot break the eight-word match.
 */
function stripComments(source: string): string {
  let out = "";
  let quote: "'" | "\"" | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      out += char;
      if (char === "\\" && i + 1 < source.length) {
        out += source[i + 1];
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      out += char;
      continue;
    }
    if (char === "#") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

/**
 * `return0` is the keyword `return` and the number `0`. A missing space has to match `return 0`, or leaving the space out would hide the line.
 * The remainder has to start with a digit. `nothing` starts with `not` and then letters, so it stays one name.
 */
function keywordThenNumber(token: string): string | null {
  for (const keyword of KEYWORDS_BY_LENGTH) {
    if (!token.startsWith(keyword)) continue;
    const rest = token.slice(keyword.length);
    if (rest.length > 0 && /^\d/.test(rest)) return keyword;
  }
  return null;
}
