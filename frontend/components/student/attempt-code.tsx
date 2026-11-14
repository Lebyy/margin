"use client";

import { Chip } from "@heroui/react";
import { motion } from "motion/react";
import { MarginMark } from "@/components/paper";
import { readAttempt } from "@/lib/attempt";
import { cn } from "@/lib/utils";

/**
 * A student's pasted try, shown as they typed it, with one mark in the margin.
 *
 * Every character here is the student's. The mark sits beside one of their
 * lines and that line gets a tint. Nothing is inserted, corrected, or
 * completed. A version of this component that showed "what the line should
 * be" would be the answer, written in the margin by the product whose rule is
 * that the margin never holds the answer.
 *
 * `readAttempt` decides the line. When it cannot read the code as a recursive
 * function, there is no mark and the code is shown plain.
 *
 * The label is real text under the code, so the same information reaches a
 * screen reader. The red glyph in the gutter is decoration.
 */
export function AttemptCode({ code }: { code: string }) {
  const note = readAttempt(code);
  const lines = code.split("\n");
  return (
    <figure className="mt-2">
      <figcaption className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">What I tried</figcaption>
      <pre className="font-mono text-[13px] leading-7">
        {lines.map((line, i) => {
          const marked = note?.line === i;
          return (
            <span key={i} className="relative block">
              {marked ? (
                <MarginMark tone={note.kind === "gap" ? "red" : "green"}>
                  <motion.span
                    initial={{ scale: 0.3, opacity: 0, rotate: -20 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 380, damping: 16, delay: 0.25 }}
                    className="text-lg leading-none"
                  >
                    {note.kind === "gap" ? "?" : "✓"}
                  </motion.span>
                </MarginMark>
              ) : null}
              <span
                className={cn(
                  "block whitespace-pre-wrap break-words rounded-sm px-1.5",
                  marked && (note.kind === "gap" ? "bg-margin-red-soft" : "bg-margin-green-soft"),
                )}
              >
                {line.length > 0 ? line : " "}
              </span>
            </span>
          );
        })}
      </pre>
      {note ? (
        <Chip size="sm" variant="soft" color={note.kind === "gap" ? "danger" : "success"} className="mt-1.5">
          line {note.line + 1}: {note.label}
        </Chip>
      ) : null}
    </figure>
  );
}
