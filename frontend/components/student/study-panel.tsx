"use client";

import { Button, Chip, Label, SearchField, Spinner, TextArea, TextField } from "@heroui/react";
import { Check, ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, conceptLabel, loadStudy, type StudyCard } from "@/lib/api";
import { searchNotes } from "@/lib/notes";

/**
 * Study: revision cards written from the professor's notes, and the notes themselves.
 *
 * The cards come from the study route. A model writes them from the notes
 * only, the server drops any card the guard's string check would hold, and
 * each card names the line of the notes it came from. They are fetched when
 * this panel first opens, not on page load, so a student who never opens
 * Study spends no model call.
 *
 * `first` is the concept this student has struggled with most, from their own
 * log. Its card is shown first.
 *
 * Below the cards the notes are shown in full. The search narrows them. It
 * does not start empty and wait for a query, because a student who was just
 * told "look at Lecture 7" should see Lecture 7 without guessing a keyword.
 */
export function StudyPanel({ assignmentId, studentId, notes, first }: { assignmentId: string; studentId: string | null; notes: string; first: string | null }) {
  const [cards, setCards] = useState<StudyCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    loadStudy(assignmentId)
      .then((c) => live && setCards(c))
      .catch(() => live && setCards([]));
    return () => {
      live = false;
    };
  }, [assignmentId]);

  const ordered = useMemo(() => {
    if (!cards) return [];
    return [...cards].sort((a, b) => Number(b.concept === first) - Number(a.concept === first));
  }, [cards, first]);
  const card = ordered[index % Math.max(ordered.length, 1)];
  const go = (step: number) => {
    setIndex((i) => (i + step + ordered.length) % ordered.length);
    setFlipped(false);
  };

  const noteLines = useMemo(() => notes.split("\n").map((l) => l.trim()).filter(Boolean), [notes]);
  const hits = useMemo(() => new Set(searchNotes(notes, query).map((h) => h.line)), [notes, query]);
  const shown = query.trim().length < 3 ? noteLines : noteLines.filter((l) => hits.has(l));

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Revision cards">
        {cards === null ? (
          <div className="flex h-44 items-center justify-center gap-2 text-sm text-muted">
            <Spinner size="sm" /> Reading the notes
          </div>
        ) : !card ? (
          <p className="py-6 text-sm text-muted">No cards yet. The notes do not cover these concepts.</p>
        ) : (
          <>
            <AnimatePresence mode="wait">
              <motion.button
                key={`${card.concept}-${flipped}`}
                type="button"
                onClick={() => setFlipped((f) => !f)}
                aria-label={flipped ? "Show the question" : "Show the answer"}
                initial={{ rotateX: -70, opacity: 0 }}
                animate={{ rotateX: 0, opacity: 1 }}
                exit={{ rotateX: 70, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="paper flex min-h-44 w-full flex-col items-start justify-between gap-3 py-4 pr-4 text-left outline-offset-2"
              >
                <Chip size="sm" variant="soft" color={flipped ? "success" : "accent"}>
                  {conceptLabel(card.concept)}
                </Chip>
                <span className="font-serif text-lg leading-7">{flipped ? card.answer : card.question}</span>
                <span className="text-xs text-muted">{flipped ? card.source : "Tap to check"}</span>
              </motion.button>
            </AnimatePresence>
            <div className="mt-2 flex items-center justify-between">
              <Button isIconOnly size="sm" variant="ghost" aria-label="Previous card" isDisabled={ordered.length < 2} onPress={() => go(-1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs tabular-nums text-muted">
                {(index % ordered.length) + 1} / {ordered.length}
              </span>
              <Button isIconOnly size="sm" variant="ghost" aria-label="Next card" isDisabled={ordered.length < 2} onPress={() => go(1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </>
        )}
      </section>

      {studentId ? <OwnNotes studentId={studentId} assignmentId={assignmentId} /> : null}

      <section aria-label="Lecture notes" className="flex flex-col gap-2">
        {noteLines.length === 0 ? (
          <p className="text-sm text-muted">No notes on this assignment.</p>
        ) : (
          <>
            <SearchField value={query} onChange={setQuery} fullWidth>
              <Label>Lecture notes</Label>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            {shown.length === 0 ? (
              <p className="text-sm text-muted">No match.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {shown.map((line, i) => (
                  <li key={i} className="py-2 font-serif text-[15px] leading-6">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * The student's own notes for this assignment.
 *
 * They type here or load a text file, and the notes are saved to their own
 * record a moment after they stop typing. Askretes reads them as the student's
 * material when the student asks for help. The professor's screens do not
 * show them.
 *
 * A loaded file is read in the browser and added under what is already there,
 * so loading a second file never wipes the first. Only plain text is taken:
 * the notes are sent to the tutor as text, and a PDF or a slide deck would
 * arrive as bytes it cannot read.
 */
function OwnNotes({ studentId, assignmentId }: { studentId: string; assignmentId: string }) {
  const [body, setBody] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api
      .ownNotes(studentId, assignmentId)
      .then((r) => live && setBody(r.body))
      .catch(() => live && setBody(""));
    return () => {
      live = false;
    };
  }, [studentId, assignmentId]);

  /** Saves a moment after the last keystroke, so a paragraph is one request and not one per letter. */
  function edit(next: string) {
    setBody(next);
    setSaved(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api
        .saveOwnNotes(studentId, assignmentId, next.slice(0, 20000))
        .then(() => setSaved(true))
        .catch(() => undefined);
    }, 700);
  }

  if (body === null) return null;
  return (
    <section aria-label="My notes" className="flex flex-col gap-2">
      <TextField value={body} onChange={edit} fullWidth>
        <div className="flex items-center justify-between">
          <Label>My notes</Label>
          <span className="flex items-center gap-1 text-xs text-muted">
            {saved && body ? (
              <>
                <Check className="size-3.5 text-margin-green" aria-hidden /> Saved
              </>
            ) : null}
            <Button size="sm" variant="ghost" onPress={() => fileRef.current?.click()}>
              <Upload className="size-3.5" aria-hidden /> Add a file
            </Button>
          </span>
        </div>
        <TextArea rows={5} placeholder="Type your notes, or add a text file" className="font-serif text-[15px] leading-6" />
      </TextField>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.markdown,text/plain"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const text = await file.text();
          edit(body ? `${body}\n\n${text}` : text);
        }}
      />
    </section>
  );
}
