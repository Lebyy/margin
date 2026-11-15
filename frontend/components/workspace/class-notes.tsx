"use client";

import { Disclosure } from "@heroui/react";
import { FileText, NotebookPen } from "lucide-react";
import { Paper } from "@/components/paper";

/**
 * What the professor wrote for the class: the classroom notes, then each
 * added file as a section that opens in place.
 *
 * It is the professor's own text, stored as written (a PDF or picture was
 * read into text once, when it was added). Nothing here is written by the
 * model for the student, and nothing is hidden: the answer key is a field of
 * an assignment, never of a class, so it cannot be in what this shows.
 *
 * `assignmentNotes` is the assignment's own notes, shown first when the pane
 * is beside an assignment, because they are the notes closest to the
 * question being worked on.
 */
export function ClassNotes({
  notes,
  materials,
  assignmentNotes,
  assignmentTitle,
}: {
  notes: string;
  materials: { id: string; title: string; body: string }[];
  assignmentNotes?: string;
  assignmentTitle?: string;
}) {
  if (!notes && materials.length === 0 && !assignmentNotes) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
        <NotebookPen className="size-6 text-muted" aria-hidden />
        <p className="font-medium">No notes yet</p>
        <p className="max-w-sm text-sm text-muted">When your professor adds notes or files to this class, they appear here.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {assignmentNotes ? (
        <Paper as="article" aria-label="Notes for this assignment">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-margin-red">{assignmentTitle ? `For ${assignmentTitle}` : "For this assignment"}</h3>
          <p className="mt-2 whitespace-pre-wrap font-serif text-[17px] leading-7">{assignmentNotes}</p>
        </Paper>
      ) : null}
      {notes ? (
        <Paper as="article" aria-label="Class notes">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-margin-red">Class notes</h3>
          <p className="mt-2 whitespace-pre-wrap font-serif text-[17px] leading-7">{notes}</p>
        </Paper>
      ) : null}
      {materials.map((m) => (
        <Disclosure key={m.id} className="rounded-2xl border border-border px-4">
          <Disclosure.Heading>
            <Disclosure.Trigger className="flex w-full items-center gap-2 py-3.5 text-left font-medium">
              <FileText className="size-4 shrink-0 text-margin-red" aria-hidden /> {m.title}
              <Disclosure.Indicator className="ml-auto" />
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body>
              <p className="whitespace-pre-wrap pb-4 font-serif text-[17px] leading-7">{m.body}</p>
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      ))}
    </div>
  );
}
