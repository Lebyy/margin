"use client";

import { CountingNumber } from "@/components/animate-ui/primitives/texts/counting-number";

/**
 * A number from the API, counted up to on screen.
 *
 * The value is whatever the API returned. This component never computes one.
 * It only animates from zero to that value when it appears.
 *
 * Two things keep the animation from misstating the number:
 *
 * The spring is stiff and overdamped, so it reaches the value in about half a
 * second and cannot overshoot it. With Animate UI's default spring the count
 * took over a second, and a screenshot taken in that second showed 41% beside
 * a row that said 50%. A percent that is briefly wrong on a professor's
 * dashboard is a wrong percent.
 *
 * The real value is also in the page as text for assistive technology, and
 * the moving digits are hidden from it. A screen reader announces the value
 * once, correctly, and never an in-between frame.
 */
export function ApiNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  return (
    <>
      <span className="sr-only">
        {value}
        {suffix}
      </span>
      <span aria-hidden>
        <CountingNumber number={value} transition={{ stiffness: 320, damping: 42 }} />
        {suffix}
      </span>
    </>
  );
}
