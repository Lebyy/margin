"use client";

import { Chip } from "@heroui/react";
import { FileText, Image as ImageIcon } from "lucide-react";
import { ApiNumber } from "@/components/api-number";
import { attachmentUrl, canvasPictureUrl, conceptLabel, STRUGGLE_LABEL, type WorkSummary } from "@/lib/api";
import { openAs, type FileRef } from "@/lib/files";

/**
 * Work beyond the chat: what students did on the canvas and in files, what
 * Askretes did with it, and where that work shows struggle.
 *
 * Every number is the server's, counted in code from stored messages and the
 * scribe's labels (backend work.ts); the scribe labels a turn with canvas or
 * file work from that work itself. The gallery shows the newest pieces: the
 * exact canvas picture Askretes was shown, or the file, each opening the stored
 * original, with Askretes' notes on it. Pressing a student's name opens their
 * full transcript.
 */
export function WorkPanel({ work, onOpenStudent, onOpenFile }: { work: WorkSummary; onOpenStudent: (studentId: string) => void; onOpenFile: (file: FileRef) => void }) {
  const kinds = Object.entries(work.files.by_kind);
  // Only pieces that can be opened: a canvas whose picture was stored, a file whose original was stored. Older turns from before storage have nothing to show.
  const recent = work.recent.filter((r) => (r.kind === "canvas" ? r.has_picture : !!r.file?.id));
  return (
    <section aria-label="Canvas and file work" className="flex flex-col gap-5 pb-2">
      <p className="text-sm text-muted">Canvas work and files students shared with Askretes, and where that work shows struggle.</p>
        <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Tile value={work.canvas.students} label={`students used the canvas (${work.canvas.turns} turns)`} />
          <Tile value={work.files.count} label={`files from ${work.files.students} students`} />
          <Tile value={work.margin.marks} label="places Askretes marked on student work" />
          <Tile value={work.margin.drawings} label="diagrams Askretes drew" />
        </dl>
        {kinds.length ? (
          <p className="flex flex-wrap gap-1.5 text-sm text-muted">
            Files:
            {kinds.map(([k, n]) => (
              <Chip key={k} size="sm" variant="soft">
                {k} {n}
              </Chip>
            ))}
          </p>
        ) : null}

        {work.concepts.length ? (
          <section aria-labelledby="work-concepts" className="flex flex-col gap-2">
            <h3 id="work-concepts" className="text-sm font-medium">Struggle in canvas and file work</h3>
            <ul className="flex flex-col gap-1.5">
              {work.concepts.map((c) => (
                <li key={c.concept} className="flex items-center gap-3 text-sm">
                  <span className="w-44 shrink-0 truncate">{conceptLabel(c.concept)}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-default" aria-hidden>
                    <span className="block h-full rounded-full bg-margin-red" style={{ width: `${c.percent_struggling}%` }} />
                  </span>
                  <span className="w-48 shrink-0 text-right text-muted tabular-nums">
                    {c.percent_struggling}% · {c.students_struggling} students · {c.turns} turns
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {recent.length ? (
          <section aria-labelledby="work-recent" className="flex flex-col gap-2">
            <h3 id="work-recent" className="text-sm font-medium">Recent work</h3>
            <ul className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
              {recent.map((r, i) => {
                const href = r.kind === "canvas" ? canvasPictureUrl(r.session_id, r.message_id) : r.file?.id ? attachmentUrl(r.session_id, r.file.id) : null;
                // What the in-page viewer opens: the canvas picture, or the stored file, under a key of its own so it is fetched once.
                const ref: FileRef | null = href ? { name: r.kind === "canvas" ? `${r.display_name} canvas.jpg` : (r.file?.name ?? "file"), key: `prof|${r.message_id}|${r.file?.id ?? "canvas"}`, url: href } : null;
                const picture = r.kind === "canvas" ? r.has_picture : openAs(r.file?.name ?? "") === "image";
                return (
                  <li key={`${r.message_id}-${i}`} className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
                    <button type="button" disabled={!ref} onClick={() => ref && onOpenFile(ref)} className="flex h-24 items-center justify-center overflow-hidden bg-default/40 outline-offset-[-2px] hover:opacity-90" aria-label={r.kind === "canvas" ? `Open ${r.display_name}'s canvas` : `Open ${r.file?.name}`}>
                      {picture && href ? (
                        // Served from the server's store; next/image would need a remote pattern for the API host.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={href} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : r.kind === "canvas" ? (
                        <ImageIcon className="size-6 text-muted" aria-hidden />
                      ) : (
                        <span className="flex flex-col items-center gap-1 px-3 text-center text-sm">
                          <FileText className="size-5 text-muted" aria-hidden />
                          <span className="line-clamp-2 break-all">{r.file?.name}</span>
                        </span>
                      )}
                    </button>
                    <div className="flex flex-col gap-1 p-2.5 text-xs">
                      <button type="button" className="self-start text-sm font-medium hover:underline" onClick={() => onOpenStudent(r.student_id)}>
                        {r.display_name}
                      </button>
                      {r.concept ? (
                        <span className="text-muted">
                          {conceptLabel(r.concept)}
                          {r.struggle_type ? ` · ${STRUGGLE_LABEL[r.struggle_type]}` : ""}
                        </span>
                      ) : null}
                      {r.margin.notes.length ? <span className="text-margin-red">Askretes: &ldquo;{r.margin.notes[0]}&rdquo;</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <p className="text-sm text-muted">No stored canvas work or files on this assignment yet.</p>
        )}
    </section>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <dd className="font-serif text-2xl font-semibold tabular-nums">
        <ApiNumber value={value} />
      </dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  );
}
