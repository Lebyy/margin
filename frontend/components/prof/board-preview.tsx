"use client";

import { Spinner } from "@heroui/react";
import { useEffect, useState } from "react";

/**
 * A student's canvas as the professor's transcript shows it: the stored
 * shapes, drawn read-only as a picture.
 *
 * The shapes were stored with the turn (the board the student shared with
 * Askretes, or the board after Askretes' marks). Excalidraw draws them to SVG in
 * this browser, and the SVG is shown as an image, so nothing in it can run or
 * be clicked. The pictures that were on the board are fetched from where the
 * server keeps them (`files`, by the file id each image element names); one
 * that was not kept (a formula, or a picture over the size limit) shows as an
 * empty frame.
 *
 * Excalidraw is imported only when a transcript has a board to draw.
 */
export function BoardPreview({ board, caption, files = [] }: { board: Record<string, unknown>[]; caption: string; files?: { id: string; url: string }[] }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The files as one string, so a parent that builds a new array on every render does not make the board redraw and refetch each time.
  const filesKey = files.map((f) => `${f.id}\u0001${f.url}`).join("\u0002");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { exportToSvg } = await import("@excalidraw/excalidraw");
        const loaded = await Promise.all(
          (filesKey ? filesKey.split("\u0002").map((pair) => ({ id: pair.split("\u0001")[0], url: pair.split("\u0001")[1] })) : []).map(async (f) => {
            try {
              const res = await fetch(f.url);
              if (!res.ok) return null;
              const blob = await res.blob();
              const dataURL = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
              });
              return [f.id, { id: f.id, mimeType: blob.type, dataURL, created: 0 }] as const;
            } catch {
              return null;
            }
          }),
        );
        const svg = await exportToSvg({
          elements: board as never,
          files: Object.fromEntries(loaded.filter((x) => x !== null)) as never,
          appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
          exportPadding: 16,
        });
        const text = new XMLSerializer().serializeToString(svg);
        if (live) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [board, filesKey]);

  if (failed) return null;
  return (
    <figure className="mt-2 overflow-hidden rounded-lg border border-border bg-surface">
      {src ? (
        // A data: URL drawn in this browser from stored shapes, so next/image has nothing to optimize.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={caption} className="max-h-80 w-full object-contain" />
      ) : (
        <div className="flex h-32 items-center justify-center">
          <Spinner size="sm" aria-label="Drawing the canvas" />
        </div>
      )}
      <figcaption className="border-t border-border px-2.5 py-1.5 text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}
