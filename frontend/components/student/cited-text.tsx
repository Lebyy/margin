"use client";

import NextLink from "next/link";
import { createContext, Fragment, useContext } from "react";
import type { Lecture } from "@/lib/api";

/**
 * The class's lectures, for turning Margin's slide citations into links.
 * The assignment page provides them; anywhere without a provider, citations
 * stay plain text.
 */
export const CitationContext = createContext<{ courseId: string; lectures: Lecture[] } | null>(null);

/** The one citation shape the tutor is told to write for a single slide (tutor.ts, level 2). */
const CITATION = /\[Lecture (\d{1,3}), slide (\d{1,4})\]/g;

/**
 * A reply from Margin, with each "[Lecture n, slide p]" made a link that
 * opens the class's slide viewer at that lecture and page.
 *
 * The text is split into plain strings and links and rendered as React
 * nodes, never as HTML, so nothing in a reply can become markup. A citation
 * is only a link when the class has a lecture with that number and the page
 * is within it; otherwise it stays as the words the tutor wrote, so a
 * mistaken number never sends a student to a slide that is not there.
 */
export function CitedText({ text }: { text: string }) {
  const ctx = useContext(CitationContext);
  if (!ctx || ctx.lectures.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(CITATION)) {
    const [whole, n, p] = m;
    const index = m.index ?? 0;
    const lecture = ctx.lectures.find((l) => l.lecture_number === Number(n));
    const page = Number(p);
    if (!lecture || page < 1 || page > lecture.page_count) continue;
    out.push(<Fragment key={`t${at}`}>{text.slice(at, index)}</Fragment>);
    out.push(
      <NextLink
        key={`l${index}`}
        href={`/course/${ctx.courseId}?tab=slides&lecture=${lecture.id}&page=${page}`}
        className="font-sans text-[0.9em] font-medium text-accent underline underline-offset-2"
      >
        {whole}
      </NextLink>,
    );
    at = index + whole.length;
  }
  out.push(<Fragment key={`t${at}`}>{text.slice(at)}</Fragment>);
  return <>{out}</>;
}
