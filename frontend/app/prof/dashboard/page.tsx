"use client";

import { Alert, Button, Card, Chip, Drawer, Label, Meter, Spinner } from "@heroui/react";
import { ArrowRight, Clock, MessageSquareText, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiNumber } from "@/components/api-number";
import { Paper } from "@/components/paper";
import { duration, TimingsPanel } from "@/components/prof/timings-panel";
import { useAssignment } from "@/components/prof/use-assignment";
import {
  api,
  ApiError,
  conceptLabel,
  STRUGGLE_LABEL,
  type ClassSummary,
  type ConceptSummary,
  type Roster,
  type StruggleType,
  type StudentSummary,
  type ThursdayCard,
  type Transcript,
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
export default function DashboardPage() {
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

  // Bumped by the refresh button. The effect below re-reads the three routes whenever it changes.
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!assignmentId) return;
    let live = true;
    Promise.all([
      api.classSummary(assignmentId),
      api.roster(assignmentId),
      // 404 `no_card_yet` is the ordinary state before the first generate, not an error.
      api.thursdayCard(assignmentId).catch(() => null),
    ])
      .then(([s, r, c]) => {
        if (!live) return;
        setFailed(false);
        setSummary(s);
        setRoster(r);
        setCard(c);
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [assignmentId, version]);

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

  if (pick.state === "loading" || (assignmentId && !loaded)) {
    return (
      <div className="flex items-center justify-center gap-2 pt-24 text-muted">
        <Spinner aria-label="Opening the dashboard" />
      </div>
    );
  }
  if (pick.state === "error" || failed) {
    return (
      <Alert status="danger" className="mx-auto mt-10 max-w-xl">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>{pick.state === "error" ? pick.message : "The dashboard could not be loaded."}</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }
  if (pick.state === "none" || !summary || !roster || !assignmentId) {
    return (
      <EmptyClass
        title="No assignment yet"
        text="Create one, then have a student start a session."
        action="Create an assignment"
        onAction={() => router.push("/prof/setup")}
      />
    );
  }

  const title = pick.state === "ready" ? pick.assignments.find((a) => a.id === assignmentId)?.title : "";

  // Nobody has started a session. The heatmap would be a grid of zeros that reads as broken, so the page says what has not happened yet instead.
  if (summary.total_students === 0) {
    return (
      <div className="flex flex-col gap-5">
        <Header title={title ?? ""} onRefresh={refresh} />
        <Picker pick={pick} />
        <EmptyClass
          title="The class has not studied yet"
          text="Nobody has started a session yet."
          action="Open the student page"
          onAction={() => router.push(`/student/assignment/${assignmentId}`)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Header title={title ?? ""} onRefresh={refresh} />
        <Picker pick={pick} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ThursdayCardPanel card={card} classSize={summary.total_students} generating={generating} note={cardNote} onGenerate={generate} />
        <Heatmap summary={summary} />
      </div>

      <GuardStrip roster={roster} />
      <ClassTime roster={roster} />

      <Card aria-label="Students">
        <Card.Header>
          <Card.Title>Students</Card.Title>
          <Card.Description>
            In the order they started. Not ranked, not graded.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roster.students.map((s) => (
              <li key={s.student_id}>
                <StudentLines student={s} onOpen={() => setOpenStudent(s)} />
              </li>
            ))}
          </ul>
        </Card.Content>
      </Card>

      <TimingsPanel assignmentId={assignmentId} version={version} />

      <TranscriptDrawer student={openStudent} assignmentId={assignmentId} onClose={() => setOpenStudent(null)} />
    </div>
  );
}

/**
 * Which assignment the dashboard is showing.
 * One button per saved assignment, with its class. Choosing one re-reads the summary, the students, and the stored card for it. This only switches what is read. It is not a gradebook or a course switcher with settings behind it.
 */
function Picker({ pick }: { pick: ReturnType<typeof useAssignment> }) {
  if (pick.state !== "ready" || pick.assignments.length < 2) return null;
  return (
    <div className="-mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Assignment">
      {pick.assignments.map((a) => (
        <Button key={a.id} size="sm" variant={a.id === pick.assignmentId ? "secondary" : "ghost"} aria-pressed={a.id === pick.assignmentId} onPress={() => pick.choose(a.id)}>
          {a.title}
        </Button>
      ))}
    </div>
  );
}

function Header({ title, onRefresh }: { title: string; onRefresh: () => void }) {
  return (
    <Paper as="div" aria-label="Dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Class view · formative, never a grade</p>
          <h1 className="mt-1 truncate font-serif text-3xl font-semibold tracking-tight">{title}</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onPress={onRefresh}>
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
          <NextLink href="/prof/messages" className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm text-muted hover:bg-default hover:text-foreground">
            <MessageSquareText className="size-4" aria-hidden /> Messages
          </NextLink>
        </div>
      </div>
    </Paper>
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
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-margin-red">Reteach on Thursday</h2>
        <Button size="sm" variant={card ? "ghost" : "primary"} onPress={onGenerate} isPending={generating} isDisabled={generating}>
          <Sparkles className="size-4" aria-hidden /> {card ? "Generate again" : "Generate the card"}
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {card ? (
          <motion.div key={card.card_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <p className="mt-3 font-serif text-3xl font-semibold tracking-tight">{conceptLabel(card.concept)}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="font-serif text-6xl font-semibold tabular-nums text-margin-red">
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
              <time dateTime={card.generated_at}>{new Date(card.generated_at).toLocaleString()}</time>. Numbers counted in code. Also sent as a{" "}
              <NextLink href="/prof/messages" className="underline underline-offset-2">
                message
              </NextLink>
              .
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
 * One student's three lines, their average time per question, and the button that opens their work.
 * The whole summary is plain text and the action is a separate HeroUI button, so the card is not one large click target that a screen reader would announce as a single unlabeled control.
 */
function StudentLines({ student, onOpen }: { student: StudentSummary; onOpen: () => void }) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-lg border border-border px-3.5 py-3">
      <p className="font-medium">{student.display_name}</p>
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-y-1 text-sm">
        <dt className="text-muted">Concept</dt>
        <dd>{student.concept ? conceptLabel(student.concept) : "no turns yet"}</dd>
        <dt className="text-muted">Struggle</dt>
        <dd>{student.concept ? STRUGGLE_LABEL[student.struggle_type] : "no turns yet"}</dd>
        <dt className="text-muted">Last hint</dt>
        <dd>{student.last_hint_level ? `level ${student.last_hint_level}` : "none yet"}</dd>
        <dt className="text-muted">Avg time</dt>
        <dd className="tabular-nums">
          {student.average_seconds === null ? "no question finished" : `${duration(student.average_seconds)} per question · ${student.questions_done} done`}
        </dd>
      </dl>
      {/* Enabled with no turns too: a student who never messaged still has their time on each question to show. */}
      <Button size="sm" variant="ghost" className="mt-auto self-start" onPress={onOpen}>
        Open work <ArrowRight className="size-3.5" aria-hidden />
      </Button>
    </div>
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
      .catch(() => live && setLoadedTranscript({ student_id: studentId, display_name: "", questions: [], turns: [] }));
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
              <p className="text-xs text-muted">This assignment only. Each question with the time it took and the turns on it.</p>
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
            <p className="text-sm text-muted">{q.prompt}</p>
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
    </div>
  );
}

/** Turns in order, each with who wrote it, the level, the scribe's label, and whether the guard held a draft. */
function TurnList({ turns }: { turns: TranscriptTurn[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {turns.map((t, i) => (
        <li key={i} className={cn("rounded-lg border px-3 py-2.5", t.role === "tutor" ? "border-margin-red/40 bg-margin-red-soft" : "border-border")}>
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide">{t.role === "tutor" ? "Margin" : "Student"}</span>
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
          </div>
          <p className={cn("whitespace-pre-wrap text-sm leading-6", t.role === "tutor" && "font-serif text-base")}>{t.content}</p>
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
