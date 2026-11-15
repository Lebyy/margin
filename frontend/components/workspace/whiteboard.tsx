"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { readFiles, writeFiles } from "@/lib/whiteboard";

/** How long the board waits after the last change before saving it, so a stroke is not written to storage at every pointer move. */
const SAVE_DELAY = 600;

/**
 * The canvas: Excalidraw, the open-source whiteboard, in the pane.
 *
 * It is the whole drawing surface, with Excalidraw's own tools (shapes,
 * arrows, freehand, text, images, the eraser, undo). The board has no ask box
 * of its own. The student talks to Askretes in the chat, and the chat draws on
 * the board ("draw a concept map of recursion") or reads it ("check what I
 * drew on the canvas"). The page does both through the board's API, which
 * this component hands up through `onApi` once Excalidraw is ready.
 *
 * The board is this student's own, kept in this browser under `storageKey`
 * and nowhere else. Nothing on it is sent anywhere until the student asks
 * Askretes to look at it. Storage can be full or blocked: the board still works
 * for the visit, and a picture too large to keep is left out of the saved
 * copy rather than losing the drawing around it.
 *
 * It is imported with `ssr: false`, because Excalidraw reads the window as it
 * loads and there is no board to render on the server.
 */
export default function Whiteboard({ storageKey, onApi }: { storageKey: string; onApi: (api: ExcalidrawImperativeAPI | null) => void }) {
  const timer = useRef<number | null>(null);
  /** The save the timer is waiting to run. It is run at once when the board unmounts, so a stroke made just before switching tabs is not lost. */
  const pending = useRef<(() => void) | null>(null);
  const candidates = useRef<ExcalidrawImperativeAPI[]>([]);
  /** Saved-scene loads still out. See initialData. */
  const loads = useRef(0);
  const announced = useRef(false);
  const announce = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      announced.current = true;
      onApi(api);
    },
    [onApi],
  );
  const flush = () => {
    pending.current?.();
    pending.current = null;
  };

  // When the board leaves the screen (another tab, the pane closed), the last change is saved and the page is told, so it waits for the board to come back instead of drawing on one that is gone.
  useEffect(
    () => () => {
      flush();
      // The candidates are kept: in development React unmounts and remounts the same board once, and the next change names it again.
      announced.current = false;
      onApi(null);
    },
    [onApi],
  );

  // Read once per board. Excalidraw takes its starting scene on mount and owns it after that. The shapes come from localStorage and the pictures from IndexedDB, so it is a promise.
  const initialData = useMemo(
    () => async () => {
      // Counted, because React in development mounts the board twice and each mount loads the saved scene. A load that lands after the page has drawn replaces the drawing, so the board is not announced while any load is still out.
      loads.current += 1;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return null;
        const saved = JSON.parse(raw) as { elements?: unknown[] };
        const files = readableFiles(await readFiles(storageKey));
        // The view is not restored: the board opens scrolled to the work, at a zoom that fits it.
        return { elements: saved.elements ?? [], files, scrollToContent: true } as never;
      } catch {
        return null;
      } finally {
        // Released after the scene is handed back, on the next task, so Excalidraw has applied it before the board can be announced.
        window.setTimeout(() => {
          loads.current -= 1;
          // The last load is in: announce the board that finished loading. A board React built and threw away never loads, so it is never the one chosen.
          if (loads.current === 0 && !announced.current) {
            const loaded = [...candidates.current].reverse().find((c) => !c.getAppState().isLoading);
            if (loaded) announce(loaded);
          }
        }, 0);
      }
    },
    [storageKey, announce],
  );

  return (
    <div className="relative min-h-0 flex-1">
      <div className="absolute inset-0">
        <Excalidraw
          theme="light"
          name="Askretes canvas"
          initialData={initialData}
          excalidrawAPI={(api) => {
            // Excalidraw hands its API over from its constructor, before the
            // board has mounted, and React may construct the board twice in
            // development and keep only one. A scene change sent to the other
            // is dropped. So every API handed over is only a candidate; the
            // live one is named by the board's first change below.
            candidates.current.push(api);
            // A board that never reports a change (none should) is announced after three seconds anyway, choosing a candidate that has finished loading its saved scene. Drawing before the saved scene has loaded is lost: the load replaces the scene when it lands.
            window.setTimeout(() => {
              if (announced.current || loads.current > 0) return;
              const loaded = [...candidates.current].reverse().find((c) => !c.getAppState().isLoading && c.getAppState().width > 0);
              if (loaded) announce(loaded);
            }, 3000);
          }}
          UIOptions={{ canvasActions: { toggleTheme: false, loadScene: false, saveToActiveFile: false } }}
          onChange={(elements, appState, files) => {
            // The mounted board is the one whose own state is the state this change carries. Excalidraw reports no change while it is still loading the saved scene, so the first change also means the scene is in place and a drawing added now will stay.
            if (!announced.current && loads.current === 0) {
              const live = candidates.current.find((c) => c.getAppState() === appState);
              if (live) announce(live);
            }
            pending.current = () => save(storageKey, elements, files);
            if (timer.current) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(flush, SAVE_DELAY);
          }}
        />
      </div>
    </div>
  );
}

/**
 * Writes the board to this browser: the shapes to localStorage, and the
 * pictures on the board to IndexedDB. Pictures are kept apart because one
 * generated picture is over a megabyte and localStorage holds about five, so
 * a few pictures in it would stop the shapes from saving at all. Only the
 * pictures still on the board are kept.
 */
function save(storageKey: string, elements: readonly { isDeleted: boolean; type: string }[], files: Record<string, unknown>) {
  const live = elements.filter((e) => !e.isDeleted);
  const used = new Set(live.flatMap((e) => ("fileId" in e && e.type === "image" && e.fileId ? [String(e.fileId)] : [])));
  const kept = Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id)));
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ elements: live }));
  } catch {
    // Storage blocked or full: the board holds for this visit.
  }
  void writeFiles(storageKey, kept);
}

/**
 * The saved pictures Excalidraw can read. An SVG that does not parse (one saved by an older build of the formula renderer) makes Excalidraw throw each time the board loads, so it is left out; its element shows as an empty frame the student can delete.
 */
function readableFiles(files: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(files).filter(([, f]) => {
      const file = f as { mimeType?: string; dataURL?: string };
      if (file.mimeType !== "image/svg+xml" || !file.dataURL) return true;
      try {
        const text = decodeURIComponent(escape(atob(file.dataURL.split(",")[1] ?? "")));
        return !new DOMParser().parseFromString(text, "image/svg+xml").querySelector("parsererror");
      } catch {
        return false;
      }
    }),
  );
}
