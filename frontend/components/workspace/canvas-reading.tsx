"use client";

import { motion, useReducedMotion } from "motion/react";
import type { Annotation } from "@/lib/api";

/**
 * What Askretes saw on the canvas: the picture it was sent, with a numbered red
 * ellipse around each part it marked, and the notes under it.
 *
 * Where each ellipse goes is the vision model's box and nothing else, in 0-to-1
 * units of this exact picture, because the page shows the picture it sent.
 * The page does not move a box or choose a default place. The ellipse is
 * the box widened about its own centre, the same shape the photo mark uses,
 * so the pen goes around the part rather than through it.
 *
 * The notes are the guard-checked words from the server, printed as text.
 * Each says where to look, never what the fix is. The ellipses are for a
 * sighted reader; every mark is also in the numbered list, so a screen reader
 * loses nothing.
 */
export function CanvasReading({ src, annotation }: { src: string; annotation: Annotation }) {
  const reduce = useReducedMotion();
  const marks = annotation.marks.filter((m) => m.box.w > 0 && m.box.h > 0);
  return (
    <figure className="flex flex-col gap-2">
      <div className="relative max-w-xl overflow-hidden rounded-xl border border-border bg-surface">
        {/* A data: URL made in this browser, so next/image has nothing to optimize. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Your canvas, as Askretes saw it" className="block h-auto w-full" />
        {marks.map((m, i) => {
          const width = m.box.w * 1.15;
          const height = m.box.h * 1.4;
          const left = m.box.x + m.box.w / 2 - width / 2;
          const top = m.box.y + m.box.h / 2 - height / 2;
          return (
            <motion.span
              key={i}
              aria-hidden
              className="pointer-events-none absolute rounded-[50%] border-[2.5px] border-margin-red"
              style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}
              initial={reduce ? false : { opacity: 0, scale: 1.2 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: i * 0.12, ease: "easeOut" }}
            >
              <span className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-margin-red text-[11px] font-semibold text-background">{i + 1}</span>
            </motion.span>
          );
        })}
      </div>
      {annotation.marks.length > 0 ? (
        <figcaption>
          <ol className="flex flex-col gap-1 text-sm">
            {annotation.marks.map((m, i) => (
              <li key={i} className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-margin-red-soft text-[11px] font-semibold text-margin-red">{i + 1}</span>
                <span>
                  <span className="font-medium">{m.label}</span>
                  {m.note ? <span className="text-muted"> — {m.note}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </figcaption>
      ) : null}
    </figure>
  );
}
