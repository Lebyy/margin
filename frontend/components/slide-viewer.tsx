"use client";

import { Button, Dropdown, Label, Tooltip } from "@heroui/react";
import { ChevronDown, Download, ExternalLink, Presentation } from "lucide-react";
import { lectureFileUrl, type Lecture } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The class's lecture slides: the list of lectures and the open one, in the
 * browser's own PDF viewer.
 *
 * The viewer is an iframe of the file route with `#page=n`, which every
 * built-in PDF viewer opens at that page. That is how a citation in Askretes'
 * reply, "[Lecture 3, slide 9]", lands on slide 9: the page passes the
 * lecture and page down to here. Changing `page` changes the iframe's key, so
 * the viewer reloads at the new page instead of keeping its scroll position.
 *
 * `compact` is the pane beside the chat. It is drawn like a document open
 * beside a conversation: one quiet bar with the lecture's name, a menu to
 * switch lecture, and buttons to open or download the file, then the slides
 * filling the rest of the pane. The viewer's own toolbar and thumbnail strip
 * are turned off with the open parameters Chrome, Edge, and Firefox read
 * (`toolbar=0`, `navpanes=0`, `view=FitH`), so the pages fit the pane's
 * width with nothing dark around them. A browser that ignores them shows its
 * usual viewer, which still works.
 */
export function SlideViewer({
  courseId,
  lectures,
  selectedId,
  page,
  onSelect,
  compact = false,
}: {
  courseId: string;
  lectures: Lecture[];
  selectedId: string | null;
  page: number | null;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  if (lectures.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
        <Presentation className="size-6 text-muted" aria-hidden />
        <p className="font-medium">No slides yet</p>
        <p className="max-w-sm text-sm text-muted">When your professor uploads a lecture, its slides appear here.</p>
      </div>
    );
  }
  const open = lectures.find((l) => l.id === selectedId) ?? lectures[0];
  const file = lectureFileUrl(courseId, open.id);
  const src = lectureFileUrl(courseId, open.id, page ?? undefined);
  const title = `Lecture ${open.lecture_number}: ${open.title}${page ? `, slide ${page}` : ""}`;

  if (compact) {
    const clean = `${src}${src.includes("#") ? "&" : "#"}toolbar=0&navpanes=0&view=FitH`;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 px-4 py-2 sm:px-5">
          {/* The lecture switcher is the title itself, the way a document's name opens its other versions. */}
          <Dropdown>
            <Dropdown.Trigger className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-default" aria-label={`Lecture: ${open.title}. Choose another lecture`}>
              <span className="truncate text-sm font-medium">
                Lecture {open.lecture_number}: {open.title}
              </span>
              <span className="shrink-0 text-sm text-muted">· PDF</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden />
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom start">
              <Dropdown.Menu aria-label="Lectures" selectionMode="single" selectedKeys={[open.id]} onAction={(key) => onSelect(String(key))}>
                {lectures.map((l) => (
                  <Dropdown.Item key={l.id} id={l.id} textValue={`Lecture ${l.lecture_number}: ${l.title}`}>
                    <div className="flex flex-col">
                      <Label>
                        Lecture {l.lecture_number}: {l.title}
                      </Label>
                      <span className="text-xs text-muted">{`${l.page_count} ${l.page_count === 1 ? "slide" : "slides"}`}</span>
                    </div>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
          <span className="ml-auto" />
          <Tooltip delay={300}>
            <a href={file} download className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-default hover:text-foreground" aria-label="Download the slides">
              <Download className="size-4" aria-hidden />
            </a>
            <Tooltip.Content>Download</Tooltip.Content>
          </Tooltip>
          <Tooltip delay={300}>
            <a href={src} target="_blank" rel="noopener noreferrer" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-default hover:text-foreground" aria-label="Open the slides in a new tab">
              <ExternalLink className="size-4" aria-hidden />
            </a>
            <Tooltip.Content>Open in a new tab</Tooltip.Content>
          </Tooltip>
        </div>
        <iframe key={clean} src={clean} title={title} className="min-h-[24rem] w-full flex-1 border-t border-border bg-surface" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label="Lectures">
        <ul className="flex flex-col gap-1">
          {lectures.map((l) => {
            const on = l.id === open.id;
            return (
              <li key={l.id}>
                <Button
                  variant={on ? "secondary" : "ghost"}
                  aria-current={on ? "page" : undefined}
                  className={cn("h-auto w-full flex-col items-start gap-0.5 px-3 py-2 text-left", on && "ring-1 ring-border")}
                  onPress={() => onSelect(l.id)}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">Lecture {l.lecture_number}</span>
                  <span className="whitespace-normal font-medium">{l.title}</span>
                  <span className="text-xs font-normal text-muted">
                    {[l.lecture_date ? new Date(`${l.lecture_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null, `${l.page_count} ${l.page_count === 1 ? "slide" : "slides"}`].filter(Boolean).join(" · ")}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-2">
        <iframe key={src} src={src} title={title} className="h-[min(75dvh,48rem)] w-full rounded-2xl border border-border bg-surface" />
        <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-start text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">
          <ExternalLink className="size-3.5" aria-hidden /> Open the slides in a new tab
        </a>
      </div>
    </div>
  );
}
