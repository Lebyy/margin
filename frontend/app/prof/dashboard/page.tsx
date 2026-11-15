"use client";

import { Alert, Button, Card, Chip, Drawer, Label, Meter, Spinner } from "@heroui/react";
import { ArrowRight, Clock, MessageCircleQuestion, Paperclip, ShieldCheck, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ApiNumber } from "@/components/api-number";
import { Paper } from "@/components/paper";
import { ChooseProfessor } from "@/components/prof/choose-professor";
import { BoardPreview } from "@/components/prof/board-preview";
import { ToolCalls } from "@/components/prof/tool-calls";
import { WorkPanel } from "@/components/prof/work-panel";
import { AnalystChat } from "@/components/prof/analyst-chat";
import { ArtifactPane } from "@/components/workspace/artifact-pane";
import { Markdown } from "@/components/workspace/markdown";
import { FileLightbox } from "@/components/workspace/file-viewer";
import type { FileRef } from "@/lib/files";
import { RichReply } from "@/components/workspace/rich-reply";
import { StudentIdCard, type CardIssuer } from "@/components/prof/student-id-card";
import { matches, NO_FILTER, StudentFilters, type StudentFilter } from "@/components/prof/student-filters";
import { duration, TimingsPanel } from "@/components/prof/timings-panel";
import { useAssignment } from "@/components/prof/use-assignment";
import {
  api,
  ApiError,
  attachmentUrl,
  boardFileUrl,
  canvasPictureUrl,
  conceptLabel,
  STRUGGLE_LABEL,
  type ClassSummary,
  type ConceptSummary,
  type Roster,
  type StruggleType,
  type StudentSummary,
  type ThursdayCard,
  type Timings,
  type ProfessorMessage,
  type Transcript,
  type WorkSummary,
  type TranscriptTurn,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/** The struggle types the heatmap has a column for. `none` is not a struggle, so it has no column. */
const STRUGGLE_COLUMNS: Exclude<StruggleType, "none">[] = ["misconception", "stuck_starting", "syntax_or_mechanics", "careless_error"];

/**
 * The professor's dashboard.
 *
 * The order on the page is the order of the job: what to reteach, then which
 * concepts the class is stuck on, then, only below that, individual students.
 * A stranger should be able to point at the reteach card without being told.
 *
 * Every number comes from the API as shown. This page formats numbers and
 * does not compute them: the percent in a heatmap row is
 * `percent_struggling` from the class summary, and the percent on the card is
 * the one stored with the card. The animated counter only counts up to that
 * value.
 *
 * Opening the page calls no model. The summary and the roster are counts from
 * our database, and the card is the stored one. The model runs once, when the
 * professor presses generate.
 */
/**
 * The assignment workspace. The sidebar links here with ?assignment=<id>;
 * moving to another assignment changes only the query, so the workspace is
 * keyed by it and starts fresh for each assignment.
 */
export default function DashboardRoute() {
  const params = useSearchParams();
  return <DashboardPage key={params.get("assignment") ?? "latest"} />;
}

function DashboardPage() {
  const router = useRouter();
  const pick = useAssignment();
  const assignmentId = pick.state === "ready" ? pick.assignmentId : null;

  const [summary, setSummary] = useState<ClassSummary | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [card, setCard] = useState<ThursdayCard | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [cardNote, setCardNote] = useState<string | null>(null);
  const [openStudent, setOpenStudent] = useState<StudentSummary | null>(null);
  /** A student's file or canvas picture open over the page (the work gallery and the transcript both open it here, never in a new tab). */
  const [viewing, setViewing] = useState<FileRef | null>(null);
  // The dashboard panel beside the analyst chat: open on a wide screen, which view it shows, and whether it takes the full width.
  const [paneOpen, setPaneOpen] = useState(false);
  const [paneView, setPaneView] = useState("home");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setPaneOpen(window.matchMedia("(min-width: 1200px)").matches), 0);
    return () => window.clearTimeout(id);
  }, []);
  // The professor's filter over the student list and the timing table. Kept across a refresh so new rows land inside it.
  const [filter, setFilter] = useState<StudentFilter>(NO_FILTER);
  // How many matching cards are drawn. A class of 200 is drawn in pages of 24 so the page stays quick to scroll.
  const [shownCount, setShownCount] = useState(24);
  // The class the open assignment belongs to, for the student cards' colour strip and "CS 101 · Fall 2026" line.
  const [issuer, setIssuer] = useState<CardIssuer>(null);
  const courseId = pick.state === "ready" ? (pick.assignments.find((a) => a.id === pick.assignmentId)?.course_id ?? null) : null;
  useEffect(() => {
    if (!courseId) return;
    let live = true;
    api
      .profCourses()
      .then(({ courses }) => {
        const c = courses.find((x) => x.id === courseId);
        if (live) setIssuer(c ? { code: c.code || c.name, term: c.term, accent: c.accent } : null);
      })
      .catch(() => live && setIssuer(null));
    return () => {
      live = false;
    };
  }, [courseId]);

  // Bumped by the refresh button. The effect below re-reads the three routes whenever it changes.
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  // While the page is open and in front, its numbers are re-read every minute, so the heatmap and the roster follow the class as it works. The Thursday card is rewritten on the server in batches (backend live-card.ts) and arrives with the same read.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setVersion((v) => v + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // The timing table's data. Fetched with everything else below, not by the panel after the page has drawn:
  // that second wave started at about 1.9 s on a class of 200. Undefined while loading, null if it failed.
  const [timings, setTimings] = useState<Timings | null | undefined>(undefined);
  // Canvas and file work (backend work.ts). A failed read only hides that panel.
  const [work, setWork] = useState<WorkSummary | null>(null);

  useEffect(() => {
    if (!assignmentId) return;
    let live = true;
    Promise.all([
      api.classSummary(assignmentId),
      api.roster(assignmentId),
      // 404 `no_card_yet` is the ordinary state before the first generate, not an error.
      api.thursdayCard(assignmentId).catch(() => null),
      // A failed timing read only empties that panel; it does not fail the dashboard.
      api.timings(assignmentId).catch(() => null),
      api.workSummary(assignmentId).catch(() => null),
    ])
      .then(([s, r, c, t, w]) => {
        if (!live) return;
        setFailed(false);
        setSummary(s);
        setRoster(r);
        setCard(c);
        setTimings(t);
        setWork(w);
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [assignmentId, version]);

  // The list below follows the search a moment behind the typing (useDeferredValue), so each keystroke shows in the
  // box at once and the cards and the table catch up when the browser is free. The set of matching ids is made once
  // per filter change, so the memoized timing panel sees the same Set until the filter actually changes.
  const deferredFilter = useDeferredValue(filter);
  const matching = useMemo(() => (roster ? roster.students.filter((s) => matches(s, deferredFilter)) : []), [roster, deferredFilter]);
  const matchingIds = useMemo(() => (deferredFilter === NO_FILTER ? null : new Set(matching.map((s) => s.student_id))), [deferredFilter, matching]);

  /**
   * Runs the generate endpoint, once, on a press.
   * A 409 means nobody has struggled yet, so there is nothing true to put on a card. The page says that and stores nothing. It is never called on load or on an empty class.
   */
  async function generate() {
    if (!assignmentId) return;
    setGenerating(true);
    setCardNote(null);
    try {
      setCard(await api.generateThursdayCard(assignmentId));
    } catch (e) {
      setCardNote(
        e instanceof ApiError && e.code === "no_struggles_yet"
          ? "Nobody has struggled yet, so there is nothing to reteach."
          : "The card was not written. Nothing was stored.",
      );
    } finally {
      setGenerating(false);
    }
  }

  // No professor chosen: ask, rather than show anyone's class (see ChooseProfessor).
  if (pick.state === "no_profile") return <Scroll><ChooseProfessor /></Scroll>;
  if (pick.state === "loading" || (assignmentId && !loaded)) {
    return (
      <div className="flex items-center justify-center gap-2 pt-24 text-muted">
        <Spinner aria-label="Opening the dashboard" />
      </div>
    );
  }
  if (pick.state === "error" || failed) {
    return (
      <Scroll>
      <Alert status="danger" className="mx-auto mt-10 max-w-xl">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>{pick.state === "error" ? pick.message : "The dashboard could not be loaded."}</Alert.Description>
        </Alert.Content>
      </Alert>
      </Scroll>
    );
  }
  if (pick.state === "none" || !summary || !roster || !assignmentId) {
    return (
      <Scroll>
      <EmptyClass
        title="No assignment yet"
        text="Create one, then have a student start a session."
        action="Create an assignment"
        onAction={() => router.push("/prof/setup")}
      />
      </Scroll>
    );
  }

  const title = pick.state === "ready" ? pick.assignments.find((a) => a.id === assignmentId)?.title : "";

  // Nobody has started a session. The heatmap would be a grid of zeros that reads as broken, so the page says what has not happened yet instead.
  if (summary.total_students === 0) {
    return (
      <Scroll>
      <div className="flex flex-col gap-5">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">{title}</h1>
        <EmptyClass
          title="The class has not studied yet"
          text="Nobody has started a session yet."
          action="Open the student page"
          onAction={() => router.push(`/student/assignment/${assignmentId}`)}
        />
      </div>
      </Scroll>
    );
  }


  const openById = (id: string) => setOpenStudent(roster.students.find((s) => s.student_id === id) ?? null);

  // The dashboard, as the panel beside the analyst. Overview is what the professor reads first; the other views are one press away.
  const overview = (
    <div className="flex flex-col gap-5 pb-2">
      <ThursdayCardPanel card={card} classSize={summary.total_students} generating={generating} note={cardNote} onGenerate={generate} />
      <Heatmap summary={summary} />
      <GuardStrip roster={roster} />
      <ClassTime roster={roster} />
    </div>
  );
  const students = (
    <div className="flex flex-col gap-4 pb-2">
      <p className="text-sm text-muted">In the order they started, then those who have not started. Not ranked, not graded.</p>
      <StudentFilters
        filter={filter}
        onChange={(f) => {
          setFilter(f);
          setShownCount(24);
        }}
        concepts={summary.concepts.map((c) => c.concept)}
        students={roster.students}
      />
      {matching.length === 0 ? (
        <p className="py-6 text-center text-muted">No student matches these filters.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {matching.slice(0, shownCount).map((s) => (
            <li key={s.student_id}>
              <StudentIdCard student={s} issuer={issuer} onOpen={setOpenStudent} />
            </li>
          ))}
        </ul>
      )}
      {matching.length > shownCount ? (
        <Button variant="secondary" className="self-center" onPress={() => setShownCount((n) => n + 24)}>
          Show {Math.min(24, matching.length - shownCount)} more of {matching.length - shownCount}
        </Button>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="flex min-h-0 flex-1">
        {expanded && paneOpen ? null : (
          <AnalystChat
            assignmentId={assignmentId}
            title={title ?? ""}
            classLabel={issuer?.code ?? ""}
            paneOpen={paneOpen}
            onTogglePane={() => setPaneOpen(!paneOpen)}
            onRefresh={refresh}
            onOpenStudent={openById}
          />
        )}
        <ArtifactPane
          tabbed
          label="Class dashboard"
          defaultWidth={46}
          widthKey="margin.prof.pane.width"
          expanded={expanded}
          onExpandedChange={setExpanded}
          isOpen={paneOpen}
          onOpenChange={(open) => {
            setPaneOpen(open);
            if (!open) setExpanded(false);
          }}
          view={paneView}
          onView={setPaneView}
          home={{ title: "Overview", content: overview }}
          views={[
            { id: "students", label: `Students ${roster.students.length}`, content: students },
            { id: "work", label: "Canvas & files", content: work ? <WorkPanel work={work} onOpenStudent={openById} onOpenFile={setViewing} /> : <p className="py-6 text-muted">No canvas or file work yet.</p> },
            { id: "timings", label: "Time", content: <TimingsPanel timings={timings} studentIds={matchingIds} /> },
            { id: "messages", label: "Messages", content: <MessagesView assignmentId={assignmentId} /> },
          ]}
        />
      </div>
      <FileOpener.Provider value={setViewing}>
        <TranscriptDrawer student={openStudent} assignmentId={assignmentId} onClose={() => setOpenStudent(null)} />
      </FileOpener.Provider>
      <FileLightbox file={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

/** Opens a file over the page; the dashboard provides it so the transcript, which sits in a drawer, can open files without a new tab. */
const FileOpener = createContext<(file: FileRef) => void>(() => undefined);

/** A file the student attached, in the transcript: its name, opening the in-page viewer. */
function OpenFileChip({ file }: { file: FileRef }) {
  const open = useContext(FileOpener);
  return (
    <button type="button" onClick={() => open(file)} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs hover:bg-default">
      <Paperclip className="size-3" aria-hidden /> {file.name}
    </button>
  );
}

/** A page of the workspace that is not the chat (an empty or loading state): it scrolls in the middle, padded like the other professor pages. */
function Scroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-10 sm:px-8">{children}</div>
    </div>
  );
}

/**
 * The professor messages written with each Thursday card, newest first, in the dashboard panel. It is the same list as the Messages page, read from GET /api/prof/messages.
 */
function MessagesView({ assignmentId }: { assignmentId: string }) {
  const [messages, setMessages] = useState<ProfessorMessage[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api
      .profMessages(assignmentId)
      .then((r) => live && setMessages(r.messages))
      .catch(() => live && setMessages(null));
    return () => {
      live = false;
    };
  }, [assignmentId]);
  if (messages === undefined) return <Spinner className="m-6" aria-label="Loading messages" />;
  if (messages === null) return <p className="py-6 text-muted">The messages could not be loaded.</p>;
  if (messages.length === 0) return <p className="py-6 text-muted">No Thursday card has been written yet. Generate one on the Overview.</p>;
  return (
    <ol className="flex flex-col gap-4 pb-2">
      {messages.map((m) => (
        <li key={m.id} className="rounded-xl border border-border bg-surface p-4">
          <p className="mb-2 text-xs text-muted">{new Date(m.created_at).toLocaleString()}</p>
          <div className="text-sm leading-6">
            <Markdown text={m.body.replace(/\n/g, "  \n")} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The Thursday card: what to reteach, with the percent that code counted.
 *
 * The big number is `percent_struggling` from the stored card, the same value
 * the class summary reports for that concept at the time it was generated.
 * The prose and the three problems are the model's. The numbers are not.
 * After a reload this shows the same stored card, with the time it was made.
 */
function ThursdayCardPanel({
  card,
  classSize,
  generating,
  note,
  onGenerate,
}: {
  card: ThursdayCard | null;
  /** Students with a session now, from the class summary. The card keeps the count from when it was generated, and the two can differ. */
  classSize: number;
  generating: boolean;
  note: string | null;
  onGenerate: () => void;
}) {
  return (
    <Paper as="section" aria-label="Thursday card" className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-margin-red">Reteach on Thursday</h2>
        <Button size="sm" variant={card ? "ghost" : "primary"} onPress={onGenerate} isPending={generating} isDisabled={generating}>
          <Sparkles className="size-4" aria-hidden /> {card ? "Generate again" : "Generate the card"}
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {card ? (
          <motion.div key={card.card_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <p className="mt-3 font-serif text-3xl font-semibold tracking-tight">{conceptLabel(card.concept)}</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-serif text-5xl font-semibold tabular-nums text-margin-red sm:text-6xl">
                <ApiNumber value={card.percent_struggling} suffix="%" />
              </span>
              <span className="text-sm text-muted">
                of the class struggled with it
                <br />
                {card.students_struggling} of {card.total_students} students
              </span>
            </p>
            {/* A stored card is a snapshot. When more students have started since, its percent no longer matches the heatmap beside it, and the page says why instead of showing two numbers that seem to disagree. */}
            {card.total_students !== classSize ? (
              <Chip size="sm" variant="soft" color="warning" className="mt-2">
                {classSize} students now. Generate again to update.
              </Chip>
            ) : null}
            <p className="mt-4 font-serif text-lg leading-7">{card.reteach_note}</p>
            <h3 className="mt-4 text-sm font-semibold">Three practice problems</h3>
            <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-sm leading-6">
              {card.practice_problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-muted">
              <span className="mr-1.5 inline-flex items-center gap-1 rounded-full bg-margin-green-soft px-2 py-0.5 font-medium text-margin-green">
                <span aria-hidden className="size-1.5 rounded-full bg-margin-green" /> Live
              </span>
              Updated <time dateTime={card.generated_at}>{new Date(card.generated_at).toLocaleString()}</time>.
            </p>
          </motion.div>
        ) : (
          <motion.p key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 text-muted">
            No card yet.
          </motion.p>
        )}
      </AnimatePresence>

      {note ? (
        <Alert status="warning" className="mt-4">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{note}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
    </Paper>
  );
}

/**
 * Concepts against struggle rate. A CSS grid, with no chart library.
 *
 * One row per concept, in the professor's own order, so rows never reshuffle
 * between visits. The bar and the percent are `percent_struggling` from the
 * API. The four small cells are turn counts per kind of struggle. Their tint
 * is only a way to see the larger count at a glance. The count itself is
 * always printed in the cell, so the tint carries no information on its own.
 */
function Heatmap({ summary }: { summary: ClassSummary }) {
  const worst = summary.concepts.reduce<ConceptSummary | null>(
    (best, c) => (c.students_struggling > 0 && (!best || c.percent_struggling > best.percent_struggling) ? c : best),
    null,
  );
  return (
    <Card aria-label="Concepts against struggle rate">
      <Card.Header>
        <Card.Title>Where the class is stuck</Card.Title>
        <Card.Description>
          {summary.total_students} student{summary.total_students === 1 ? "" : "s"} · {summary.total_turns} turn
          {summary.total_turns === 1 ? "" : "s"}
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="flex flex-col gap-4">
          {summary.concepts.map((c) => (
            <ConceptRow key={c.concept} concept={c} total={summary.total_students} isWorst={worst?.concept === c.concept} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted">
          <span>Small cells are turns by kind:</span>
          {STRUGGLE_COLUMNS.map((t, i) => (
            <span key={t}>
              {i + 1}. {STRUGGLE_LABEL[t]}
            </span>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}

function ConceptRow({ concept, total, isWorst }: { concept: ConceptSummary; total: number; isWorst: boolean }) {
  const most = Math.max(1, ...STRUGGLE_COLUMNS.map((t) => concept.struggle_types[t]));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5">
      <Meter
        value={concept.percent_struggling}
        color={isWorst ? "danger" : concept.percent_struggling > 0 ? "warning" : "default"}
        aria-label={`${conceptLabel(concept.concept)}: ${concept.percent_struggling} percent struggling`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <Label className="flex items-center gap-2">
            {conceptLabel(concept.concept)}
            {isWorst ? (
              <Chip size="sm" variant="soft" color="danger">
                weakest
              </Chip>
            ) : null}
          </Label>
          <span className="text-sm tabular-nums">
            <span className={cn("font-semibold", isWorst && "text-margin-red")}>
              <ApiNumber value={concept.percent_struggling} suffix="%" />
            </span>{" "}
            <span className="text-muted">
              · {concept.students_struggling} of {total}
            </span>
          </span>
        </div>
        <Meter.Track>
          <Meter.Fill />
        </Meter.Track>
      </Meter>
      <div className="flex gap-1" role="group" aria-label={`Turns by kind of struggle for ${conceptLabel(concept.concept)}`}>
        {STRUGGLE_COLUMNS.map((t, i) => {
          const n = concept.struggle_types[t];
          return (
            <span
              key={t}
              title={`${STRUGGLE_LABEL[t]}: ${n} turn${n === 1 ? "" : "s"}`}
              aria-label={`${STRUGGLE_LABEL[t]}: ${n} turn${n === 1 ? "" : "s"}`}
              className="relative flex size-8 items-center justify-center overflow-hidden rounded-md border border-border text-xs tabular-nums"
            >
              <span aria-hidden className="absolute inset-0 bg-margin-red" style={{ opacity: n === 0 ? 0 : 0.12 + 0.38 * (n / most) }} />
              <span className="relative">
                <span className="sr-only">{i + 1}. </span>
                {n}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What the guard did for this class, as three counts from the roster route.
 *
 * It answers "can students jailbreak it" with this class's own record. The
 * counts are for the class as a whole. There is no per-student version, on
 * purpose: an integrity count beside a name would turn the dashboard into the
 * surveillance tool it says it is not.
 */
function GuardStrip({ roster }: { roster: Roster }) {
  const { answer_requests, drafts_held, replies } = roster.guard;
  return (
    <Card aria-label="What the guard did">
      <Card.Content className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4 text-margin-green" aria-hidden /> The guard, for this class
        </p>
        <Stat value={replies} label={`hint${replies === 1 ? "" : "s"} checked`} />
        <Stat value={answer_requests} label={`request${answer_requests === 1 ? "" : "s"} for the answer`} />
        <Stat value={drafts_held} label={`draft${drafts_held === 1 ? "" : "s"} held`} />
        <p className="basis-full text-xs text-muted">Whole class. Harder to beat, not impossible.</p>
      </Card.Content>
    </Card>
  );
}

/**
 * How long this assignment takes the class, as two numbers the roster route computed.
 *
 * The time to finish counts only students who finished, so a student halfway
 * through does not make the assignment look short. It is the class's number,
 * shown to size the assignment, not to compare people; the per-student
 * averages sit on each student's card, in start order, never sorted by speed.
 */
function ClassTime({ roster }: { roster: Roster }) {
  const { finished_students, average_total_seconds, average_seconds_per_question } = roster.timing;
  return (
    <Card aria-label="How long this assignment takes">
      <Card.Content className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Clock className="size-4 text-muted" aria-hidden /> Time, for this class
        </p>
        <TimeStat seconds={average_total_seconds} label={`average time to finish (${finished_students} finished)`} />
        <TimeStat seconds={average_seconds_per_question} label="average per question" />
        <p className="basis-full text-xs text-muted">From opening a question to pressing Next. Students are told their time is shared.</p>
      </Card.Content>
    </Card>
  );
}

/** One time figure. A dash until the server has a finished question to average. */
function TimeStat({ seconds, label }: { seconds: number | null; label: string }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="font-serif text-2xl font-semibold tabular-nums">{seconds === null ? "–" : duration(seconds)}</span>
      <span className="max-w-[14rem] text-xs leading-4 text-muted">{label}</span>
    </p>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="font-serif text-2xl font-semibold tabular-nums">
        <ApiNumber value={value} />
      </span>
      <span className="max-w-[14rem] text-xs leading-4 text-muted">{label}</span>
    </p>
  );
}

/**
 * One student's turns, read from our database when the drawer opens.
 *
 * No model is called to show this, so a drill-down is not a second send of
 * the student's work. The guard's outcome on a reply is shown as severity and
 * layer. Its reason is not in the response, because a reason can describe the
 * solution.
 */
function TranscriptDrawer({
  student,
  assignmentId,
  onClose,
}: {
  student: StudentSummary | null;
  assignmentId: string;
  onClose: () => void;
}) {
  // The loaded transcript is kept with the id it was loaded for. A transcript whose id is not the open student's is treated as not loaded, so opening a second student can never show the first student's turns for a moment while the request is out.
  const [loadedTranscript, setLoadedTranscript] = useState<Transcript | null>(null);
  const studentId = student?.student_id ?? null;
  const transcript = loadedTranscript && loadedTranscript.student_id === studentId ? loadedTranscript : null;

  useEffect(() => {
    if (!studentId) return;
    let live = true;
    api
      .transcript(studentId, assignmentId)
      .then((t) => live && setLoadedTranscript(t))
      .catch(() => live && setLoadedTranscript({ student_id: studentId, display_name: "", questions: [], turns: [], reflection: null }));
    return () => {
      live = false;
    };
  }, [studentId, assignmentId]);

  return (
    <Drawer>
      <Drawer.Backdrop isOpen={student !== null} onOpenChange={(open) => !open && onClose()} variant="blur">
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-full sm:max-w-2xl" aria-label="Student work by question">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>{student?.display_name}</Drawer.Heading>
              <p className="text-xs text-muted">This assignment only. Each question with the time it took and the turns on it, then the look-back answers.</p>
            </Drawer.Header>
            <Drawer.Body>
              {!transcript ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Spinner size="sm" /> Loading work
                </div>
              ) : transcript.questions.length === 0 ? (
                <p className="text-sm text-muted">Nothing to show.</p>
              ) : (
                <WorkByQuestion transcript={transcript} />
              )}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

/**
 * A student's work, one section per question: the prompt, the time on it, and
 * the turns on it in order. Every question is listed, including ones with no
 * turns, because "finished in 40 seconds without asking anything" is part of
 * the picture. Turns the server could not place (a session older than the
 * clock) are listed last under their own heading rather than guessed into a
 * question.
 */
function WorkByQuestion({ transcript }: { transcript: Transcript }) {
  const unplaced = transcript.turns.filter((t) => t.question_index === null);
  return (
    <div className="flex flex-col gap-6">
      {transcript.questions.map((q) => {
        const turns = transcript.turns.filter((t) => t.question_index === q.index);
        return (
          <section key={q.index} aria-labelledby={`work-q${q.index}`} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 id={`work-q${q.index}`} className="font-semibold">
                Question {q.index + 1}
              </h3>
              <Chip size="sm" variant="soft">
                <span className="tabular-nums">{q.seconds === null ? "not finished" : duration(q.seconds)}</span>
              </Chip>
              <span className="text-xs text-muted">
                {turns.length === 0 ? "no messages" : `${turns.filter((t) => t.role === "student").length} from the student`}
              </span>
            </div>
            {/* The question as the student saw it: Markdown with formulas typeset. */}
            <div className="text-sm text-muted">
              <RichReply text={q.prompt} />
            </div>
            {turns.length > 0 ? <TurnList turns={turns} /> : null}
          </section>
        );
      })}
      {unplaced.length > 0 ? (
        <section aria-labelledby="work-unplaced" className="flex flex-col gap-2">
          <h3 id="work-unplaced" className="font-semibold">
            Not tied to a question
          </h3>
          <TurnList turns={unplaced} />
        </section>
      ) : null}
      <LookBack reflection={transcript.reflection} questionCount={transcript.questions.length} />
    </div>
  );
}

/**
 * The student's two look-back answers, after their last question.
 *
 * They used to be a separate list at the bottom of the dashboard with no way
 * to find one student. Here they sit at the end of that student's work, which
 * the name search already reaches. A student who has not finished has none
 * yet, and the section says so rather than disappearing.
 */
function LookBack({ reflection, questionCount }: { reflection: Transcript["reflection"]; questionCount: number }) {
  return (
    <section aria-labelledby="work-lookback" className="flex flex-col gap-3 border-t border-border pt-5">
      <h3 id="work-lookback" className="flex items-center gap-2 font-semibold">
        <MessageCircleQuestion className="size-4 text-margin-red" aria-hidden /> Look-back answers
      </h3>
      {!reflection ? (
        <p className="text-sm text-muted">Written after the last question. This student has not finished yet.</p>
      ) : (
        <dl className="flex flex-col gap-4">
          <LookBackAnswer question={reflection.why} answer={reflection.answers.why} />
          <LookBackAnswer question={`${questionCount > 1 ? `Question ${reflection.what_if_index + 1}. ` : ""}${reflection.what_if}`} answer={reflection.answers.what_if} />
        </dl>
      )}
    </section>
  );
}

/** One look-back question and the student's answer, as plain text. */
function LookBackAnswer({ question, answer }: { question: string; answer: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{question}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap font-serif text-[17px] leading-7">{answer || <span className="text-muted">No answer.</span>}</dd>
    </div>
  );
}

/** Turns in order, each with who wrote it, the level, the scribe's label, whether the guard held a draft, whether the canvas was shared, and the tools Askretes called. */
function TurnList({ turns }: { turns: TranscriptTurn[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {turns.map((t, i) => (
        <li key={i} className={cn("rounded-lg border px-3 py-2.5", t.role === "tutor" ? "border-margin-red/40 bg-margin-red-soft" : "border-border")}>
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide">{t.role === "tutor" ? "Askretes" : "Student"}</span>
            {t.role === "tutor" && t.hint_level ? (
              <Chip size="sm" variant="soft">level {t.hint_level}</Chip>
            ) : null}
            {t.label ? (
              <>
                <Chip size="sm" variant="soft" color="accent">{conceptLabel(t.label.concept)}</Chip>
                <Chip size="sm" variant="soft" color={t.label.struggle_type === "none" ? "default" : "warning"}>
                  {STRUGGLE_LABEL[t.label.struggle_type]}
                </Chip>
              </>
            ) : null}
            {t.guard && (t.guard.leaks || t.retries > 0) ? (
              <Chip size="sm" variant="soft" color="danger">
                draft held · {t.guard.severity}
              </Chip>
            ) : null}
            {/* The student shared their canvas with Askretes on this turn. The picture itself was not stored. */}
            {t.canvas?.shared ? (
              <Chip size="sm" variant="soft">
                {t.canvas.picture ? "shared canvas picture" : "canvas listed"}
              </Chip>
            ) : null}
          </div>
          {/* Askretes' reply is shown as the student read it, formulas typeset; the student's own words stay plain text. */}
          {/* Both sides are shown formatted: Askretes' reply, and the student's message, which is often pasted Markdown with code fences. */}
          <div className={cn("text-sm leading-6", t.role === "tutor" && "font-serif text-base")}>
            <RichReply text={t.content} />
          </div>
          {/* Files the student attached: names only, since the contents were not stored. */}
          {t.attachments?.length ? (
            <p className="mt-1.5 flex flex-wrap gap-1.5">
              {t.attachments.map((f, j) =>
                f.id ? (
                  <OpenFileChip key={j} file={{ name: f.name, key: `prof|${t.message_id ?? t.session_id}|${f.id}`, url: attachmentUrl(t.session_id, f.id) }} />
                ) : (
                  <Chip key={j} size="sm" variant="soft">
                    {f.name}
                  </Chip>
                ),
              )}
            </p>
          ) : null}
          {/* The canvas: on a student turn, the exact picture Askretes was shown; on a tutor turn, the board after Askretes' marks, drawn from the stored shapes and pictures. */}
          {t.role === "student" && t.canvas_picture && t.message_id ? (
            <figure className="mt-2 overflow-hidden rounded-lg border border-border bg-surface">
              {/* Served from the server's store; next/image would need a remote pattern for the API host. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={canvasPictureUrl(t.session_id, t.message_id)} alt="The canvas the student shared with Askretes" className="max-h-80 w-full object-contain" loading="lazy" />
              <figcaption className="border-t border-border px-2.5 py-1.5 text-xs text-muted">The canvas the student shared with Askretes</figcaption>
            </figure>
          ) : t.board?.length ? (
            <BoardPreview
              board={t.board}
              files={t.message_id ? (t.board_files ?? []).map((id) => ({ id, url: boardFileUrl(t.session_id, t.message_id!, id) })) : []}
              caption={t.role === "tutor" ? "The canvas after Askretes' marks" : "The canvas the student shared"}
            />
          ) : null}
          {t.tool_calls?.length ? <ToolCalls calls={t.tool_calls} /> : null}
        </li>
      ))}
    </ol>
  );
}

/** The state before there is anything true to draw: one sentence, and the one step that changes it. There is no button here that fills in a class. */
function EmptyClass({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) {
  return (
    <Paper as="div" className="mx-auto w-full max-w-2xl py-10" aria-label={title}>
      <h2 className="font-serif text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 max-w-prose text-muted">{text}</p>
      <Button variant="primary" className="mt-5" onPress={onAction}>
        {action} <ArrowRight className="size-4" aria-hidden />
      </Button>
    </Paper>
  );
}
