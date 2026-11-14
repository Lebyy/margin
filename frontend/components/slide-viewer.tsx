"use client";

import { Button } from "@heroui/react";
import { ExternalLink, Presentation } from "lucide-react";
import { lectureFileUrl, type Lecture } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The class's lecture slides: the list on one side, the open lecture on the
 * other, in the browser's own PDF viewer.
 *
 * The viewer is an iframe of the file route with `#page=n`, which every
 * built-in PDF viewer opens at that page. That is how a citation in Margin's
 * reply, "[Lecture 3, slide 9]", lands on slide 9: the course page passes the
 * lecture and page from the link down to here. Changing `page` changes the
 * iframe's key, so the viewer reloads at the new page instead of keeping its
 * scroll position. A link under the viewer opens the PDF in its own tab, for
 * a phone whose browser will not show a PDF inside a page.
 */
export function SlideViewer({ courseId, lectures, selectedId, page, onSelect }: { courseId: string; lectures: Lecture[]; selectedId: string | null; page: number | null; onSelect: (id: string) => void }) {
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
  const src = lectureFileUrl(courseId, open.id, page ?? undefined);
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
        <iframe key={src} src={src} title={`Lecture ${open.lecture_number}: ${open.title}${page ? `, slide ${page}` : ""}`} className="h-[min(75dvh,48rem)] w-full rounded-2xl border border-border bg-surface" />
        <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-start text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">
          <ExternalLink className="size-3.5" aria-hidden /> Open the slides in a new tab
        </a>
      </div>
    </div>
  );
}
