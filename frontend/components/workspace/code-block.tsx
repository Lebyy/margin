"use client";

import { motion } from "motion/react";
import { readAttempt } from "@/lib/attempt";
import { cn } from "@/lib/utils";

/** The fixed line height of the block. The mark column and the code share it, so a change to one without the other moves the mark off its line. */
const LINE = "1.6rem";

/**
 * The student's code as it sits in the conversation, read-only, with the
 * margin mark beside the line the demo is about.
 *
 * This is where the typed-line highlight lives now that the work is pasted
 * into the chat instead of written in a separate editor. `readAttempt` reads
 * the code on the client with plain string checks: while a recursive call has
 * nothing before it that could stop it, that line gets the red "?" and a
 * tint, and the note under the block says where to look. When the student has
 * written a stopping branch, the `def` line gets the green check. Nothing is
 * added to the code. Every character shown is the student's, so the mark
 * cannot carry a solution.
 *
 * `quiet` drops the note line, for the attachment card in the message box,
 * where the mark alone says enough and the card must stay short.
 */
export function CodeBlock({ code, quiet = false, className }: { code: string; quiet?: boolean; className?: string }) {
  const lines = code.replace(/\s+$/, "").split("\n");
  const note = readAttempt(code);
  return (
    <figure className={cn("overflow-hidden rounded-xl border border-border bg-surface", className)}>
      <div className="overflow-x-auto py-2 font-mono text-[13px]" style={{ lineHeight: LINE }}>
        {lines.map((line, i) => {
          const marked = note?.line === i;
          return (
            <div key={i} className={cn("flex min-w-max pr-4", marked && (note.kind === "gap" ? "bg-margin-red-soft" : "bg-margin-green-soft"))} style={{ height: LINE }}>
              <span aria-hidden className="flex w-9 shrink-0 select-none items-center justify-center">
                {marked ? (
                  <motion.span
                    key={note.kind}
                    initial={{ scale: 0.3, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 16 }}
                    className={cn("font-serif text-base font-semibold", note.kind === "gap" ? "text-margin-red" : "text-margin-green")}
                  >
                    {note.kind === "gap" ? "?" : "✓"}
                  </motion.span>
                ) : (
                  <span className="text-[11px] text-muted/60">{i + 1}</span>
                )}
              </span>
              <code className="whitespace-pre">{line || " "}</code>
            </div>
          );
        })}
      </div>
      {note && !quiet ? (
        <figcaption className={cn("border-t border-border px-3 py-1.5 text-xs", note.kind === "gap" ? "text-margin-red" : "text-margin-green")}>
          Line {note.line + 1}: {note.label}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * Whether pasted text is work rather than a question.
 *
 * Askretes has no separate editor any more: the student pastes their attempt
 * into the message box. A paste of three or more lines, or one that has a
 * code shape (a `def`, a `return`, a brace, an indented line), becomes an
 * attachment above the box instead of words in it, the way a long paste
 * becomes a card in a chat app. That keeps the try in its own field when it
 * is sent, which is what the server's scribe reads as an attempt, and the
 * question the student types stays a question.
 */
export function looksLikeWork(text: string): boolean {
  const lines = text.replace(/\s+$/, "").split("\n");
  if (lines.length >= 3) return true;
  return /^\s*(def|class|for|while|if|return|import|function|const|let|var|public|#include)\b|[{};]\s*$|^( {2,}|\t)\S/m.test(text) && lines.length >= 2;
}

/**
 * Splits a typed message into the question and any fenced code in it.
 * A student who types ``` around their code by hand gets the same result as
 * one who pastes it: the fenced part is sent as the try.
 */
export function splitFenced(text: string): { question: string; code: string } {
  const fence = /```[a-zA-Z0-9]*\n?([\s\S]*?)```/g;
  const blocks: string[] = [];
  const question = text.replace(fence, (_, body: string) => {
    blocks.push(body.replace(/\s+$/, ""));
    return "";
  });
  return { question: question.trim(), code: blocks.join("\n\n") };
}
