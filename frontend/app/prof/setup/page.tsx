"use client";

import { Alert, Breadcrumbs, Button, Card, Chip, Description, Input, Label, Spinner, Switch, TextField } from "@heroui/react";
import { Check, FileText, Lock, ScanText } from "lucide-react";
import NextLink from "next/link";
import { useEffect, useRef, useState } from "react";
import { Paper } from "@/components/paper";
import { api, ApiError, conceptLabel, MAX_PDF_BYTES, type Assignment, type AssignmentDraft, type ProfCourseCard } from "@/lib/api";
import { browser } from "@/lib/browser";

/** An ISO time as a date-time field's value, in local time, to the minute. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The words for a failed read, by the server's error. */
function readError(e: unknown): string {
  const code = e instanceof ApiError ? e.code : "";
  if (code === "not_a_pdf") return "Both files must be PDFs.";
  if (code === "no_text") return "A PDF has no readable text (a scanned page cannot be read). Export it from the original document instead.";
  if (code === "unreadable_pdf") return "A PDF could not be opened.";
  if (code === "read_failed") return "Margin could not split the PDFs into questions and answers. Try again, or check that the answer key is numbered like the questions.";
  if (e instanceof ApiError && e.status === 413) return "A PDF is over 20 MB.";
  return "The PDFs were not read. Try again.";
}

/**
 * Making or editing one assignment, inside a class.
 *
 * The professor arrives from a class page, so the class is in the URL
 * (`?course_id=`) and is never typed. The form is five things: a title, the
 * Question PDF, the Answer key PDF, a due date, and whether Margin is on.
 *
 * "Read PDFs" uploads both files. The server splits them into questions,
 * matches each answer, and picks the kind and the concepts, and the page
 * shows the questions it found with a mark for each answer it matched. It
 * never shows an answer: the keys stay on the server and only the guard
 * reads them. Save then creates the assignment from that reading.
 *
 * Editing (`?assignment=`) changes the title, the due date, and the switch.
 * Reading new PDFs replaces the questions and keys. An assignment made before
 * PDFs (it has no question sheet) cannot be saved until both are read.
 *
 * Every assignment has the full hint ladder; when a student gets more than a
 * nudge is decided by the request rule, after three tries on a question.
 */
export default function SetupPage() {
  const [courses, setCourses] = useState<ProfCourseCard[] | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profProfile, setProfProfile] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [marginOn, setMarginOn] = useState(true);
  const [questionPdf, setQuestionPdf] = useState<File | null>(null);
  const [answerPdf, setAnswerPdf] = useState<File | null>(null);
  const [draft, setDraft] = useState<AssignmentDraft | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const questionRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams(window.location.search);
    const assignmentId = params.get("assignment");
    Promise.all([api.profCourses(), assignmentId ? api.profAssignment(assignmentId) : Promise.resolve(null)])
      .then(([all, a]) => {
        if (!live) return;
        setCourses(all.courses);
        setProfProfile(browser.profProfile());
        // The class comes from the assignment being edited, else ?course_id=, else an older link's ?course=<name>.
        const byName = params.get("course");
        const cid = a?.course_id ?? params.get("course_id") ?? all.courses.find((c) => c.name === byName)?.id ?? null;
        setCourseId(cid && all.courses.some((c) => c.id === cid) ? cid : null);
        if (a) {
          setEditing(a);
          setTitle(a.title);
          setDueAt(toLocalInput(a.due_at));
          setMarginOn(a.margin_enabled !== false);
        }
      })
      .catch(() => live && setLoadError("This page could not be loaded."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const course = courses?.find((c) => c.id === courseId) ?? null;
  const needsPdfs = !editing || !editing.has_question_pdf;

  /** Picks one PDF. A new file throws away a reading of the old pair. */
  function pick(which: "question" | "answer", file: File | undefined) {
    if (!file) return;
    setError(null);
    setSaved(null);
    setDraft(null);
    if (file.size > MAX_PDF_BYTES) {
      setError(`${file.name} is over 20 MB.`);
      return;
    }
    if (which === "question") setQuestionPdf(file);
    else setAnswerPdf(file);
  }

  async function read() {
    if (!courseId || !questionPdf || !answerPdf) return;
    setReading(true);
    setError(null);
    try {
      setDraft(await api.readAssignmentPdfs(courseId, questionPdf, answerPdf));
    } catch (e) {
      setError(readError(e));
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!courseId) return;
    if (!title.trim()) {
      setError("Give the assignment a title.");
      return;
    }
    if (needsPdfs && !draft) {
      setError("Read both PDFs before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const base = { title: title.trim(), due_at: dueAt ? new Date(dueAt).toISOString() : null, margin_enabled: marginOn };
      const result = editing
        ? await api.editPdfAssignment(editing.id, { ...base, ...(draft ? { draft_id: draft.draft_id } : {}) })
        : await api.createPdfAssignment(courseId, { ...base, draft_id: (draft as AssignmentDraft).draft_id });
      browser.setProfAssignmentId(result._id);
      setSaved(result._id);
      // A draft is used once; new PDFs are read again to replace the questions a second time.
      setDraft(null);
      setQuestionPdf(null);
      setAnswerPdf(null);
      setEditing(await api.profAssignment(result._id));
      if (!editing) window.history.replaceState(null, "", `/prof/setup?course_id=${courseId}&assignment=${result._id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "pdfs_required" ? "Upload and read both PDFs before saving this assignment." : "Not saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 pt-24 text-muted">
        <Spinner size="sm" /> Opening setup
      </div>
    );
  }
  if (loadError) {
    return (
      <Alert status="danger" className="mx-auto mt-10 max-w-xl">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>{loadError}</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  // Arrived without a class: an assignment always belongs to one, so pick it first.
  if (!course) {
    const list = (courses ?? []).filter((c) => !profProfile || c.professor === profProfile);
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <h1 className="font-serif text-4xl font-semibold tracking-tight">New assignment</h1>
        <p className="text-muted">Choose the class it belongs to.</p>
        {list.length === 0 ? (
          <p className="text-muted">
            No class yet.{" "}
            <NextLink href="/prof/courses" className="underline underline-offset-2">
              Create one
            </NextLink>
            .
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
            {list.map((c) => (
              <li key={c.id}>
                <NextLink href={`/prof/setup?course_id=${c.id}`} className="block px-4 py-3 hover:bg-default">
                  <span className="text-sm text-muted">{c.code}</span> <span className="font-medium">{c.name}</span>
                </NextLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Breadcrumbs className="flex-wrap">
        <Breadcrumbs.Item href="/prof/courses">Your classes</Breadcrumbs.Item>
        <Breadcrumbs.Item href={`/prof/courses/${course.id}?tab=assignments`}>{course.code || course.name}</Breadcrumbs.Item>
        <Breadcrumbs.Item>{editing ? editing.title : "New assignment"}</Breadcrumbs.Item>
      </Breadcrumbs>

      <Paper as="div" aria-label="Assignment setup">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">{editing ? "Edit assignment" : "New assignment"}</h1>
        <p className="mt-1 text-muted">{course.name}. Students see the questions. Only the guard reads the answer key.</p>
      </Paper>

      <Card>
        <Card.Content>
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <TextField
              value={title}
              onChange={(v) => {
                setTitle(v);
                setSaved(null);
              }}
              isRequired
              fullWidth
              name="title"
            >
              <Label>Title</Label>
              <Input maxLength={200} placeholder="Problem Set 3: Electrostatics" />
            </TextField>

            {/*
              The two PDFs. The pickers are real file inputs, opened by HeroUI
              buttons. Reading them happens on the server; the answer key's text
              never comes back to this page.
            */}
            <section aria-labelledby="pdfs-heading" className="flex flex-col gap-3">
              <h2 id="pdfs-heading" className="text-sm font-medium">
                {editing && editing.has_question_pdf ? "Replace the questions (optional)" : "Questions and answer key"}
              </h2>
              {editing && !editing.has_question_pdf ? (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>This assignment was typed in before PDFs. Upload its Question PDF and Answer key PDF to save it.</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <FilePick label="Question PDF" hint="What students see." file={questionPdf} onPick={() => questionRef.current?.click()} icon={<FileText className="size-4" aria-hidden />} />
                <FilePick label="Answer key PDF" hint="Never shown to students." file={answerPdf} onPick={() => answerRef.current?.click()} icon={<Lock className="size-4" aria-hidden />} />
              </div>
              <input
                ref={questionRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(e) => {
                  pick("question", e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <input
                ref={answerRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(e) => {
                  pick("answer", e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div>
                <Button variant="secondary" isPending={reading} isDisabled={!questionPdf || !answerPdf || reading} onPress={() => void read()}>
                  <ScanText className="size-4" aria-hidden /> Read PDFs
                </Button>
              </div>
              {reading ? (
                <p className="text-sm text-muted" role="status">
                  Reading the questions and matching the answers. This takes a few seconds.
                </p>
              ) : null}
              {draft ? <DraftPreview draft={draft} /> : editing && editing.has_question_pdf ? <CurrentQuestions questions={editing.questions ?? [editing.prompt]} /> : null}
            </section>

            <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
              <TextField
                value={dueAt}
                onChange={(v) => {
                  setDueAt(v);
                  setSaved(null);
                }}
                fullWidth
                name="due_at"
              >
                <Label>Due</Label>
                <Input type="datetime-local" />
                <Description>Leave empty for no due date.</Description>
              </TextField>
              <Switch
                isSelected={marginOn}
                onChange={(on) => {
                  setMarginOn(on);
                  setSaved(null);
                }}
                name="margin_enabled"
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  Margin is on for this assignment
                </Switch.Content>
              </Switch>
            </div>

            {error ? (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            ) : null}
            {saved ? (
              <Alert status="success">
                <Alert.Indicator>
                  <Check className="size-4" />
                </Alert.Indicator>
                <Alert.Content>
                  <Alert.Title>Saved</Alert.Title>
                  <Alert.Description>
                    <NextLink className="underline underline-offset-2" href={`/prof/courses/${course.id}?tab=assignments`}>
                      Back to {course.code || course.name}
                    </NextLink>
                    {" · "}
                    <NextLink className="underline underline-offset-2" href={`/student/assignment/${saved}`}>
                      Open the student page
                    </NextLink>
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : null}

            <div>
              <Button type="submit" variant="primary" isPending={saving} isDisabled={saving || reading || (needsPdfs && !draft)}>
                {editing ? "Save changes" : "Save assignment"}
              </Button>
            </div>
          </form>
        </Card.Content>
      </Card>
    </div>
  );
}

/** One PDF slot: what it is for, the chosen file's name, and the button that opens the picker. */
function FilePick({ label, hint, file, onPick, icon }: { label: string; hint: string; file: File | null; onPick: () => void; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        {icon} {label}
      </p>
      <p className="text-xs text-muted">{hint}</p>
      <p className="truncate text-sm">{file ? file.name : <span className="text-muted">No file chosen</span>}</p>
      <Button size="sm" variant="ghost" onPress={onPick} className="self-start">
        {file ? "Choose another" : "Choose PDF"}
      </Button>
    </div>
  );
}

/** What was read: the questions, a mark for each matched answer, and the concepts the server chose. No answer text exists on this page to show. */
function DraftPreview({ draft }: { draft: AssignmentDraft }) {
  const missing = draft.questions.filter((q) => !q.has_answer).length;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
      <p className="text-sm font-medium">
        {draft.questions.length} {draft.questions.length === 1 ? "question" : "questions"} found
        {missing > 0 ? <span className="text-danger">, {missing} without an answer</span> : ", each with its answer"}
      </p>
      <ol className="flex flex-col gap-2">
        {draft.questions.map((q, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {/* A question copied from the sheet usually starts with its own number; the list does not add a second one. */}
            {/^\s*\d+[.)]/.test(q.prompt) ? null : <span className="text-muted">{i + 1}.</span>}
            <span className="line-clamp-3 flex-1 whitespace-pre-wrap">{q.prompt}</span>
            {q.has_answer ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
                <Check className="size-3.5 text-margin-green" aria-hidden /> answer found
              </span>
            ) : (
              <span className="shrink-0 text-xs text-danger">no answer</span>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">Labelled as</span>
        {draft.concepts.map((c) => (
          <Chip key={c} size="sm" variant="soft">
            {conceptLabel(c)}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** The questions an assignment has now, read-only, when no new PDFs have been read. */
function CurrentQuestions({ questions }: { questions: string[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <p className="text-sm font-medium">Current questions</p>
      <ol className="flex flex-col gap-1.5">
        {questions.map((q, i) => (
          <li key={i} className="flex gap-2 text-sm">
            {/^\s*\d+[.)]/.test(q) ? null : <span className="text-muted">{i + 1}.</span>}
            <span className="line-clamp-2 flex-1 whitespace-pre-wrap">{q}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
