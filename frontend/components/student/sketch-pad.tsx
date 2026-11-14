"use client";

import { Button, Input, Spinner, TextField } from "@heroui/react";
import { ArrowUp, Eraser, Eye, ImagePlus, Maximize2, Minimize2, Minus, Move, Plus, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MicButton } from "@/components/student/mic-button";
import type { Annotation, Drawing } from "@/lib/api";
import { cn } from "@/lib/utils";



/** One pen stroke: its ink, its width, and the points it passed through, in canvas CSS pixels. */
export type Stroke = { ink: "pen" | "red" | "erase"; points: [number, number][] };

/**
 * The canvas: Margin draws when asked, and the student draws over it.
 *
 * The student's ink is their own scratch paper. It is not shared, not sent to
 * the model, and not stored on the server. Only the text of a request to draw
 * leaves the page.
 *
 * Strokes are kept as data, in the parent, and redrawn. That is what makes
 * undo possible, keeps the drawing when the student switches tabs and comes
 * back. The pen is drawn in the page's foreground color, which is the same
 * dark ink on the light sheet every time.
 */
/** A picture the student put on the canvas: where it sits and how wide it is, in canvas CSS pixels. `src` is a data URL, so the picture lives in this page and is not uploaded. */
export type CanvasImage = { id: string; src: string; x: number; y: number; w: number; annotation?: Annotation; reading?: boolean };

export function SketchPad({
  strokes,
  onChange,
  images,
  onImages,
  drawing,
  onAsk,
  onClearDrawing,
  failed,
  starters,
  onRead,
}: {
  /** Requests a student can make with one press. Each is sent as typed, through the same route as a request of their own. */
  starters: string[];
  /** Asks Margin to look at one picture. Resolves to what it said, or null when nothing safe could be said. `ask` is whatever is typed in the ask box, and may be empty. */
  onRead: (src: string, ask: string) => Promise<Annotation | null>;
  strokes: Stroke[];
  onChange: (strokes: Stroke[]) => void;
  /** Pictures the student added: a photo of a whiteboard, a slide, a diagram from the notes. They sit under the ink and under Margin's drawing. */
  images: CanvasImage[];
  onImages: (images: CanvasImage[]) => void;
  /** What Margin drew, `"loading"` while it is drawing, or null. */
  drawing: Drawing | "loading" | null;
  /** Asks Margin to draw. The text is typed, dictated, or one of the three starters. */
  onAsk: (ask: string) => void;
  onClearDrawing: () => void;
  /** True when the last request drew nothing: the guard held it, or the model could not answer. */
  failed: boolean;
}) {
  const [ask, setAsk] = useState("");
  const busy = drawing === "loading";
  const submit = (text: string) => {
    if (busy || text.trim().length === 0) return;
    onAsk(text.trim());
    setAsk("");
  };
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<Stroke | null>(null);
  const [ink, setInk] = useState<Stroke["ink"]>("pen");
  /** In move mode the pointer goes to the pictures, not the pen, so a picture can be dragged or removed without drawing on it. */
  const [moving, setMoving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [readFailed, setReadFailed] = useState(false);
  /** Full screen gives the canvas the whole window. It is the same canvas with the same ink, only larger. */
  const [full, setFull] = useState(false);
  /** What Margin said about the whole canvas the last time the student asked it to look. */
  const [sheetNote, setSheetNote] = useState<Annotation | null>(null);
  const [looking, setLooking] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  /** Choosing a pen or the eraser also leaves move mode. Without that, a student who moved a picture had no obvious way back to writing. */
  const pick = (next: Stroke["ink"]) => {
    setInk(next);
    setMoving(false);
  };

  // Escape leaves full screen, as it does everywhere else.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  /**
   * Shows Margin the whole canvas: the pictures and the student's ink together, as one image.
   *
   * This is what lets a student draw a call stack, or circle part of a slide, and ask "is this right?". The snapshot is made here, in the browser, by painting the pictures and then the ink onto one offscreen canvas at the size the student sees. It goes through the same route as a single picture, so the same guard reads what Margin says back, and the marks it returns are boxes over the whole sheet.
   * The ground is painted in the sheet's own color. A transparent snapshot would reach the model as black, and dark-theme ink is white.
   */
  async function look() {
    const sheet = sheetRef.current;
    const inkCanvas = canvasRef.current;
    if (!sheet || !inkCanvas) return;
    setLooking(true);
    setReadFailed(false);
    try {
      const { width, height } = sheet.getBoundingClientRect();
      const off = document.createElement("canvas");
      off.width = Math.round(width);
      off.height = Math.round(height);
      const ctx = off.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#ffffff";
      ctx.fillRect(0, 0, off.width, off.height);
      const shown = [...sheet.querySelectorAll<HTMLImageElement>("img[data-canvas-picture]")];
      images.forEach((image, i) => {
        const el = shown[i];
        if (el?.complete && el.naturalWidth > 0) ctx.drawImage(el, image.x, image.y, image.w, (image.w * el.naturalHeight) / el.naturalWidth);
      });
      ctx.drawImage(inkCanvas, 0, 0, off.width, off.height);
      const note = await onRead(off.toDataURL("image/png"), ask.trim() || "Look at what I drew. Is my thinking right, and what should I look at next?");
      if (note) {
        setSheetNote(note);
        setAsk("");
      } else {
        setReadFailed(true);
      }
    } finally {
      setLooking(false);
    }
  }

  /**
   * Has Margin look at one picture and mark it up.
   * The marks come back as boxes in 0-to-1 units of the picture, so they are drawn inside the picture's own element and move and resize with it. If the student typed a question in the ask box, it goes along and steers what gets marked.
   */
  async function read(image: CanvasImage) {
    setReadFailed(false);
    onImages(images.map((im) => (im.id === image.id ? { ...im, reading: true } : im)));
    const annotation = await onRead(image.src, ask.trim());
    if (!annotation) setReadFailed(true);
    else setAsk("");
    onImages(images.map((im) => (im.id === image.id ? { ...im, reading: false, annotation: annotation ?? im.annotation } : im)));
  }
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  /**
   * Puts picture files on the canvas.
   * The file is read into a data URL in the browser. Nothing is sent to the server or to the model: this is the student's own scratch paper, and a photo of their notebook stays theirs. Each new picture is offset a little so two do not land exactly on top of each other.
   */
  const addFiles = useCallback(
    (files: Iterable<File>) => {
      let n = images.length;
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const offset = n * 18;
        n += 1;
        const reader = new FileReader();
        reader.onload = () => {
          onImages([...images, { id: `${Date.now()}-${offset}`, src: String(reader.result), x: 64 + offset, y: 16 + offset, w: 220 }]);
        };
        reader.readAsDataURL(file);
      }
    },
    [images, onImages],
  );

  // A picture on the clipboard can be pasted straight onto the canvas while this tab is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      e.preventDefault();
      addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const paint = useCallback(
    (extra?: Stroke | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const style = getComputedStyle(canvas);
      const colors = { pen: style.color, red: style.getPropertyValue("--margin-red").trim() };
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const stroke of extra ? [...strokes, extra] : strokes) {
        if (stroke.points.length === 0) continue;
        // The eraser removes ink instead of painting the background color over it, so it works on the ruled paper in either theme.
        ctx.globalCompositeOperation = stroke.ink === "erase" ? "destination-out" : "source-over";
        ctx.strokeStyle = stroke.ink === "erase" ? "#000" : colors[stroke.ink];
        ctx.lineWidth = stroke.ink === "erase" ? 18 : 2.2;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0][0], stroke.points[0][1]);
        for (const [x, y] of stroke.points.slice(1)) ctx.lineTo(x, y);
        if (stroke.points.length === 1) ctx.lineTo(stroke.points[0][0] + 0.1, stroke.points[0][1]);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    },
    [strokes],
  );

  // Repaint when the strokes change and when the panel is resized.
  useEffect(() => {
    paint();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = new ResizeObserver(() => paint());
    resize.observe(canvas);
    return () => {
      resize.disconnect();
    };
  }, [paint]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const content = (
    <div className={cn("flex flex-col gap-2", full && "fixed inset-0 z-50 bg-background p-4 sm:p-6")}>
      <div className="flex items-center gap-1" role="toolbar" aria-label="Sketch tools">
        <InkButton label="Pen" active={!moving && ink === "pen"} onPress={() => pick("pen")}>
          <span className="size-3.5 rounded-full bg-foreground" />
        </InkButton>
        <InkButton label="Red pen" active={!moving && ink === "red"} onPress={() => pick("red")}>
          <span className="size-3.5 rounded-full bg-margin-red" />
        </InkButton>
        <InkButton label="Eraser" active={!moving && ink === "erase"} onPress={() => pick("erase")}>
          <Eraser className="size-4" />
        </InkButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button isIconOnly size="sm" variant="ghost" aria-label="Add a picture" onPress={() => fileRef.current?.click()}>
          <ImagePlus className="size-4" />
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        {images.length > 0 ? (
          <InkButton label="Move pictures" active={moving} onPress={() => setMoving(!moving)}>
            <Move className="size-4" />
          </InkButton>
        ) : null}
        <span className="ml-auto flex gap-1">
          <Button isIconOnly size="sm" variant="ghost" aria-label={full ? "Leave full screen" : "Full screen"} onPress={() => setFull(!full)}>
            {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Undo" isDisabled={strokes.length === 0} onPress={() => onChange(strokes.slice(0, -1))}>
            <Undo2 className="size-4" />
          </Button>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Clear the sketch" isDisabled={strokes.length === 0} onPress={() => onChange([])}>
            <Trash2 className="size-4" />
          </Button>
        </span>
      </div>
      {/*
        Three layers on one sheet. Pictures at the bottom, Margin's drawing over them, and the student's ink on top. The ink canvas is transparent, so erasing removes ink and nothing under it. In move mode the canvas stops taking the pointer and the pictures take it.
      */}
      <div
        ref={sheetRef}
        className={cn("paper paper-ruled relative w-full overflow-hidden !p-0", full ? "min-h-0 flex-1" : "h-[38rem]")}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles([...e.dataTransfer.files]);
        }}
      >
        {images.map((image) => (
          <div
            key={image.id}
            className={cn("absolute", moving ? "z-30 cursor-grab touch-none active:cursor-grabbing" : "z-0")}
            style={{ left: image.x, top: image.y, width: image.w }}
            onPointerDown={(e) => {
              if (!moving) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { id: image.id, dx: e.clientX - image.x, dy: e.clientY - image.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== image.id) return;
              onImages(images.map((im) => (im.id === d.id ? { ...im, x: e.clientX - d.dx, y: e.clientY - d.dy } : im)));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL the student just added; there is nothing for the image optimizer to fetch */}
            <img src={image.src} alt="A picture you added" data-canvas-picture draggable={false} className={cn("w-full rounded-md", moving && "ring-2 ring-accent")} />
            {/* Margin's marks: a red ellipse around each part it pointed at, numbered to match the notes under the canvas. The professor's red pen, on the student's own picture. */}
            {image.annotation?.marks.filter((mark) => mark.box.w > 0).map((mark, n) => (
              <motion.span
                key={n}
                aria-hidden
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.12 * n }}
                className="pointer-events-none absolute rounded-[50%] border-2 border-margin-red"
                style={{ left: `${mark.box.x * 100}%`, top: `${mark.box.y * 100}%`, width: `${mark.box.w * 100}%`, height: `${mark.box.h * 100}%` }}
              >
                <span className="absolute -left-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full bg-margin-red text-[11px] font-bold text-background">{n + 1}</span>
              </motion.span>
            ))}
            {moving ? (
              <span className="absolute -right-2 -top-2 flex gap-1">
                <Button isIconOnly size="sm" variant="secondary" aria-label="Make the picture smaller" onPress={() => onImages(images.map((im) => (im.id === image.id ? { ...im, w: Math.max(80, im.w - 40) } : im)))}>
                  <Minus className="size-3.5" />
                </Button>
                <Button isIconOnly size="sm" variant="secondary" aria-label="Make the picture bigger" onPress={() => onImages(images.map((im) => (im.id === image.id ? { ...im, w: im.w + 40 } : im)))}>
                  <Plus className="size-3.5" />
                </Button>
                <Button isIconOnly size="sm" variant="danger" aria-label="Remove the picture" onPress={() => onImages(images.filter((im) => im.id !== image.id))}>
                  <X className="size-3.5" />
                </Button>
              </span>
            ) : null}
          </div>
        ))}
        {drawing && drawing !== "loading" ? <DrawingLayer drawing={drawing} /> : null}
        {/* Margin's marks on the whole canvas, from the last time it was asked to look. Boxes are fractions of the sheet, so they stay in place when the canvas goes full screen. */}
        {sheetNote?.marks.map((mark, n) => (
          <motion.span
            key={n}
            aria-hidden
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.12 * n }}
            className="pointer-events-none absolute z-10 rounded-[50%] border-2 border-margin-red"
            style={{ left: `${mark.box.x * 100}%`, top: `${mark.box.y * 100}%`, width: `${mark.box.w * 100}%`, height: `${mark.box.h * 100}%` }}
          >
            <span className="absolute -left-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full bg-margin-red text-[11px] font-bold text-background">{n + 1}</span>
          </motion.span>
        ))}
        {busy ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <Spinner aria-label="Margin is drawing" />
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Scratch paper. Draw with a mouse, a finger, or a pen."
          className={cn("absolute inset-0 z-20 size-full touch-none text-foreground", moving ? "pointer-events-none" : ink === "erase" ? "cursor-cell" : "cursor-crosshair")}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            stroke.current = { ink, points: [point(e)] };
            paint(stroke.current);
          }}
          onPointerMove={(e) => {
            if (!stroke.current) return;
            stroke.current.points.push(point(e));
            paint(stroke.current);
          }}
          onPointerUp={() => {
            if (!stroke.current) return;
            const done = stroke.current;
            stroke.current = null;
            onChange([...strokes, done]);
          }}
          onPointerCancel={() => {
            stroke.current = null;
            paint();
          }}
        />
        {/* The button that asks Margin about a picture sits in its own layer above the ink. Inside the picture's element it would be under the ink canvas, which covers the whole sheet, and a press would draw a dot instead. */}
        {!moving
          ? images.map((image) => (
              <span key={image.id} className="absolute z-30" style={{ left: image.x - 10, top: image.y - 10 }}>
                <Button isIconOnly size="sm" variant="primary" aria-label="Ask Margin about this picture" isPending={image.reading} isDisabled={image.reading} onPress={() => void read(image)}>
                  <Sparkles className="size-3.5" />
                </Button>
              </span>
            ))
          : null}
      </div>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit(ask);
        }}
      >
        <TextField value={ask} onChange={setAsk} isDisabled={busy} fullWidth aria-label="Ask Margin to draw">
          <Input placeholder="Ask Margin to draw, or about your canvas" />
        </TextField>
        <MicButton onText={setAsk} isDisabled={busy} />
        <Button isIconOnly size="sm" variant="secondary" aria-label="Ask Margin about my canvas" isPending={looking} isDisabled={looking || busy || (strokes.length === 0 && images.length === 0)} onPress={() => void look()}>
          <Eye className="size-4" />
        </Button>
        <Button type="submit" isIconOnly size="sm" variant="primary" aria-label="Draw" isDisabled={busy || ask.trim().length === 0}>
          <ArrowUp className="size-4" />
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-1">
        {starters.map((starter) => (
          <Button key={starter} size="sm" variant="ghost" isDisabled={busy} onPress={() => submit(starter)}>
            {starter}
          </Button>
        ))}
        {drawing && drawing !== "loading" ? (
          <Button size="sm" variant="ghost" className="ml-auto" onPress={onClearDrawing}>
            Remove drawing
          </Button>
        ) : null}
      </div>
      {failed ? <p className="text-sm text-danger">Margin could not draw that.</p> : null}
      {readFailed ? <p className="text-sm text-danger">Margin could not read that.</p> : null}
      {sheetNote ? (
        <div className="rounded-xl border border-margin-red/50 px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="font-serif text-[15px] leading-6">{sheetNote.description}</p>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Clear Margin's notes on the canvas" onPress={() => setSheetNote(null)}>
              <X className="size-3.5" />
            </Button>
          </div>
          <ol className="mt-1.5 flex flex-col gap-1.5">
            {sheetNote.marks.map((mark, n) => (
              <li key={n} className="flex gap-2 text-sm leading-5">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-margin-red text-[11px] font-bold text-background">{n + 1}</span>
                <span>
                  <span className="font-medium">{mark.label}.</span> <span className="text-muted">{mark.note}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {/* What Margin said about each picture, as text. The ellipses are decoration for a sighted reader, and this list is the same information for everyone. */}
      {images
        .filter((im) => im.annotation)
        .map((im) => (
          <div key={im.id} className="rounded-xl border border-border px-3 py-2.5">
            <p className="font-serif text-[15px] leading-6">{im.annotation?.description}</p>
            <ol className="mt-1.5 flex flex-col gap-1.5">
              {im.annotation?.marks.map((mark, n) => (
                <li key={n} className="flex gap-2 text-sm leading-5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-margin-red text-[11px] font-bold text-background">{n + 1}</span>
                  <span>
                    <span className="font-medium">{mark.label}.</span> <span className="text-muted">{mark.note}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      <p className="text-xs text-muted">Your canvas stays in this browser until you ask Margin to look at it.</p>
    </div>
  );
  // Full screen is drawn straight into the page body. Inside the side panel it would only fill the panel: the panel's card blurs what is behind it, and an element with a backdrop filter becomes the box that a fixed child is positioned against.
  return full ? createPortal(content, document.body) : content;
}

/**
 * What Margin drew, laid out over the paper and under the pointer.
 *
 * This is the MindPad canvas: ask, and the canvas updates. The structure
 * comes from the canvas route, where the guard has already read every word of
 * it, so nothing here is a step of the solution. This component only decides
 * where the words go.
 *
 * All three kinds hang off one trunk that runs down the left, clear of the
 * margin line. A map marks each branch with a dot, steps number them, and a
 * summary uses a dash. One layout means a drawing never overlaps itself,
 * whatever the model returned.
 *
 * The layer ignores the pointer, so the student draws on top of it: circle a
 * node, connect two, cross one out. Their ink and the drawing are separate,
 * so clearing the ink leaves the drawing and removing the drawing leaves the ink.
 */
function DrawingLayer({ drawing }: { drawing: Drawing }) {
  const W = 340;
  // Right of the paper's red margin line, which sits about 44px in on a panel this wide.
  const TRUNK = 62;
  const top = 92;
  const rows = drawing.items.map((item) => ({ ...item, lines: wrap(item.detail, 40).slice(0, 4) }));
  // Each row starts where the rows above it end. A row's height depends on how many lines its detail wrapped to.
  const heights = rows.map((row) => 30 + row.lines.length * 15 + 14);
  const placed = rows.map((row, i) => ({ ...row, y: top + heights.slice(0, i).reduce((sum, h) => sum + h, 0) }));
  const H = top + heights.reduce((sum, h) => sum + h, 0) + 4;
  const last = placed[placed.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="pointer-events-none absolute left-0 top-0 z-10 w-full max-w-xl text-foreground"
      role="img"
      aria-label={`${drawing.title}. ${drawing.items.map((i) => `${i.label}: ${i.detail}`).join(" ")}`}
    >
      <path d={`M ${W / 2} 52 C ${W / 2} 74, ${TRUNK} 58, ${TRUNK} ${top - 8} L ${TRUNK} ${last.y + 14}`} fill="none" stroke="var(--margin-red)" strokeOpacity="0.5" strokeWidth="1.2" />
      <rect x={W / 2 - 120} y={14} width={240} height={38} rx={19} fill="var(--paper)" stroke="var(--margin-red)" />
      <text x={W / 2} y={38} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--margin-red)">
        {clip(drawing.title, 34)}
      </text>
      {placed.map((row, i) => (
        <g key={i}>
          {drawing.kind === "steps" ? (
            <>
              <circle cx={TRUNK} cy={row.y + 14} r={9} fill="var(--margin-red)" />
              <text x={TRUNK} y={row.y + 18} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--paper)">
                {i + 1}
              </text>
            </>
          ) : (
            <circle cx={TRUNK} cy={row.y + 14} r={drawing.kind === "map" ? 4 : 2.5} fill="var(--margin-red)" />
          )}
          <text x={TRUNK + 18} y={row.y + 18} fontSize="13" fontWeight="600" fill="currentColor">
            {clip(row.label, 38)}
          </text>
          {row.lines.map((line, j) => (
            <text key={j} x={TRUNK + 18} y={row.y + 36 + j * 15} fontSize="11" fill="currentColor" opacity={0.7}>
              {line}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Breaks a sentence into lines of at most `max` characters at word boundaries. SVG text does not wrap on its own. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function InkButton({ label, active, onPress, children }: { label: string; active: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <Button isIconOnly size="sm" variant={active ? "secondary" : "ghost"} aria-label={label} aria-pressed={active} onPress={onPress}>
      {children}
    </Button>
  );
}
