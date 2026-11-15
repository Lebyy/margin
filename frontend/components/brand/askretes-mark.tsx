"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";

/*
 * The Askretes mark, drawn in SVG so it scales, takes the theme's tokens, and
 * can move. It is the letter A from the logo file: the left leg is the red pen
 * stroke, the right leg and the bar are ink, and the two short lines across
 * the left leg are the pen's marks in the margin of the work.
 *
 * The paths are traced from the 1024px logo, so the viewBox is cut from that
 * square. There is no background: the letter sits on whatever it is drawn on.
 * Colours come from `--margin-red` and the foreground token, never a hex, so a
 * theme edit reaches the mark too. (app/icon.svg is the same art with the two
 * colours written in, because a browser tab cannot read the page's tokens.)
 */

/** The red leg: a swash from the foot at bottom left to the apex. */
const RED_LEG =
  "M567 104C520 98 474 120 446 178L214 744C196 790 166 836 140 868C118 896 138 916 182 914C238 911 276 880 296 828L503 262C522 210 538 138 567 104Z";
/** The ink leg: from under the apex to the serifed foot at bottom right. */
const INK_LEG =
  "M563 112C541 150 520 210 500 262L708 808C722 846 718 872 688 878L688 906L914 906L914 886C878 882 858 858 842 822L582 176C574 154 567 132 563 112Z";
/** The crossbar, with its small serif turned down at the right. */
const BAR = "M362 614L588 610C604 609 614 602 624 598C620 620 622 642 628 664C612 652 600 646 584 646L358 648Z";
/** The centre line of the red leg, foot to apex: the path the pen follows when the mark is drawn in. */
const PEN_PATH = "M150 892C210 880 246 846 262 800L476 230C500 168 524 126 560 108";
/** The two pen marks across the left leg, top first. */
const MARKS = ["M350 497L509 492", "M336 546L484 543"];

/** The box around the letter in the logo's units, with no margin: the A's feet sit on the bottom edge, so the mark can stand on a text baseline. */
const VIEWBOX = "118 96 806 820";

/** One pass of the thinking animation, in seconds. */
const LOOP = 2.6;

/*
 * The thinking pass, as fractions of LOOP. Named so the pieces stay in step:
 * the pen writes the leg, then the two marks, the letter hops for joy, and
 * then the pen runs back over its work so the next pass starts clean.
 */
const T = { legDone: 0.3, mark1: [0.32, 0.4], mark2: [0.4, 0.48], hop: [0.5, 0.55, 0.63, 0.7, 0.76], erase: [0.8, 0.86, 0.97] };

/**
 * The Askretes mark.
 *
 * Still, it is the logo. With `thinking`, it shows that a reply is being
 * written by writing itself, and is a little pleased about it:
 *  1. the red leg is stroked in from the foot to the apex, as a pen would;
 *  2. the two margin marks are ticked in, left to right, one after the other;
 *  3. the letter crouches, hops, leans, and lands with a squash;
 *  4. the marks and the red leg are wound back off the page, and it starts again.
 * The ink leg and the bar never leave, so the letter is always readable.
 *
 * With reduced motion set, a thinking mark does not draw or hop; it breathes
 * in opacity only, which still says something is happening.
 */
export function AskretesMark({ thinking = false, className, title }: { thinking?: boolean; className?: string; title?: string }) {
  const reduce = useReducedMotion();
  const maskId = `askretes-pen-${useId().replace(/:/g, "")}`;
  const drawing = thinking && !reduce;
  const loop = { duration: LOOP, repeat: Infinity };

  return (
    <motion.svg
      viewBox={VIEWBOX}
      className={cn("size-6 shrink-0 overflow-visible", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      animate={thinking && reduce ? { opacity: [1, 0.45, 1] } : { opacity: 1 }}
      transition={thinking && reduce ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
    >
      {drawing ? (
        <defs>
          {/* The red leg shows through a pen stroke that grows along its centre line, so it appears as written, and is wound back the same way. */}
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
            <motion.path
              d={PEN_PATH}
              fill="none"
              stroke="white"
              strokeWidth={190}
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: [0, 1, 1, 0, 0] }}
              transition={{ ...loop, times: [0, T.legDone, T.erase[1], T.erase[2], 1], ease: ["easeInOut", "linear", "easeIn", "linear"] }}
            />
          </mask>
        </defs>
      ) : null}
      {/* The hop moves the whole letter about its feet, so the squash looks like landing on the line it stands on. */}
      <motion.g
        style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
        animate={
          drawing
            ? {
                y: [0, 0, 0, -120, 0, 0, 0],
                scaleX: [1, 1, 1.1, 0.94, 1.08, 1, 1],
                scaleY: [1, 1, 0.86, 1.08, 0.9, 1, 1],
                rotate: [0, 0, 0, -8, 4, 0, 0],
              }
            : { y: 0, scaleX: 1, scaleY: 1, rotate: 0 }
        }
        transition={drawing ? { ...loop, times: [0, ...T.hop, 1], ease: ["linear", "easeOut", "easeOut", "easeIn", "easeOut", "linear"] } : { duration: 0.3 }}
      >
        <path d={INK_LEG} className="fill-foreground" />
        <path d={BAR} className="fill-foreground" />
        <path d={RED_LEG} className="fill-margin-red" mask={drawing ? `url(#${maskId})` : undefined} />
        {MARKS.map((d, i) => {
          if (!drawing) return <path key={d} d={d} fill="none" className="stroke-foreground" strokeWidth={15} strokeLinecap="round" />;
          const [start, end] = i === 0 ? T.mark1 : T.mark2;
          return (
            <motion.path
              key={d}
              d={d}
              fill="none"
              className="stroke-foreground"
              strokeWidth={15}
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              // Ticked in quickly with a little overshoot, held through the hop, then wound off just before the leg.
              animate={{ pathLength: [0, 0, 1, 1, 0, 0] }}
              transition={{ ...loop, times: [0, start, end, T.erase[0], T.erase[1], 1], ease: ["linear", "backOut", "linear", "easeIn", "linear"] }}
            />
          );
        })}
      </motion.g>
    </motion.svg>
  );
}

/**
 * The wordmark: the mark stands in for the capital A, and the rest of the
 * name follows in the serif, so it reads "Askretes" with the logo as its
 * first letter. The mark is sized to the cap height of the text around it
 * and sits on the same baseline. Screen readers hear the whole word once.
 */
export function AskretesWordmark({ className, thinking = false }: { className?: string; thinking?: boolean }) {
  return (
    <span className={cn("inline-flex items-baseline font-serif font-semibold tracking-tight", className)} aria-label="Askretes" role="img">
      <AskretesMark thinking={thinking} className="mr-[0.02em] h-[0.78em] w-[0.77em] self-baseline" />
      <span aria-hidden>skretes</span>
    </span>
  );
}
