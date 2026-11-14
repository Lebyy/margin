"use client";

import { Button, Card, Chip, Label, SearchField, Spinner, Tabs } from "@heroui/react";
import { RotateCcw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { api, conceptLabel, STRUGGLE_LABEL, type Flashcards, type StudentProgress } from "@/lib/api";
import { searchNotes } from "@/lib/notes";

/**
 * The three panels beside the chat: the student's own log, a search of the
 * professor's notes, and revision cards written from those notes.
 *
 * They share one card with tabs so the hint ladder above stays in view. None
 * of them shows anything about another student. The cards come from the
 * server, which writes them with a model and runs the guard's check on each.
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
            {progress ? (
              <Revise studentId={progress.student_id} assignmentId={assignmentId} concepts={concepts} turns={labels.length} />
            ) : (
              <p className="text-sm text-muted">Start a session to get revision cards.</p>
            )}
          </Tabs.Panel>
        </Tabs>
      </Card.Content>
    </Card>
  );
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
 * Revision cards for one concept (D-R4), from GET /api/students/:id/flashcards.
 *
 * With no concept chosen, the server picks this student's weakest concept
 * from their own labels, so the deck follows what they are stuck on. It is
 * asked again after each turn (`turns` changes), because a new label can
 * change the weakest concept. The concept buttons ask for another concept.
 * Every card was written from the professor's notes and passed the guard's
 * check on the server; this component only shows the front and flips to the
 * back.
 */
function Revise({ studentId, assignmentId, concepts, turns }: { studentId: string; assignmentId: string; concepts: string[]; turns: number }) {
  const [chosen, setChosen] = useState<string | null>(null);
  // Each answer is stored with the request it answers. Until the answer for
  // the current request arrives, the panel is loading, so a deck for the old
  // concept is never shown under the new concept's button.
  const request = `${studentId}|${assignmentId}|${chosen ?? ""}|${turns}`;
  const [result, setResult] = useState<{ request: string; deck: Flashcards | null } | null>(null);
  // Which card is up and whether it is flipped, reset whenever a new deck arrives.
  const [view, setView] = useState({ request: "", index: 0, shown: false });

  useEffect(() => {
    let live = true;
    api
      .flashcards(studentId, assignmentId, chosen ?? undefined)
      .then((deck) => live && setResult({ request, deck }))
      .catch(() => live && setResult({ request, deck: null }));
    return () => {
      live = false;
    };
  }, [request, studentId, assignmentId, chosen]);

  if (concepts.length === 0) return <p className="text-sm text-muted">This assignment has no concepts to revise.</p>;
  const state = result?.request !== request ? "loading" : result.deck === null ? "error" : "ready";
  const deck = state === "ready" ? result?.deck : null;
  const concept = deck?.concept ?? chosen;
  const cards = deck?.cards ?? [];
  const { index, shown } = view.request === request ? view : { index: 0, shown: false };
  const setIndex = (next: (i: number) => number) => setView({ request, index: next(index), shown: false });
  const setShown = (next: (s: boolean) => boolean) => setView({ request, index, shown: next(shown) });
  const card = cards[index % Math.max(cards.length, 1)];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Concept to revise">
        {concepts.map((c) => (
          <Button key={c} size="sm" variant={c === concept ? "secondary" : "ghost"} aria-pressed={c === concept} onPress={() => setChosen(c)}>
            {conceptLabel(c)}
          </Button>
        ))}
      </div>
      {state === "loading" ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" /> Writing cards from your professor&rsquo;s notes
        </p>
      ) : state === "error" ? (
        <p className="text-sm text-muted">The cards could not be written just now. Try another concept, or come back after your next message.</p>
      ) : concept === null ? (
        <p className="text-sm text-muted">No cards yet. Once you get stuck on an idea, cards for it show up here. Or pick a concept above.</p>
      ) : !card ? (
        <p className="text-sm text-muted">
          Your professor&rsquo;s notes do not cover {conceptLabel(concept)}, so there is no card for it. Cards are only written from
          the notes.
        </p>
      ) : (
        <>
          {chosen === null ? <p className="text-xs text-muted">Starting with the idea you have been stuck on most.</p> : null}
          <AnimatePresence mode="wait">
            <motion.div
              key={`${index}-${shown}-${concept}`}
              initial={{ rotateX: -80, opacity: 0 }}
              animate={{ rotateX: 0, opacity: 1 }}
              exit={{ rotateX: 80, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`rounded-lg border px-4 py-5 font-serif text-base leading-7 ${shown ? "border-margin-green bg-margin-green-soft" : "border-border bg-paper"}`}
              aria-live="polite"
            >
              <p className="mb-1 font-sans text-xs font-medium uppercase tracking-wide text-muted">{shown ? "Answer" : "Question"}</p>
              {shown ? card.back : card.front}
            </motion.div>
          </AnimatePresence>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onPress={() => setShown((s) => !s)}>
              <RotateCcw className="size-3.5" aria-hidden /> {shown ? "Show question" : "Flip"}
            </Button>
            {cards.length > 1 ? (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => setIndex((i) => (i + 1) % cards.length)}
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
