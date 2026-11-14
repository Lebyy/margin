// Reads a pasted try and finds the line the tutor's question is about.
//
// This is Lume's idea, aimed at code: do not describe the place, show it. The
// student page draws a red mark in the margin beside one line of the student's
// own text. It never rewrites that line and never shows what should be there.
// The mark says where to look, and the tutor's question says what to ask.
//
// The check is plain string work on the client. No model is called, so the
// mark appears the moment the try is sent, and it cannot contain a solution:
// every character it draws was typed by the student.
//
// It recognizes one shape on purpose, the one the demo and intro recursion
// both turn on: a function that calls itself with nothing before the call that
// could stop it. Anything else returns null, and the page draws no mark at
// all. A guess drawn confidently in red on the wrong line would teach the
// wrong thing with the professor's pen.

export type MarginNote = {
  /** Zero-based index of the line the mark sits beside. */
  line: number;
  /** `gap` is a recursion with nothing to stop it. `fixed` is the same function after the student added a stopping branch. */
  kind: "gap" | "fixed";
  /** The short label beside the mark. It names what is missing as a question of where, never as code. */
  label: string;
};

/**
 * The mark for one pasted try, or null when the text is not a recursive function this file can read.
 *
 * A function "has a stopping branch" when an `if` (or `while`, or a
 * conditional expression) appears between its `def` line and its first call
 * to itself. That is a deliberately loose reading. It will call a wrong base
 * case "fixed", and that is the right side to err on: the mark only says the
 * student has now written something that could stop the recursion. Whether it
 * is correct is the tutor's conversation, not a red or green line's verdict.
 */
export function readAttempt(text: string): MarginNote | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const def = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(lines[i]);
    if (!def) continue;
    const name = def[1];
    const indent = lines[i].search(/\S/);
    const call = new RegExp(`\\b${name}\\s*\\(`);

    let sawBranch = /\bif\b/.test(lines[i].slice(def[0].length));
    for (let j = i + 1; j < lines.length; j += 1) {
      const body = stripComment(lines[j]);
      if (body.trim().length === 0) continue;
      // A line indented no deeper than the `def` ends the function.
      if (body.search(/\S/) <= indent) break;
      if (/\b(if|elif|while)\b/.test(body)) sawBranch = true;
      if (call.test(body)) {
        return sawBranch
          ? { line: i, kind: "fixed", label: "something can stop the recursion now" }
          : { line: j, kind: "gap", label: "nothing before this call can stop it" };
      }
    }
  }
  return null;
}

/** A `#` comment is not code. "# if the list is empty" in a comment must not count as the branch the student has not written yet. */
function stripComment(line: string): string {
  const at = line.indexOf("#");
  return at === -1 ? line : line.slice(0, at);
}

/**
 * The code in a message, if the student pasted any.
 * The composer sends the try in its own field, and the server joins it under "What I tried:". A reloaded message arrives as that joined text, so the page splits on the same marker to find the try again.
 */
export function splitTurn(content: string): { question: string; attempt: string } {
  const marker = "\n\nWhat I tried:\n";
  const at = content.indexOf(marker);
  if (at === -1) return { question: content, attempt: "" };
  return { question: content.slice(0, at), attempt: content.slice(at + marker.length) };
}
