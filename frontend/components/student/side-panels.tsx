"use client";

import { Button, Card, Chip, Label, SearchField, Tabs } from "@heroui/react";
import { RotateCcw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { conceptLabel, STRUGGLE_LABEL, type StudentProgress } from "@/lib/api";
import { flashcards, searchNotes } from "@/lib/notes";

/**
 * The three panels beside the chat: the student's own log, a search of the
 * professor's notes, and revision cards cut from those notes.
 *
 * They share one card with tabs so the hint ladder above stays in view. None
 * of them calls a model, and none of them shows anything about another student.
 */
export function SidePanels({
  progress,
  assignmentId,
  notes,
  concepts,
}: {
  progress: StudentProgress | null;
  assignmentId: string;
  notes: string;
  concepts: string[];
}) {
  const labels = useMemo(
    () => (progress?.labels ?? []).filter((l) => l.assignment_id === assignmentId),
    [progress, assignmentId],
  );
  const weakest = useMemo(() => weakestConcept(labels.map((l) => ({ concept: l.concept, struggling: l.struggle_type !== "none" }))), [labels]);

  return (
    <Card aria-label="Your log, notes, and revision">
      <Card.Content>
        <Tabs defaultSelectedKey="log" variant="secondary">
          <Tabs.ListContainer>
            <Tabs.List aria-label="Side panels">
              <Tabs.Tab id="log">
                My log
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="notes">
                Notes
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="revise">
                Revise
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Tabs.Panel id="log" className="pt-3">
            <ProgressLog labels={labels} />
          </Tabs.Panel>
          <Tabs.Panel id="notes" className="pt-3">
            <NotesSearch notes={notes} />
          </Tabs.Panel>
          <Tabs.Panel id="revise" className="pt-3">
            <Revise notes={notes} concepts={concepts} weakest={weakest} />
          </Tabs.Panel>
        </Tabs>
      </Card.Content>
    </Card>
  );
}

/**
 * The concept this student has struggled with on the most turns, or null.
 * It picks which revision cards to show first. It is this student's own count from their own labels, shown only to them, and it is not sent anywhere.
 */
function weakestConcept(rows: { concept: string; struggling: boolean }[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.struggling) counts.set(r.concept, (counts.get(r.concept) ?? 0) + 1);
  let best: string | null = null;
  for (const [concept, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = concept;
  return best;
}

/**
 * The student's own formative log: one row per message, with the concept and
 * the kind of struggle the scribe saw.
 *
 * It is the progress route's labels, printed as they are. There is no score,
 * no rank, and no class average, and there must never be: a comparison to
 * classmates turns a learning log into a grade. The route does not send an
 * integrity flag, so there is none to show.
 */
function ProgressLog({ labels }: { labels: StudentProgress["labels"] }) {
  if (labels.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing yet. Each message you send is noted here with the idea it was about. It is your log, not a grade.
      </p>
    );
  }
  return (
    <div>
      <p className="mb-2 text-xs text-muted">Your log, not a grade. Only you and your professor can see it.</p>
      <ol className="flex flex-col gap-2">
        {[...labels].reverse().map((l, i) => (
          <li key={`${l.created_at}-${i}`} className="rounded-lg border border-border px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip size="sm" variant="soft" color="accent">{conceptLabel(l.concept)}</Chip>
              <Chip size="sm" variant="soft" color={l.struggle_type === "none" ? "default" : "warning"}>
                {STRUGGLE_LABEL[l.struggle_type]}
              </Chip>
              {l.demonstrated_understanding ? (
                <Chip size="sm" variant="soft" color="success">understood</Chip>
              ) : null}
              {l.hint_level ? <span className="ml-auto text-xs text-muted">hint level {l.hint_level}</span> : null}
            </div>
            {l.evidence ? <p className="mt-1.5 text-xs text-muted">&ldquo;{l.evidence}&rdquo;</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * A keyword search of the professor's pasted notes.
 *
 * The level-2 hint points at a place in these notes. This lets the student go
 * and look. It is a string match in the browser over text the page already
 * has, so there is no search service and no request per keystroke.
 */
function NotesSearch({ notes }: { notes: string }) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchNotes(notes, query), [notes, query]);
  if (notes.trim().length === 0) {
    return <p className="text-sm text-muted">Your professor has not added notes to this assignment.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <SearchField value={query} onChange={setQuery} aria-label="Search your professor's notes" fullWidth>
        <Label>Search your professor&rsquo;s notes</Label>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="base case" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      {query.trim().length === 0 ? (
        <p className="text-xs text-muted">Try a word from your hint, such as &ldquo;base case&rdquo; or &ldquo;Lecture 7&rdquo;.</p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-muted">No line in the notes matches that.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {hits.map((hit) => (
            <li key={hit.index} className="rounded-lg border border-border px-3 py-2 font-serif text-sm leading-6">
              {hit.line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Revision cards for one concept, cut from the notes.
 *
 * The first concept shown is the one this student has struggled with most. A
 * card is a line of the professor's notes with the concept's name hidden.
 * Pressing it flips to the full line. No model writes a card, so a card
 * cannot contain a line of the solution: the notes are all it can draw from.
 */
function Revise({ notes, concepts, weakest }: { notes: string; concepts: string[]; weakest: string | null }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const concept = chosen ?? weakest ?? concepts[0] ?? null;
  const cards = useMemo(() => (concept ? flashcards(notes, concept) : []), [notes, concept]);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const card = cards[index % Math.max(cards.length, 1)];

  if (!concept) return <p className="text-sm text-muted">This assignment has no concepts to revise.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Concept to revise">
        {concepts.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={c === concept ? "secondary" : "ghost"}
            aria-pressed={c === concept}
            onPress={() => {
              setChosen(c);
              setIndex(0);
              setShown(false);
            }}
          >
            {conceptLabel(c)}
          </Button>
        ))}
      </div>
      {weakest && concept === weakest ? (
        <p className="text-xs text-muted">Starting with the idea you have been stuck on most.</p>
      ) : null}
      {!card ? (
        <p className="text-sm text-muted">
          The notes do not mention {conceptLabel(concept)}, so there is no card for it. Cards are only ever cut from your
          professor&rsquo;s notes.
        </p>
      ) : (
        <>
          <AnimatePresence mode="wait">
            <motion.div
              key={`${card.id}-${shown}`}
              initial={{ rotateX: -80, opacity: 0 }}
              animate={{ rotateX: 0, opacity: 1 }}
              exit={{ rotateX: 80, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-lg border border-border bg-paper px-4 py-5 font-serif text-base leading-7"
            >
              {card.before}
              {shown ? (
                <mark className="rounded bg-margin-green-soft px-1 text-margin-green">{card.hidden}</mark>
              ) : (
                <span className="rounded bg-margin-red-soft px-3 text-margin-red" aria-label="hidden term">
                  ?
                </span>
              )}
              {card.after}
            </motion.div>
          </AnimatePresence>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onPress={() => setShown((s) => !s)}>
              <RotateCcw className="size-3.5" aria-hidden /> {shown ? "Hide" : "Flip"}
            </Button>
            {cards.length > 1 ? (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  setIndex((i) => (i + 1) % cards.length);
                  setShown(false);
                }}
              >
                Next card
              </Button>
            ) : null}
            <span className="ml-auto text-xs text-muted">
              {(index % cards.length) + 1} of {cards.length}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
