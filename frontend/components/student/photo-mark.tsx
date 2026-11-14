"use client";

import { motion, useReducedMotion } from "motion/react";
import type { PhotoBox } from "@/lib/api";

/**
 * The student's photo with the professor's red ellipse around one step.
 *
 * The ellipse is placed from the box the server returned and from nothing
 * else: the box is in 0-to-1 units of this exact image (lib/photo.ts sends
 * the image it shows), so percentages of the wrapper put it where the model
 * marked. There is no default position. This component is only rendered
 * after a 200 from the vision route, so a 501 draws no image and no ellipse.
 *
 * The ellipse is a little larger than the box, the way a pen circles a line
 * without crossing the letters. It is decoration for a sighted reader; the
 * step it marks is in the caption and in the image's alt text.
 */
export function PhotoMark({ src, box, step }: { src: string; box: PhotoBox; step: string }) {
  const reduce = useReducedMotion();
  // Padding in the same 0-to-1 units: wider than tall, because a line of code is.
  const padX = 0.02;
  const padY = 0.035;
  const left = box.x - padX;
  const top = box.y - padY;
  const width = box.w + 2 * padX;
  const height = box.h + 2 * padY;

  return (
    <figure className="mt-2 max-w-xl">
      <div className="relative overflow-visible rounded-md border border-border bg-surface p-0">
        {/* A data: URL that never leaves the browser, so next/image has nothing to optimize. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Photo of your work. The red ellipse marks: ${step}`} className="block h-auto w-full rounded-md" />
        <motion.span
          aria-hidden
          className="pointer-events-none absolute rounded-[50%] border-[3px] border-margin-red"
          style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%`, rotate: -2 }}
          initial={reduce ? false : { opacity: 0, scale: 1.25 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.32, ease: "easeOut" }}
        />
      </div>
      <figcaption className="mt-2 flex gap-1.5 text-sm">
        <span className="font-medium text-margin-red">Marked:</span>
        <span>{step}</span>
      </figcaption>
    </figure>
  );
}
