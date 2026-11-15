"use client";

import { motion } from "motion/react";
import { useRef } from "react";
import { readAttempt } from "@/lib/attempt";
import { cn } from "@/lib/utils";

/**
 * The student's work: a plain code editor on the paper sheet, with a live mark in the margin.
 *
 * This is where the assignment is solved. It replaces a chat box as the
 * center of the page: the student writes here, and Askretes' notes arrive
 * beside it.
 *
 * The mark is recomputed on every keystroke by `readAttempt`. While a
 * recursion has nothing before it that could stop it, a red "?" sits in the
 * margin beside that line. When the student adds a stopping branch, the mark
 * turns into a green check on the `def` line. Nothing is ever inserted into
 * the text. Every character in the editor is the student's.
 *
 * It is a textarea, not an editor library. The textarea grows with its
 * content so it never scrolls inside itself, which is what lets the line
 * numbers and the mark sit in a simple column beside it and stay aligned.
 * Both columns use the same fixed line height. Changing one without the other
 * moves the mark off its line.
 */
const LINE = "1.75rem";

export function CodeEditor({
  value,
  onChange,
  isDisabled = false,
  placeholder = "Write your code here",
}: {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  isDisabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const lines = value.split("\n");
  const rows = Math.max(lines.length, 12);
  const note = readAttempt(value);

  /** Tab indents by four spaces, as Python expects, instead of leaving the editor. Escape then Tab still moves focus on, so the keyboard is not trapped here. */
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.currentTarget.dataset.escaped = "1";
      return;
    }
    // Enter keeps the indent of the line above, and adds one level after a line that ends with a colon. Python reads indentation as structure, and the margin mark does too, so a body typed flush left would not be read as a function body at all.
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = el;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const line = value.slice(lineStart, start);
      const indent = (/^[ \t]*/.exec(line)?.[0] ?? "") + (line.trimEnd().endsWith(":") ? "    " : "");
      onChange(`${value.slice(0, start)}\n${indent}${value.slice(end)}`);
      const caret = start + 1 + indent.length;
      requestAnimationFrame(() => el.setSelectionRange(caret, caret));
      return;
    }
    // Backspace in leading whitespace removes one indent level, so leaving a block is one key.
    if (e.key === "Backspace") {
      const el = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = el;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const before = value.slice(lineStart, start);
      if (start === end && before.length >= 4 && before.trim() === "" && before.length % 4 === 0) {
        e.preventDefault();
        onChange(`${value.slice(0, start - 4)}${value.slice(end)}`);
        requestAnimationFrame(() => el.setSelectionRange(start - 4, start - 4));
        return;
      }
    }
    if (e.key !== "Tab" || e.shiftKey || e.currentTarget.dataset.escaped === "1") {
      delete e.currentTarget.dataset.escaped;
      return;
    }
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = el;
    onChange(`${value.slice(0, start)}    ${value.slice(end)}`);
    requestAnimationFrame(() => el.setSelectionRange(start + 4, start + 4));
  }

  return (
    <div className="flex font-mono text-[13.5px]" style={{ lineHeight: LINE }}>
      <div aria-hidden className="relative -ml-[calc(var(--paper-gutter)+1rem)] w-[calc(var(--paper-gutter)+1rem)] shrink-0 select-none max-sm:-ml-[calc(var(--paper-gutter)+0.75rem)] max-sm:w-[calc(var(--paper-gutter)+0.75rem)]">
        {Array.from({ length: rows }, (_, i) => {
          const marked = note?.line === i;
          return (
            <div key={i} className="flex" style={{ height: LINE }}>
              <span className="flex w-[var(--paper-gutter)] items-center justify-center">
                {marked ? (
                  <motion.span
                    key={note.kind}
                    initial={{ scale: 0.3, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 16 }}
                    className={cn("font-serif text-lg font-semibold", note.kind === "gap" ? "text-margin-red" : "text-margin-green")}
                  >
                    {note.kind === "gap" ? "?" : "✓"}
                  </motion.span>
                ) : (
                  <span className="text-[11px] text-muted/60">{i + 1}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="relative min-w-0 flex-1">
        {note ? (
          <div
            aria-hidden
            className={cn("pointer-events-none absolute inset-x-0 rounded-sm", note.kind === "gap" ? "bg-margin-red-soft" : "bg-margin-green-soft")}
            style={{ top: `calc(${LINE} * ${note.line})`, height: LINE }}
          />
        ) : null}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isDisabled}
          rows={rows}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Your work"
          aria-describedby="editor-note"
          placeholder={placeholder}
          className="relative block w-full resize-none overflow-hidden whitespace-pre bg-transparent outline-none placeholder:text-muted/50"
          style={{ lineHeight: LINE, tabSize: 4 }}
        />
        <p id="editor-note" className={cn("mt-1 font-sans text-xs", note ? (note.kind === "gap" ? "text-margin-red" : "text-margin-green") : "sr-only")} aria-live="polite">
          {note ? `Line ${note.line + 1}: ${note.label}` : "No mark in the margin."}
        </p>
      </div>
    </div>
  );
}
