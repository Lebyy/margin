"use client";

import { motion, useReducedMotion } from "motion/react";
import type { PhotoBox } from "@/lib/api";

/**
 * The student's photo with the professor's red ellipse around one line.
 *
 * Where the ellipse goes is the vision model's decision and nothing else.
 * The model returns the box of the written line the mistake is on (in
 * Gemini's [ymin, xmin, ymax, xmax] format, converted on the server to 0-to-1
 * units of the image), and the box is in units of this exact image, because
 * lib/photo.ts sends the image it shows. The page does not read the photo,
 * move the box, or pick a default position. This component is only rendered
 * after a 200 from the vision route, so a 501 draws no image and no ellipse.
 *
 * The ellipse is the model's box scaled about its own centre: 1.18x as wide
 * and 2x as tall. An ellipse inscribed in the box would pass through the
 * line's letters at both ends; at that scale all four corners of the model's
 * box sit inside the curve ((1/1.18)^2 + (1/2)^2 < 1), so the pen goes around
 * the line. The scale changes the ellipse's size only, never its centre.
 *
 * The ellipse is decoration for a sighted reader; the step it marks is in the
 * caption and in the image's alt text.
 */
export function PhotoMark({ src, box, step }: { src: string; box: PhotoBox; step: string }) {
  const reduce = useReducedMotion();
  const width = box.w * 1.18;
  const height = box.h * 2;
  const left = box.x + box.w / 2 - width / 2;
  const top = box.y + box.h / 2 - height / 2;

  return (
    <figure className="mt-2 max-w-xl">
      <div className="relative overflow-visible rounded-md border border-border bg-surface p-0">
        {/* A data: URL that never leaves the browser, so next/image has nothing to optimize. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Photo of your work. The red ellipse marks: ${step}`} className="block h-auto w-full rounded-md" />
        <motion.span
          aria-hidden
          data-ellipse
          className="pointer-events-none absolute rounded-[50%] border-[3px] border-margin-red"
          style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}
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
