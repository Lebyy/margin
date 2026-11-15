// The student's canvas, as the chat sees it: what is on it, a picture of it,
// and what the tutor's tools do to it.
//
// Excalidraw is imported inside each function, not at the top of the file,
// because it reads the window as it loads and the assignment page is also
// rendered on the server. These functions only run in the browser.
//
// The colours below are Excalidraw element data (the stroke of a shape on the
// board), not page styles, so they are Excalidraw's own palette values and not
// the app's theme tokens, which the board cannot read.

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { CanvasAction, CanvasContext, CanvasTarget } from "@/lib/api";
import { texToImage } from "@/lib/math";

const INK = "#1e1e1e";
const RED = "#e03131";
const RED_FILL = "#ffe3e3";
const GREEN = "#2f9e44";

/** Padding around the picture of the board, in scene units. The box the tutor gives is in units of that padded picture, so the same number is used to map it back. */
const PAD = 24;

/** An element as this file reads it. Excalidraw's own type is wider; these are the fields the summary and the marks need. */
type El = { id: string; type: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; text?: string; containerId?: string | null; fileId?: string | null };
type Files = Record<string, { id: string; mimeType: string; dataURL: string; created: number }>;

/** Where on the board the last picture sent to the tutor was taken, in scene units. A box from the tutor is in 0-to-1 units of that picture. */
export type Frame = { x: number; y: number; w: number; h: number };

/** Skeleton shapes before Excalidraw gives them ids and sizes. Typed loosely; Excalidraw checks them as it converts. */
type Skeleton = Record<string, unknown> & { type: string; x: number; y: number };

// ---------------------------------------------------------------------------
// Storage: the shapes in localStorage, the pictures in IndexedDB.
// ---------------------------------------------------------------------------

/** The IndexedDB database the boards' pictures are kept in. `browser.chooseStudent` deletes it, since the pictures belong to the student who added them. */
export const CANVAS_DB = "margin-canvas";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(CANVAS_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Keeps a board's pictures. A picture is over a megabyte and localStorage holds about five, so they live here, apart from the shapes. */
export async function writeFiles(key: string, files: Record<string, unknown>): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(files, key);
  } catch {
    // IndexedDB blocked: the pictures stay for this visit only.
  }
}

export async function readFiles(key: string): Promise<Record<string, unknown>> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Record<string, unknown>) ?? {});
      req.onerror = () => resolve({});
    });
  } catch {
    return {};
  }
}

/** The saved shapes of a board, for when the board is not on screen. */
function savedElements(key: string): El[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ((JSON.parse(raw) as { elements?: El[] }).elements ?? []) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// What the tutor is told about the board.
// ---------------------------------------------------------------------------

/**
 * The canvas for one chat turn: a short list of what is on it, and a picture
 * of it when the student's message is about it and the board changed since
 * the last picture the tutor saw.
 *
 * This is the context budget. The list is a few lines of text and goes with
 * every turn, so the tutor always knows what is on the board and can point
 * at any element by its id. The picture is the expensive part (an image to
 * the model), so it goes only when it can matter: the message is about the
 * board or a drawing, and the board is not the one the tutor already saw.
 * `seen` is the version of the board the tutor last saw a picture of.
 *
 * The board is read live when it is on screen, and from storage when it is
 * not, so the student does not have to open the canvas to ask about it.
 */
export async function canvasContext(opts: {
  api: ExcalidrawImperativeAPI | null;
  storageKey: string;
  message: string;
  seen: number | null;
}): Promise<{ context: CanvasContext; version: number; frame: Frame | null; sentPicture: boolean }> {
  const { getSceneVersion, exportToBlob } = await import("@excalidraw/excalidraw");
  const elements = (opts.api ? (opts.api.getSceneElements() as unknown as El[]) : savedElements(opts.storageKey)).filter((e) => !e.isDeleted);
  const version = getSceneVersion(elements as never);
  if (elements.length === 0) return { context: { summary: "(empty)" }, version, frame: null, sentPicture: false };

  const frame = frameOf(elements);
  const summary = summarize(elements, frame);
  const wantsPicture = version !== opts.seen && aboutTheBoard(opts.message);
  if (!wantsPicture) return { context: { summary }, version, frame, sentPicture: false };

  const files = opts.api ? (opts.api.getFiles() as unknown as Files) : ((await readFiles(opts.storageKey)) as Files);
  const blob = await exportToBlob({
    elements: elements as never,
    files: files as never,
    appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
    mimeType: "image/jpeg",
    quality: 0.85,
    maxWidthOrHeight: 1280,
    exportPadding: PAD,
  });
  const base64 = (await blobToDataURL(blob)).split(",")[1] ?? "";
  return { context: { summary, image: { mimeType: "image/jpeg", base64 }, scene: shapesOnly(elements) }, version, frame, sentPicture: true };
}

/**
 * The board as the professor's transcript keeps it: the shapes, without
 * links or custom data, and without the pictures on it (an image element is
 * kept as a frame, but its file never leaves the browser). It goes with the
 * canvas picture, and again after Askretes' marks, so the professor sees the
 * canvas rather than a list of tool arguments.
 */
export function shapesOnly(elements: readonly unknown[]): Record<string, unknown>[] {
  return (elements as (Record<string, unknown> & { isDeleted?: boolean })[])
    .filter((e) => !e.isDeleted)
    .map((e) => {
      const rest = { ...e };
      delete rest.link;
      delete rest.customData;
      return rest;
    });
}

/**
 * The pictures on the live board, for storing with its shapes: each image
 * element's file, as base64. A board can hold large photos, so at most 12
 * pictures of up to 3 MB each go; a larger one is left out and shows as an
 * empty frame in the professor's view. Only PNG, JPEG, and WebP go: those
 * are the types the server stores and serves. A formula is an SVG and is not
 * sent (an SVG served back could carry script); the professor reads the
 * formula in the tool call instead.
 */
export function boardPictures(api: ExcalidrawImperativeAPI): { id: string; mimeType: string; base64: string }[] {
  const used = new Set((api.getSceneElements() as unknown as El[]).flatMap((e) => (e.type === "image" && e.fileId ? [String(e.fileId)] : [])));
  const files = api.getFiles() as unknown as Files;
  return Object.values(files)
    .filter((f) => used.has(String(f.id)) && /^[A-Za-z0-9_-]{1,80}$/.test(String(f.id)))
    .map((f) => ({ id: String(f.id), mimeType: f.mimeType, base64: f.dataURL.split(",")[1] ?? "" }))
    .filter((f) => ["image/png", "image/jpeg", "image/webp"].includes(f.mimeType) && f.base64.length <= 4_000_000)
    .slice(0, 12);
}

/** The live board as shapes, for storing after a reply's actions. */
export function boardShapes(api: ExcalidrawImperativeAPI): Record<string, unknown>[] {
  return shapesOnly(api.getSceneElements());
}

/** Whether a message is about the board: it names it, a drawing, an image, or asks for a mark on something. */
function aboutTheBoard(message: string): boolean {
  return /\b(canvas|board|whiteboard|drew|drawn|drawing|draw|sketch|diagram|picture|image|photo|wrote|written|handwrit|circle|mark|underline|highlight|correct|check|this|here|above)\b/i.test(message);
}

/** The box around everything on the board, padded the way the picture is. */
function frameOf(elements: El[]): Frame {
  const xs = elements.flatMap((e) => [e.x, e.x + e.width]);
  const ys = elements.flatMap((e) => [e.y, e.y + e.height]);
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  return { x: minX, y: minY, w: Math.max(1, Math.max(...xs) + PAD - minX), h: Math.max(1, Math.max(...ys) + PAD - minY) };
}

/**
 * One line per element: its id, what it is, where it sits on the picture in 0-to-1 units, and its words.
 * Freehand strokes are listed as handwriting or drawing; the picture is what shows what they say. At most 60 lines, newest last, so a crowded board stays a short prompt.
 */
function summarize(elements: El[], frame: Frame): string {
  const name: Record<string, string> = { freedraw: "handwriting or drawing", image: "image", text: "text", rectangle: "box", ellipse: "ellipse", diamond: "diamond", arrow: "arrow", line: "line", frame: "frame" };
  const r = (n: number) => Math.round(n * 100) / 100;
  return elements
    .slice(-60)
    .map((e) => {
      const at = `${r((e.x - frame.x) / frame.w)},${r((e.y - frame.y) / frame.h)},${r(e.width / frame.w)},${r(e.height / frame.h)}`;
      const words = e.text ? ` | "${e.text.replace(/\s+/g, " ").slice(0, 80)}"${e.containerId ? ` (label of ${e.containerId})` : ""}` : "";
      return `${e.id} | ${name[e.type] ?? e.type} | ${at}${words}`;
    })
    .join("\n");
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// What the tutor's tools do to the board.
// ---------------------------------------------------------------------------

/**
 * Carries out the canvas actions of one reply, in order, and scrolls the
 * board to what they added. Returns the pictures still to come (a diagram
 * whose picture the image model is drawing), so the page can place them when
 * they arrive.
 *
 * Every word in these actions was checked by the guard with the reply. This
 * function only draws: a mark is a red (or green) circle, box, underline, or
 * arrow around its target with the note beside it; a write is a text line or
 * a typeset formula; a diagram is laid out as shapes. All of it is ordinary
 * Excalidraw shapes the student can move, restyle, or delete.
 *
 * A target is an element by id (looked up on the board now) or a box on the
 * picture the tutor saw (mapped back through `frame`). A target that cannot be
 * found is skipped rather than drawn in the wrong place.
 */
export async function applyActions(api: ExcalidrawImperativeAPI, actions: CanvasAction[], frame: Frame | null): Promise<{ pictures: { id: string; at: { x: number; y: number } }[] }> {
  const { convertToExcalidrawElements, CaptureUpdateAction } = await import("@excalidraw/excalidraw");
  const pictures: { id: string; at: { x: number; y: number } }[] = [];
  const added: unknown[] = [];
  const board = () => (api.getSceneElements() as unknown as El[]).filter((e) => !e.isDeleted);
  const fallbackFrame = () => frame ?? (board().length ? frameOf(board()) : { x: 0, y: 0, w: 800, h: 600 });

  const place = (target: CanvasTarget | undefined): { x: number; y: number; w: number; h: number } | null => {
    if (target?.element) {
      const el = board().find((e) => e.id === target.element);
      if (el) return { x: Math.min(el.x, el.x + el.width), y: Math.min(el.y, el.y + el.height), w: Math.abs(el.width), h: Math.abs(el.height) };
    }
    if (target?.box) {
      const f = fallbackFrame();
      return { x: f.x + target.box.x * f.w, y: f.y + target.box.y * f.h, w: target.box.w * f.w, h: target.box.h * f.h };
    }
    return null;
  };
  const freeSpot = () => {
    const els = board();
    if (!els.length) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: Math.max(...els.map((e) => e.x + e.width)) + 120, y: Math.min(...els.map((e) => e.y)), w: 0, h: 0 };
  };
  const commit = (skeleton: Skeleton[]) => {
    const els = convertToExcalidrawElements(skeleton as never, { regenerateIds: true });
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...els], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    added.push(...els);
  };

  for (const action of actions) {
    if (action.type === "diagram") {
      const before = api.getSceneElements().length;
      const at = await drawLayout(api, action);
      added.push(...api.getSceneElements().slice(before));
      if (action.picture_id) pictures.push({ id: action.picture_id, at: { x: at.right + 120, y: at.top } });
      continue;
    }
    if (action.type === "mark") {
      const b = place(action.target);
      if (!b) continue;
      const stroke = action.tone === "green" ? GREEN : RED;
      const skeleton: Skeleton[] = [];
      if (action.shape === "circle") {
        // An ellipse around a box has to be about 1.4 times its size to clear the corners.
        const w = Math.max(40, b.w * 1.4);
        const h = Math.max(30, b.h * 1.5);
        skeleton.push({ type: "ellipse", x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, width: w, height: h, strokeColor: stroke, backgroundColor: "transparent", strokeWidth: 2 });
      } else if (action.shape === "box") {
        skeleton.push({ type: "rectangle", x: b.x - 10, y: b.y - 10, width: b.w + 20, height: b.h + 20, strokeColor: stroke, backgroundColor: "transparent", strokeWidth: 2, roundness: { type: 3 } });
      } else if (action.shape === "underline") {
        skeleton.push({ type: "line", x: b.x, y: b.y + b.h + 8, width: Math.max(20, b.w), height: 0, strokeColor: stroke, strokeWidth: 3 });
      } else {
        skeleton.push({ type: "arrow", x: b.x - 110, y: b.y - 70, width: 100, height: 70 + b.h / 2, strokeColor: stroke, strokeWidth: 2 });
      }
      if (action.note) skeleton.push({ type: "text", x: b.x + b.w + Math.max(24, b.w * 0.25), y: b.y, text: action.note, fontSize: 18, strokeColor: stroke });
      commit(skeleton);
      continue;
    }
    if (action.type === "write") {
      // Written under its target, not beside it: the right of a target is where a mark's note goes, and the two would overlap.
      const target = place(action.target);
      const b = target ? { x: target.x, y: target.y + target.h + 28, w: 0, h: 0 } : freeSpot();
      const x = b.x;
      if (action.latex) {
        const img = await texToImage(action.text, INK);
        if (img) {
          const fileId = `tex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          api.addFiles([{ id: fileId as never, mimeType: "image/svg+xml" as never, dataURL: img.dataURL as never, created: Date.now() }]);
          commit([{ type: "image", x, y: b.y, width: img.width, height: img.height, fileId }]);
          continue;
        }
      }
      commit([{ type: "text", x, y: b.y, text: action.text, fontSize: 20, strokeColor: INK }]);
    }
  }
  if (added.length) api.scrollToContent(added as never, { fitToContent: true, animate: true });
  return { pictures };
}

/**
 * Draws a diagram onto the board, to the right of whatever is already there.
 * A concept map puts the title in the middle with the items around it; steps go top to bottom with arrows between them; a summary is a grid of cards under the title.
 * Returns the right edge and top of what was drawn, so a picture that arrives later can be placed beside it.
 */
export async function drawLayout(api: ExcalidrawImperativeAPI, drawing: { kind: "map" | "steps" | "summary"; title: string; items: { label: string; detail: string }[] }): Promise<{ right: number; top: number }> {
  const { convertToExcalidrawElements, CaptureUpdateAction } = await import("@excalidraw/excalidraw");
  const existing = api.getSceneElements();
  const left = existing.length ? Math.max(...existing.map((e) => e.x + e.width)) + 160 : 0;
  const top = existing.length ? Math.min(...existing.map((e) => e.y)) : 0;
  const stamp = Date.now().toString(36);
  const id = (n: string) => `m-${stamp}-${n}`;
  const card = (detail: string, label: string) => (detail ? `${label}\n${detail}` : label);
  const skeleton: Skeleton[] = [];
  let right = left;

  if (drawing.kind === "map") {
    const cx = left + 420;
    const cy = top + 320;
    skeleton.push({ type: "ellipse", id: id("hub"), x: cx - 150, y: cy - 60, width: 300, height: 120, strokeColor: RED, backgroundColor: RED_FILL, fillStyle: "solid", label: { text: drawing.title, fontSize: 22 } });
    drawing.items.forEach((item, i) => {
      const angle = (i / drawing.items.length) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(angle) * 380 - 130;
      const y = cy + Math.sin(angle) * 260 - 50;
      skeleton.push({ type: "rectangle", x, y, width: 260, height: 100, strokeColor: INK, roundness: { type: 3 }, label: { text: card(item.detail, item.label), fontSize: 16 } });
      // The arrow runs from the edge of the hub to the edge of the card along the line between their centres. Its width and height are that vector; without them Excalidraw draws a short horizontal arrow.
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const sx = cx + ux * 160;
      const sy = cy + uy * 66;
      const ex = x + 130 - ux * 145;
      const ey = y + 50 - uy * 60;
      skeleton.push({ type: "arrow", x: sx, y: sy, width: ex - sx, height: ey - sy, strokeColor: INK });
      right = Math.max(right, x + 260);
    });
  } else if (drawing.kind === "steps") {
    skeleton.push({ type: "text", x: left, y: top, text: drawing.title, fontSize: 28, strokeColor: RED });
    drawing.items.forEach((item, i) => {
      const y = top + 70 + i * 150;
      skeleton.push({ type: "rectangle", id: id(`s${i}`), x: left, y, width: 380, height: 100, strokeColor: INK, roundness: { type: 3 }, label: { text: card(item.detail, `${i + 1}. ${item.label}`), fontSize: 16 } });
      if (i > 0) skeleton.push({ type: "arrow", x: left + 190, y: y - 50, width: 0, height: 50, strokeColor: INK, start: { id: id(`s${i - 1}`) }, end: { id: id(`s${i}`) } });
    });
    right = left + 380;
  } else {
    skeleton.push({ type: "text", x: left, y: top, text: drawing.title, fontSize: 28, strokeColor: RED });
    drawing.items.forEach((item, i) => {
      const x = left + (i % 2) * 340;
      const y = top + 70 + Math.floor(i / 2) * 150;
      skeleton.push({ type: "rectangle", x, y, width: 310, height: 120, strokeColor: INK, roundness: { type: 3 }, label: { text: card(item.detail, item.label), fontSize: 16 } });
      right = Math.max(right, x + 310);
    });
  }

  const added = convertToExcalidrawElements(skeleton as never, { regenerateIds: true });
  api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...added], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  api.scrollToContent(added, { fitToContent: true, animate: true });
  return { right, top };
}

/** Places a picture on the board as an ordinary image the student can move, resize, and draw over. Used for the picture the image model makes of a diagram, which arrives some seconds after it. */
export async function placePicture(api: ExcalidrawImperativeAPI, image: { mimeType: string; base64: string }, at: { x: number; y: number }): Promise<void> {
  const { convertToExcalidrawElements, CaptureUpdateAction } = await import("@excalidraw/excalidraw");
  const dataURL = `data:${image.mimeType};base64,${image.base64}`;
  const size = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => resolve({ width: 1, height: 1 });
    img.src = dataURL;
  });
  const width = 420;
  const height = Math.round((size.height / size.width) * width) || width;
  const fileId = `pic-${Date.now().toString(36)}`;
  api.addFiles([{ id: fileId as never, mimeType: image.mimeType as never, dataURL: dataURL as never, created: Date.now() }]);
  const added = convertToExcalidrawElements([{ type: "image", x: at.x, y: at.y, width, height, fileId } as never]);
  api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...added], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  api.scrollToContent(added, { fitToContent: true, animate: true });
}
