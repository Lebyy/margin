"use client";

import { Button } from "@heroui/react";
import { Eraser, Highlighter, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import "pdfjs-dist/web/pdf_viewer.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * Lecture slides drawn by pdf.js (the same library the API uses to read their
 * text), instead of the browser's built-in viewer in an iframe. Drawing them
 * ourselves is what makes two things possible that the iframe never allowed:
 *
 *  - The slide Askretes points to is marked on the slide itself: the pane
 *    scrolls to it and outlines it (and every slide in a cited range).
 *  - Students can highlight. Selecting text on a slide offers Highlight; the
 *    highlight is kept in this browser per lecture (like the student's own
 *    canvas) and shown on every visit. Clicking a highlight removes it.
 *
 * Each page is a canvas at the pane's width (sharp on high-density screens)
 * with pdf.js's text layer over it, so text can be selected and searched with
 * the browser's find. Pages are drawn only when they come near the screen,
 * so a 60-slide deck opens as fast as a 6-slide one.
 */

type Rect = { x: number; y: number; w: number; h: number };
type Mark = { id: string; page: number; rects: Rect[]; text: string };

const storeKey = (lectureId: string) => `askretes.highlights.${lectureId}`;

/** The student's highlights on one lecture, from this browser. Storage that is blocked or holds something unreadable gives none. */
function readMarks(lectureId: string): Mark[] {
  try {
    const raw = window.localStorage.getItem(storeKey(lectureId));
    const list = raw ? (JSON.parse(raw) as Mark[]) : [];
    return Array.isArray(list) ? list.filter((m) => typeof m.page === "number" && Array.isArray(m.rects)) : [];
  } catch {
    return [];
  }
}

function writeMarks(lectureId: string, marks: Mark[]) {
  try {
    window.localStorage.setItem(storeKey(lectureId), JSON.stringify(marks));
  } catch {
    // Storage full or blocked: the highlight stays for this visit only.
  }
}

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number; scale: number };
  render: (o: { canvas: HTMLCanvasElement; viewport: unknown; transform?: number[] }) => { promise: Promise<void>; cancel: () => void };
  streamTextContent: () => ReadableStream;
};

export function PdfSlides({
  src,
  title,
  page,
  cited,
  lectureId,
}: {
  /** The PDF's address. */
  src: string;
  title: string;
  /** The slide to show, 1-based; null keeps the reader where they are. */
  page: number | null;
  /** Slides Askretes pointed to, and a stamp that changes each time one is pressed. */
  cited: { from: number; to: number; at: number } | null;
  /** Where this lecture's highlights are kept. */
  lectureId: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  // Read once: the viewer is keyed by lecture (slide-viewer.tsx), so another lecture is a fresh viewer with its own highlights.
  const [marks, setMarks] = useState<Mark[]>(() => readMarks(lectureId));
  const marksRef = useRef(marks);
  useEffect(() => {
    marksRef.current = marks;
  }, [marks]);
  const [pending, setPending] = useState<{ page: number; rects: Rect[]; text: string; x: number; y: number } | null>(null);
  // A highlight the student clicked: the text layer sits over highlights (so their text stays selectable), so a click is matched to a highlight by position here.
  const [picked, setPicked] = useState<{ id: string; x: number; y: number } | null>(null);

  // The document: fetched whole (one request, no range requests across origins) and opened with pdf.js, whose worker parses it off the main thread.
  useEffect(() => {
    let live = true;
    // The loading task owns the worker-side document; destroying it is how pdf.js frees both.
    let task: { promise: Promise<unknown>; destroy?: () => Promise<void> } | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const data = await (await fetch(src)).arrayBuffer();
        task = pdfjs.getDocument({ data }) as unknown as { promise: Promise<unknown>; destroy?: () => Promise<void> };
        const opened = (await task.promise) as PdfDoc;
        const all: { w: number; h: number }[] = [];
        for (let n = 1; n <= opened.numPages; n++) {
          const v = (await opened.getPage(n)).getViewport({ scale: 1 });
          all.push({ w: v.width, h: v.height });
        }
        if (!live) return;
        setSizes(all);
        setDoc(opened);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      void task?.destroy?.().catch(() => undefined);
    };
  }, [src]);

  // The pane's width decides the drawing scale; dragging the pane wider redraws the pages sharper.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A citation (or choosing a page) scrolls that slide into view once the pages have their sizes.
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!page || !sizes.length || !width) return;
    // The slide's outer block, so the "Askretes pointed here" line above a cited slide is in view too.
    const el = box.current?.querySelector<HTMLElement>(`[data-slide="${page}"]`);
    el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [page, cited?.at, sizes.length, width, reduce]);

  // Selecting text on a slide offers Highlight, placed just above the selection.
  const onSelect = useCallback(
    (e?: { clientX: number; clientY: number; target?: EventTarget | null }) => {
    // A press on the Highlight or Remove button is not a new selection or a click on the slide; leave the popover to handle it.
    if (e?.target instanceof Element && e.target.closest("[data-slide-popover]")) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !box.current) {
      setPending(null);
      // A plain click: if it landed on a highlight, offer to remove that one.
      const host = box.current;
      const pageEl = e && host ? (document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-page]") ?? null) : null;
      if (!e || !host || !pageEl) {
        setPicked(null);
        return;
      }
      const p = pageEl.getBoundingClientRect();
      const fx = (e.clientX - p.left) / p.width;
      const fy = (e.clientY - p.top) / p.height;
      const n = Number(pageEl.dataset.page);
      const hit = marksRef.current.find((m) => m.page === n && m.rects.some((r) => fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h));
      const h = host.getBoundingClientRect();
      setPicked(hit ? { id: hit.id, x: e.clientX - h.left, y: e.clientY - h.top + host.scrollTop - 6 } : null);
      return;
    }
    setPicked(null);
    const range = sel.getRangeAt(0);
    const pageEl = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest<HTMLElement>("[data-page]");
    if (!pageEl) {
      setPending(null);
      return;
    }
    const p = pageEl.getBoundingClientRect();
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({ x: (r.left - p.left) / p.width, y: (r.top - p.top) / p.height, w: r.width / p.width, h: r.height / p.height }));
    if (!rects.length) return;
    const b = range.getBoundingClientRect();
    const host = box.current.getBoundingClientRect();
    setPending({ page: Number(pageEl.dataset.page), rects, text: sel.toString().slice(0, 500), x: b.left - host.left + b.width / 2, y: b.top - host.top + box.current.scrollTop });
    },
    [],
  );

  function keep() {
    if (!pending) return;
    const next = [...marks, { id: crypto.randomUUID(), page: pending.page, rects: pending.rects, text: pending.text }];
    setMarks(next);
    writeMarks(lectureId, next);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }

  function remove(id: string) {
    const next = marks.filter((m) => m.id !== id);
    setMarks(next);
    writeMarks(lectureId, next);
  }

  if (failed) return <p className="px-5 py-8 text-sm text-muted">These slides could not be opened here. Use the download button above.</p>;

  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-y-auto bg-default/40 px-3 py-3 sm:px-4" onMouseUp={(e) => onSelect(e)} onKeyUp={() => onSelect()} aria-label={title}>
      {!doc ? <p className="py-10 text-center text-sm text-muted">Opening the slides…</p> : null}
      {doc && width
        ? sizes.map((s, i) => {
            const n = i + 1;
            const isCited = !!cited && n >= cited.from && n <= cited.to;
            return (
              <SlidePage
                key={n}
                doc={doc}
                n={n}
                width={width - 2}
                ratio={s.h / s.w}
                cited={isCited}
                citedAt={isCited ? cited!.at : 0}
                marks={marks.filter((m) => m.page === n)}
                onRemove={remove}
              />
            );
          })
        : null}
      {picked ? (
        <div data-slide-popover className="absolute z-20 -translate-x-1/2 -translate-y-full" style={{ left: picked.x, top: picked.y }}>
          <Button
            size="sm"
            variant="secondary"
            className="shadow-md"
            onPress={() => {
              remove(picked.id);
              setPicked(null);
            }}
          >
            <Eraser className="size-3.5" aria-hidden /> Remove highlight
          </Button>
        </div>
      ) : null}
      {pending ? (
        <div data-slide-popover className="absolute z-20 -translate-x-1/2 -translate-y-full pb-1.5" style={{ left: pending.x, top: pending.y }}>
          <Button size="sm" variant="primary" className="shadow-md" onPress={keep}>
            <Highlighter className="size-3.5" aria-hidden /> Highlight
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** One slide: drawn when it comes near the screen, with its text layer, the student's highlights, and the cited outline. */
function SlidePage({ doc, n, width, ratio, cited, citedAt, marks, onRemove }: { doc: PdfDoc; n: number; width: number; ratio: number; cited: boolean; citedAt: number; marks: Mark[]; onRemove: (id: string) => void }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const text = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  const reduce = useReducedMotion();
  const height = Math.round(width * ratio);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || !canvas.current || !text.current || width < 50) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      const page = await doc.getPage(n);
      if (cancelled || !canvas.current || !text.current) return;
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const c = canvas.current;
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      c.style.width = `${Math.floor(viewport.width)}px`;
      c.style.height = `${Math.floor(viewport.height)}px`;
      const render = page.render({ canvas: c, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task = render;
      await render.promise.catch(() => undefined);
      if (cancelled || !text.current) return;
      text.current.replaceChildren();
      text.current.style.setProperty("--scale-factor", String(viewport.scale));
      text.current.style.setProperty("--total-scale-factor", String(viewport.scale));
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text.current, viewport: viewport as never });
      await layer.render().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, doc, n, width]);

  return (
    <div className="mb-3 scroll-mt-2 last:mb-0" data-slide={n}>
      {cited ? (
        <motion.p key={citedAt} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mb-1 flex items-center gap-1 text-xs font-medium text-margin-red">
          <Sparkles className="size-3.5" aria-hidden /> Askretes pointed here · slide {n}
        </motion.p>
      ) : null}
      <div
        ref={wrap}
        data-page={n}
        className={cn("relative mx-auto overflow-hidden rounded-md bg-surface shadow-sm", cited ? "ring-2 ring-margin-red ring-offset-2 ring-offset-paper" : "ring-1 ring-border")}
        style={{ width, height }}
        aria-label={`Slide ${n}`}
      >
        <canvas ref={canvas} className="absolute inset-0" aria-hidden />
        {/* The student's highlights sit under the text layer, so the text above them can still be selected. A mouse click is matched to them by position (see onSelect); a keyboard user tabs to one and presses it to remove it. */}
        {marks.map((m) =>
          m.rects.map((r, i) => (
            <button
              key={`${m.id}-${i}`}
              type="button"
              title={`Remove highlight: “${m.text.slice(0, 60)}”`}
              aria-label={`Remove highlight: ${m.text.slice(0, 60)}`}
              onClick={() => onRemove(m.id)}
              tabIndex={0}
              className="pointer-events-none absolute z-[2] rounded-[2px] bg-warning/35 mix-blend-multiply outline-offset-1 focus-visible:bg-danger/30"
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
            />
          )),
        )}
        <div ref={text} className="textLayer" />
        {cited ? <CitedGlow key={citedAt} /> : null}
      </div>
    </div>
  );
}

/** A soft red wash over a cited slide that fades, so the eye lands on it. Instant under reduced motion. */
function CitedGlow() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[3] bg-margin-red-soft"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={reduce ? { duration: 0, delay: 1.5 } : { duration: 1.4, delay: 0.8, ease: "easeOut" }}
    />
  );
}
