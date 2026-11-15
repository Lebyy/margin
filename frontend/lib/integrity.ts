"use client";

// What the student page records for the professor's integrity review
// (backend/src/integrity.ts). Two things, both counts and timings only:
//
//  - How each message was written: characters typed, inserted by a phone
//    keyboard or input method, filled in by the page (dictation, a suggestion),
//    deleted; events a script made; the rhythm of key presses as a median and
//    a spread; time away from the page while writing. The keys themselves are
//    never kept or sent, so nothing typed and deleted, and nothing typed
//    anywhere else, ever leaves the browser.
//  - Time on each question: active and away time, how often the student left
//    the page, blocked pastes, copies of the question.
//
// Pasting text is off on the assignment page. A paste or drop of text is
// stopped and counted; a pasted or dropped file still goes through, because
// that is an upload, which the professor sees as a file.
//
// The student page shows none of this. The session panel says what the
// professor sees.

import { useCallback, useEffect, useRef } from "react";
import { API_BASE } from "@/lib/api";

/** One message's typing record, the shape the server's typingSchema accepts. */
export type Typing = {
  keys: number;
  typed: number;
  inserted: number;
  filled: number;
  deleted: number;
  synthetic: number;
  paste_blocked: number;
  compose_ms: number;
  iki_n: number;
  iki_median_ms: number;
  iki_cv_milli: number;
  away_ms: number;
  longest_away_ms: number;
  typed_after_away: number;
};

/** A single insert longer than this, not from the keyboard, is not counted as written. A swiped or predicted word is far shorter. */
const MAX_INSERT = 40;
/** A pause longer than this between keys is thinking, not rhythm, and is left out of the rhythm figures. */
const MAX_GAP_MS = 5000;
/** How long after returning to the page typed characters count toward "typed after time away". */
const AFTER_AWAY_MS = 30_000;

/** Median and coefficient of variation of the gaps between key presses. */
function rhythm(times: number[]): { n: number; median: number; cv: number } {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const g = times[i] - times[i - 1];
    if (g > 0 && g <= MAX_GAP_MS) gaps.push(g);
  }
  if (gaps.length < 2) return { n: gaps.length, median: 0, cv: 0 };
  const sorted = [...gaps].sort((a, b) => a - b);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  return { n: gaps.length, median: sorted[Math.floor(sorted.length / 2)], cv: mean > 0 ? sd / mean : 0 };
}

/**
 * Records how the text in one box is written, from the box's own events.
 *
 * Pass `ref` as the ref of an element that contains the text box (events bubble to it).
 * Call `filled(n)` when the page itself puts n characters in the box, `take()`
 * when the message is sent (it returns the record and starts a new one), and
 * `onBlocked` is told each time a paste or drop of text is stopped, so the
 * page can say why nothing appeared.
 */
export function useTypingRecorder(onBlocked: () => void) {
  const state = useRef(fresh());
  const blocked = useRef(onBlocked);
  useEffect(() => {
    blocked.current = onBlocked;
  }, [onBlocked]);

  function fresh() {
    return { startedAt: 0, keys: 0, typed: 0, inserted: 0, filled: 0, deleted: 0, synthetic: 0, pasteBlocked: 0, keyTimes: [] as number[], awayMs: 0, awayFrom: 0, longestAway: 0, longestAwayEnd: 0, typedAfterAway: 0 };
  }

  // Attached whenever the box's wrapper appears (a callback ref), because the
  // composer is drawn only once the session has loaded, after the first render.
  const detach = useRef<(() => void) | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!el) return;
    const s = () => state.current;
    let repeating = false;
    const begin = () => {
      if (!s().startedAt) s().startedAt = Date.now();
    };

    const onKey = (e: KeyboardEvent) => {
      if (!e.isTrusted) {
        s().synthetic += 1;
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      // A key held down repeats on its own. Those characters are the person's, but not typed one by one, so they are counted as inserted and kept out of the speed and rhythm.
      repeating = e.repeat;
      if (e.repeat) return;
      if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete" || e.key === "Enter" || e.key === "Tab") {
        begin();
        s().keys += 1;
        s().keyTimes.push(e.timeStamp);
        if (s().keyTimes.length > 4000) s().keyTimes.shift();
      }
    };

    const onBeforeInput = (e: InputEvent) => {
      if (!e.isTrusted) {
        s().synthetic += 1;
        return;
      }
      begin();
      const type = e.inputType;
      const data = e.data ?? "";
      if (type === "insertFromPaste" || type === "insertFromDrop" || type === "insertFromPasteAsQuotation") {
        e.preventDefault();
        s().pasteBlocked += 1;
        blocked.current();
        return;
      }
      if (type.startsWith("delete")) {
        const target = e.target as HTMLTextAreaElement | null;
        const selected = target && typeof target.selectionStart === "number" ? Math.abs((target.selectionEnd ?? 0) - target.selectionStart) : 0;
        s().deleted += Math.max(1, selected);
        return;
      }
      const length = [...data].length;
      if (type === "insertLineBreak" || type === "insertParagraph") {
        s().typed += 1;
      } else if (type === "insertText" && length <= 3 && repeating) {
        s().inserted += length;
      } else if (type === "insertText" && length <= 3) {
        s().typed += length;
      } else if (type === "insertText" || type === "insertReplacementText" || type === "insertCompositionText" || type === "insertFromComposition") {
        // A phone's swipe or prediction, an input method, autocorrect: written by the person, but not key by key.
        if (length <= MAX_INSERT) s().inserted += length;
      }
      // Undo and redo bring back text the person already wrote; they add nothing either way.
      if (s().longestAwayEnd && Date.now() - s().longestAwayEnd <= AFTER_AWAY_MS && (type === "insertText" || type === "insertLineBreak")) {
        s().typedAfterAway += Math.max(1, length);
      }
    };

    // Text pasted or dropped in is stopped before it arrives; a file is let through, since it becomes an attachment.
    const onPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) return;
      e.preventDefault();
      s().pasteBlocked += 1;
      blocked.current();
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.files.length) return;
      e.preventDefault();
      s().pasteBlocked += 1;
      blocked.current();
    };

    el.addEventListener("keydown", onKey, true);
    el.addEventListener("beforeinput", onBeforeInput, true);
    el.addEventListener("paste", onPaste, true);
    el.addEventListener("drop", onDrop, true);
    detach.current = () => {
      el.removeEventListener("keydown", onKey, true);
      el.removeEventListener("beforeinput", onBeforeInput, true);
      el.removeEventListener("paste", onPaste, true);
      el.removeEventListener("drop", onDrop, true);
    };
  }, []);

  // Time away while a message is being written: the page hidden or the window not focused.
  useEffect(() => {
    const leave = () => {
      if (state.current.startedAt && !state.current.awayFrom) state.current.awayFrom = Date.now();
    };
    const back = () => {
      const s = state.current;
      if (!s.awayFrom) return;
      const span = Date.now() - s.awayFrom;
      s.awayMs += span;
      if (span > s.longestAway) {
        s.longestAway = span;
        s.longestAwayEnd = Date.now();
        s.typedAfterAway = 0;
      }
      s.awayFrom = 0;
    };
    const onVisibility = () => (document.hidden ? leave() : back());
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const filled = useCallback((n: number) => {
    if (n > 0) state.current.filled += n;
  }, []);

  const take = useCallback((): Typing => {
    const s = state.current;
    const r = rhythm(s.keyTimes);
    const out: Typing = {
      keys: s.keys,
      typed: s.typed,
      inserted: s.inserted,
      filled: s.filled,
      deleted: s.deleted,
      synthetic: s.synthetic,
      paste_blocked: s.pasteBlocked,
      compose_ms: s.startedAt ? Math.min(Date.now() - s.startedAt, 24 * 3_600_000) : 0,
      iki_n: r.n,
      iki_median_ms: Math.round(r.median),
      iki_cv_milli: Math.round(r.cv * 1000),
      away_ms: Math.min(s.awayMs, 24 * 3_600_000),
      longest_away_ms: Math.min(s.longestAway, 24 * 3_600_000),
      typed_after_away: s.typedAfterAway,
    };
    state.current = fresh();
    return out;
  }, []);

  return { ref, filled, take };
}

/**
 * Reports time on the current question to the server: active time (the page
 * visible and focused, with the student doing something in the last minute),
 * time away, how often they left, blocked pastes, and copies of the question.
 * Sent every 30 seconds, when the question changes, and when the page is
 * hidden or closed (with sendBeacon, so the last stretch is not lost).
 */
export function useActivityReport(sessionId: string | null, questionIndex: number) {
  const totals = useRef({ active: 0, away: 0, awayCount: 0, longestAway: 0, paste: 0, copies: 0 });
  const lastTick = useRef(0);
  const lastInput = useRef(0);
  const awayFrom = useRef(0);
  const target = useRef({ sessionId, questionIndex });

  const flush = useCallback(() => {
    const { sessionId: id, questionIndex: q } = target.current;
    const t = totals.current;
    if (!id || (t.active === 0 && t.away === 0 && t.paste === 0 && t.copies === 0)) return;
    const body = JSON.stringify({ question_index: q, active_ms: Math.min(t.active, 600_000), away_ms: Math.min(t.away, 600_000), away_count: t.awayCount, longest_away_ms: t.longestAway, paste_blocked: t.paste, copies: t.copies });
    totals.current = { active: 0, away: 0, awayCount: 0, longestAway: 0, paste: 0, copies: 0 };
    const url = `${API_BASE}/api/sessions/${encodeURIComponent(id)}/activity`;
    // text/plain is the one type sendBeacon can send to another origin without a preflight; the server parses it.
    const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
    if (!sent) void fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body, keepalive: true }).catch(() => undefined);
  }, []);

  // A new question (or session) sends what the previous one had first.
  useEffect(() => {
    if (target.current.sessionId !== sessionId || target.current.questionIndex !== questionIndex) {
      flush();
      target.current = { sessionId, questionIndex };
    }
  }, [sessionId, questionIndex, flush]);

  useEffect(() => {
    lastTick.current = Date.now();
    lastInput.current = Date.now();
    const away = () => document.hidden || !document.hasFocus();
    const tick = () => {
      const now = Date.now();
      const dt = Math.min(now - lastTick.current, 5000);
      lastTick.current = now;
      if (away()) totals.current.away += dt;
      // Active means here and doing something recently: reading counts, a tab left open overnight does not.
      else if (now - lastInput.current < 60_000) totals.current.active += dt;
    };
    const leave = () => {
      tick();
      if (!awayFrom.current) {
        awayFrom.current = Date.now();
        totals.current.awayCount += 1;
      }
    };
    const back = () => {
      tick();
      if (awayFrom.current) {
        totals.current.longestAway = Math.max(totals.current.longestAway, Date.now() - awayFrom.current);
        awayFrom.current = 0;
      }
      lastInput.current = Date.now();
    };
    const input = () => {
      lastInput.current = Date.now();
    };
    const onVisibility = () => {
      if (document.hidden) {
        leave();
        flush();
      } else back();
    };
    const timer = window.setInterval(tick, 1000);
    const sender = window.setInterval(flush, 30_000);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    for (const ev of ["keydown", "pointerdown", "wheel", "touchstart"] as const) window.addEventListener(ev, input, { passive: true });
    return () => {
      window.clearInterval(timer);
      window.clearInterval(sender);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      for (const ev of ["keydown", "pointerdown", "wheel", "touchstart"] as const) window.removeEventListener(ev, input);
      flush();
    };
  }, [flush]);

  const pasteBlocked = useCallback(() => {
    totals.current.paste += 1;
  }, []);
  const copied = useCallback(() => {
    totals.current.copies += 1;
  }, []);
  return { pasteBlocked, copied };
}
