"use client";

import { Button, Drawer, Tooltip } from "@heroui/react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";

/** One view the pane can open: what it is called and what it shows. `bleed` drops the padding, for a view that is one full-size surface (the canvas, the slides). `tools` sits at the right of the header, beside the close button. */
export type PaneView = { id: string; label: string; content: ReactNode; bleed?: boolean; tools?: ReactNode };

/** Where this browser keeps the pane's width. A per-viewer convenience: losing it puts the pane back at its default width. */
const WIDTH_KEY = "margin.pane.width";
const MIN = 22; // rem
const MAX = 64; // rem
const DEFAULT = 34; // rem

/**
 * The pane beside the chat, laid out like a chat app's side panel: a home
 * view that lists what this session has (progress, the canvas, the
 * professor's notes and slides, and what Askretes' tools did), and one open
 * view at a time, reached from a row on the home view and left with the back
 * arrow in the header.
 *
 * It is the second half of the workspace, the place the thing being talked
 * about lives while the conversation goes on beside it. The view and the open
 * state belong to the page, so a citation or a tool call in a reply can open
 * the slides at a slide, or the canvas, from the chat.
 *
 * On a wide screen it is a column the student can widen or narrow by
 * dragging its edge (or with the arrow keys on that edge), and close. Below
 * that it opens as a drawer from the right, so the chat keeps the width.
 */
export function ArtifactPane({
  home,
  views,
  view,
  onView,
  isOpen,
  onOpenChange,
  label,
  tabbed = false,
  defaultWidth = DEFAULT,
  widthKey = WIDTH_KEY,
  expanded = false,
  onExpandedChange,
}: {
  /** The home view's title (as a back link's label, too) and its content. */
  home: { title: string; content: ReactNode };
  views: PaneView[];
  /** The open view's id, or "home". */
  view: string;
  onView: (id: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pane's accessible name. */
  label: string;
  /** Views as tabs across the top (the professor's dashboard), instead of rows on a home view with a back link. */
  tabbed?: boolean;
  /** The width in rem before the person drags it, and where their width is kept, so the professor's wider dashboard does not change the student's pane. */
  defaultWidth?: number;
  widthKey?: string;
  /** Whether the pane takes the whole width, with the button that toggles it. The page hides its other column while it does. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const inline = useMedia("(min-width: 1200px)");
  const [width, setWidth] = useState(defaultWidth);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(widthKey));
      if (stored >= MIN && stored <= MAX) {
        const id = window.setTimeout(() => setWidth(stored), 0);
        return () => window.clearTimeout(id);
      }
    } catch {
      // Storage blocked: the default width stands.
    }
    return undefined;
  }, [widthKey]);

  function resize(next: number) {
    const clamped = Math.min(MAX, Math.max(MIN, next));
    setWidth(clamped);
    try {
      window.localStorage.setItem(widthKey, String(clamped));
    } catch {
      // Storage blocked: the width holds for this visit.
    }
  }

  const open = views.find((v) => v.id === view) ?? null;

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 px-3">
        {tabbed ? (
          <div role="group" aria-label={label} className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {[{ id: "home", label: home.title }, ...views].map((v) => {
              const on = (open?.id ?? "home") === v.id;
              return (
                <Button key={v.id} aria-pressed={on} size="sm" variant={on ? "secondary" : "ghost"} className={cn("shrink-0 font-normal", on ? "font-medium" : "text-muted")} onPress={() => onView(v.id)}>
                  {v.label}
                </Button>
              );
            })}
          </div>
        ) : open ? (
          <>
            <Button size="sm" variant="ghost" className="gap-0.5 px-2 text-muted" onPress={() => onView("home")} aria-label={`Back to ${home.title}`}>
              <ChevronLeft className="size-4" aria-hidden /> {home.title}
            </Button>
            <ChevronRight className="size-3.5 text-muted/60" aria-hidden />
            <h2 className="truncate px-1 text-sm font-medium">{open.label}</h2>
          </>
        ) : (
          <h2 className="px-2 text-sm font-medium">{home.title}</h2>
        )}
        <span className="ml-auto" />
        {open?.tools}
        {onExpandedChange && inline ? (
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="ghost" aria-label={expanded ? "Shrink the panel" : "Expand the panel"} aria-pressed={expanded} onPress={() => onExpandedChange(!expanded)}>
              {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
            <Tooltip.Content>{expanded ? "Shrink" : "Full width"}</Tooltip.Content>
          </Tooltip>
        ) : null}
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Close the pane" onPress={() => onOpenChange(false)}>
            <X className="size-4" />
          </Button>
          <Tooltip.Content>Close</Tooltip.Content>
        </Tooltip>
      </div>
      {open ? (
        <div key={open.id} className={cn("min-h-0 flex-1", open.bleed ? "flex flex-col overflow-hidden border-t border-border" : "overflow-y-auto px-4 pb-6 sm:px-5")}>
          {open.content}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">{home.content}</div>
      )}
    </div>
  );

  if (inline) {
    if (!isOpen) return null;
    return (
      <aside aria-label={label} className={cn("relative flex flex-col border-l border-border bg-paper", expanded ? "min-w-0 flex-1" : "shrink-0")} style={expanded ? undefined : { width: `${width}rem` }}>
        {expanded ? null : <ResizeEdge width={width} onResize={resize} />}
        {body}
      </aside>
    );
  }

  return (
    <Drawer>
      <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="blur">
        <Drawer.Content placement="right">
          {/* HeroUI caps a side drawer at 85% of the screen. On a phone the pane is the whole screen instead, the way a chat app opens an artifact, so a dashboard or a canvas is not squeezed into a strip with the chat peeking out beside it. */}
          <Drawer.Dialog className="flex h-full w-screen max-w-none flex-col p-0 sm:w-[min(44rem,92vw)]" aria-label={label}>
            {body}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

/** A titled group of rows on the pane's home view, the way a side panel groups "Outputs" and "Used in this session". */
export function PaneSection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-4 first:mt-1">
      <div className="mb-1 flex items-center px-2">
        <h3 className="text-xs font-medium text-muted">{title}</h3>
        <span className="ml-auto">{action}</span>
      </div>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

/**
 * One row of the pane's home view: an icon, a name, a quiet detail on the right, and, when it opens something, the whole row is the button.
 * It is a HeroUI Button so it gets the library's focus ring and press handling; it is styled flat, as a list row, not as a filled button.
 */
export function PaneRow({ icon, label, detail, onPress }: { icon: ReactNode; label: ReactNode; detail?: ReactNode; onPress?: () => void }) {
  const inner = (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left text-sm">{label}</span>
      {detail ? <span className="shrink-0 text-xs text-muted">{detail}</span> : null}
    </>
  );
  return (
    <li>
      {onPress ? (
        <Button variant="ghost" className="h-auto min-h-9 w-full justify-start gap-2.5 rounded-lg px-2 py-1.5 font-normal" onPress={onPress}>
          {inner}
        </Button>
      ) : (
        <div className="flex min-h-9 items-center gap-2.5 px-2 py-1.5">{inner}</div>
      )}
    </li>
  );
}

/**
 * The pane's left edge, which the student drags to change its width.
 *
 * It is a focusable separator with its width as its value, so the arrow keys
 * change it as well as the pointer, and a screen reader hears how wide the
 * pane is. Dragging follows the pointer from where it was pressed, so the
 * edge does not jump to the cursor on the first move.
 */
function ResizeEdge({ width, onResize }: { width: number; onResize: (rem: number) => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Pane width"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      className={cn(
        "absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize outline-none transition-colors hover:bg-margin-red/30 focus-visible:bg-margin-red/50",
        dragging && "bg-margin-red/40",
      )}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, width };
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        // Dragging left widens the pane, since its edge is on the left.
        onResize(start.current.width + (start.current.x - e.clientX) / rem());
      }}
      onPointerUp={() => {
        start.current = null;
        setDragging(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(width + 2);
        else if (e.key === "ArrowRight") onResize(width - 2);
        else return;
        e.preventDefault();
      }}
    />
  );
}
