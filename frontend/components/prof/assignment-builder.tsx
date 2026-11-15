"use client";

import { Alert, Button, Chip, Input, Label, Switch, TextArea, TextField } from "@heroui/react";
import { Check, FileUp, KeyRound, ListOrdered, PenLine, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { fileToBase64 } from "@/components/workspace/attachments";
import { Markdown } from "@/components/workspace/markdown";
import { api, ApiError, conceptLabel, type AssignmentDraft, type AssignmentSource } from "@/lib/api";
import { cn } from "@/lib/utils";

/** What a source box accepts. The server decides by the bytes; this only steers the picker. */
const SOURCE_ACCEPT = ".pdf,.doc,.docx,.pptx,.xlsx,.csv,.md,.markdown,.txt,.tex,.png,.jpg,.jpeg,.webp,.gif,.zip";

type SourceState = { mode: "file"; file: File | null } | { mode: "text"; text: string };

/**
 * Making (or replacing) an assignment's questions and key, leniently.
 *
 * Each side, the questions and the answer key, is either a file of almost any
 * kind (a PDF, Word, PowerPoint, Excel or CSV, Markdown or text, a photo of
 * handwriting, or a zip) or text the professor types or pastes, with
 * mathematics in LaTeX. The answer key may be left out; the preview then says
 * which questions have no key, because the guard cannot hold back an answer it
 * was never given.
 *
 * "Read" sends the questions, then the key, and shows every question as
 * students will see it, typeset. The professor can correct any question's
 * wording right there before saving. Answers are never sent back: the preview
 * only says whether each question has one.
 */
export function AssignmentBuilder({
  courseId,
  courseName,
  initial,
  fromChat,
  onSaved,
}: {
  courseId: string;
  courseName: string;
  /** An existing assignment to edit: its title, due date, and switch. Its questions are replaced only if new ones are read. */
  initial?: { id: string; title: string; due_at: string | null; margin_enabled: boolean; has_questions: boolean } | null;
  /** A draft the class chat made (components/prof/class-chat.tsx): the builder opens on its preview, title, and due date, ready to review and post. */
  fromChat?: { draft: AssignmentDraft; title: string; due_at: string | null } | null;
  onSaved: (assignmentId: string) => void;
}) {
  const [title, setTitle] = useState(fromChat?.title ?? initial?.title ?? "");
  const due = fromChat?.due_at ?? initial?.due_at ?? null;
  const [dueAt, setDueAt] = useState(due && !Number.isNaN(Date.parse(due)) ? toLocalInput(due) : "");
  const [marginOn, setMarginOn] = useState(initial?.margin_enabled ?? true);
  const [questions, setQuestions] = useState<SourceState>({ mode: "file", file: null });
  const [answers, setAnswers] = useState<SourceState>({ mode: "file", file: null });
  const [draft, setDraft] = useState<AssignmentDraft | null>(fromChat?.draft ?? null);
  const [edited, setEdited] = useState<string[]>(fromChat?.draft.questions.map((q) => q.prompt) ?? []);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const hasQuestions = questions.mode === "file" ? !!questions.file : questions.text.trim().length > 0;
  const hasAnswers = answers.mode === "file" ? !!answers.file : answers.text.trim().length > 0;

  async function asSource(s: SourceState): Promise<AssignmentSource> {
    if (s.mode === "text") return { text: s.text };
    const file = s.file as File;
    return { file: { name: file.name, base64: await fileToBase64(file) } };
  }

  async function read() {
    if (!hasQuestions) return;
    setReading(true);
    setError(null);
    setDone(false);
    try {
      const opened = await api.draftFromSource(courseId, await asSource(questions));
      const preview = await api.readDraft(opened.draft_id, hasAnswers ? await asSource(answers) : undefined);
      setDraft(preview);
      setEdited(preview.questions.map((q) => q.prompt));
    } catch (e) {
      setError(e instanceof ApiError && e.detail ? e.detail : e instanceof ApiError && e.code === "read_failed" ? "Askretes could not split these into questions. Check the numbering, or type them in." : "Could not read these. Try again.");
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!title.trim()) {
      setError("Give the assignment a title.");
      return;
    }
    if (!draft && !initial?.has_questions) {
      setError("Add the questions and press Read first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const base = { title: title.trim(), due_at: dueAt ? new Date(dueAt).toISOString() : null, margin_enabled: marginOn, ...(draft ? { draft_id: draft.draft_id, questions: edited } : {}) };
      const result = initial ? await api.editPdfAssignment(initial.id, base) : await api.createPdfAssignment(courseId, base as typeof base & { draft_id: string });
      setDraft(null);
      setDone(true);
      onSaved(result._id);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "pdfs_required" ? "Read the questions again before saving." : "Not saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <TextField value={title} onChange={setTitle} isRequired fullWidth>
          <Label>Title</Label>
          <Input placeholder="Problem Set 4: Gauss's law" maxLength={200} />
        </TextField>
        <TextField value={dueAt} onChange={setDueAt}>
          <Label>Due</Label>
          <Input type="datetime-local" />
        </TextField>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SourceBox
          icon={<ListOrdered className="size-4" aria-hidden />}
          title="Questions"
          hint="What students see. Upload any file, or type them."
          placeholder={"1. A charge $q = 2\\,\\mu C$ sits at the origin. Find $E$ at $r = 3\\,m$.\n2. ..."}
          value={questions}
          onChange={(v) => {
            setQuestions(v);
            setDraft(null);
          }}
        />
        <SourceBox
          icon={<KeyRound className="size-4" aria-hidden />}
          title="Answer key"
          hint="Only the guard reads it. Optional, but without it Askretes cannot hold the answers back."
          placeholder={"1. $E = 2.0 \\times 10^3\\,N/C$\n2. ..."}
          optional
          value={answers}
          onChange={(v) => {
            setAnswers(v);
            setDraft(null);
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onPress={() => void read()} isPending={reading} isDisabled={reading || !hasQuestions}>
          {reading ? null : <FileUp className="size-4" aria-hidden />} {reading ? "Reading…" : draft ? "Read again" : "Read questions"}
        </Button>
        <span className="text-sm text-muted">Handwriting and scans are transcribed. Math comes out as LaTeX.</span>
      </div>

      {draft ? (
        <section aria-labelledby="builder-preview" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="builder-preview" className="font-serif text-xl font-semibold">
              {draft.questions.length} {draft.questions.length === 1 ? "question" : "questions"}
            </h3>
            <Chip size="sm" variant="soft">
              {draft.kind}
            </Chip>
            {draft.concepts.map((c) => (
              <Chip key={c} size="sm" variant="soft" color="accent">
                {conceptLabel(c)}
              </Chip>
            ))}
          </div>
          {draft.missing_answers ? (
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  {draft.missing_answers === draft.questions.length ? "No answer key was found." : `${draft.missing_answers} of ${draft.questions.length} questions have no answer in the key.`} Askretes will still tutor, but cannot check its hints against an answer for those.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <ol className="flex flex-col gap-3">
            {draft.questions.map((q, i) => (
              <QuestionEditor key={i} index={i} text={edited[i] ?? q.prompt} hasAnswer={q.has_answer} onChange={(t) => setEdited((prev) => prev.map((x, j) => (j === i ? t : x)))} />
            ))}
          </ol>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
        <Switch isSelected={marginOn} onChange={setMarginOn}>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label className="text-sm">Askretes tutors this assignment</Label>
          </Switch.Content>
        </Switch>
        <span className="ml-auto" />
        {done ? (
          <span className="flex items-center gap-1 text-sm text-margin-green">
            <Check className="size-4" aria-hidden /> Saved to {courseName}
          </span>
        ) : null}
        <Button variant="primary" onPress={() => void save()} isPending={saving} isDisabled={saving || (!draft && !initial?.has_questions) || !title.trim()}>
          {initial ? "Save changes" : "Post assignment"}
        </Button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}

/**
 * One side of the assignment: a drop zone for a file, or a box to type in, switched by two small buttons. Typed text shows a live typeset preview, so a professor writing LaTeX sees the formula as students will.
 */
function SourceBox({
  icon,
  title,
  hint,
  placeholder,
  optional = false,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  placeholder: string;
  optional?: boolean;
  value: SourceState;
  onChange: (v: SourceState) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">{icon}</span>
        <h3 className="whitespace-nowrap font-medium">{title}</h3>
        {optional ? <span className="text-xs text-muted">optional</span> : null}
        <span className="ml-auto flex gap-0.5 rounded-lg bg-default/60 p-0.5">
          <Button size="sm" variant={value.mode === "file" ? "secondary" : "ghost"} className="h-7 px-2 text-xs" aria-pressed={value.mode === "file"} onPress={() => onChange({ mode: "file", file: null })}>
            <Upload className="size-3.5" aria-hidden /> Upload
          </Button>
          <Button size="sm" variant={value.mode === "text" ? "secondary" : "ghost"} className="h-7 px-2 text-xs" aria-pressed={value.mode === "text"} onPress={() => onChange({ mode: "text", text: "" })}>
            <PenLine className="size-3.5" aria-hidden /> Type
          </Button>
        </span>
      </div>
      <p className="text-xs text-muted">{hint}</p>
      {value.mode === "file" ? (
        <div
          className={cn("flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors", over ? "border-margin-red bg-margin-red-soft" : "border-border")}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) onChange({ mode: "file", file: f });
          }}
        >
          {value.file ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="max-w-56 truncate font-medium">{value.file.name}</span>
              <Button isIconOnly size="sm" variant="ghost" aria-label={`Remove ${value.file.name}`} onPress={() => onChange({ mode: "file", file: null })}>
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm">Drop a file here</p>
              <p className="text-xs text-muted">PDF, Word, PowerPoint, Excel, CSV, Markdown, text, a photo of handwriting, or a zip</p>
            </>
          )}
          <Button size="sm" variant="ghost" onPress={() => input.current?.click()}>
            {value.file ? "Choose another" : "Choose a file"}
          </Button>
          <input
            ref={input}
            type="file"
            accept={SOURCE_ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onChange({ mode: "file", file: f });
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <TextField value={value.text} onChange={(text) => onChange({ mode: "text", text })} fullWidth aria-label={title}>
            <TextArea rows={7} placeholder={placeholder} className="font-mono text-[13px] leading-6" />
          </TextField>
          {value.text.trim() ? (
            <div className="max-h-48 overflow-y-auto rounded-xl border border-border bg-paper px-3 py-2 font-serif text-[15px] leading-6">
              <Markdown text={value.text.replace(/\n/g, "  \n")} />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** One question in the preview: typeset as students will see it, with an Edit button that turns it into a box, and whether its answer was found. */
function QuestionEditor({ index, text, hasAnswer, onChange }: { index: number; text: string; hasAnswer: boolean; onChange: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        <span className="font-medium text-muted">Question {index + 1}</span>
        <Chip size="sm" variant="soft" color={hasAnswer ? "success" : "warning"}>
          {hasAnswer ? "answer found" : "no answer"}
        </Chip>
        <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onPress={() => setEditing(!editing)}>
          {editing ? "Done" : "Edit"}
        </Button>
      </div>
      {editing ? (
        <TextField value={text} onChange={onChange} fullWidth aria-label={`Question ${index + 1}`}>
          <TextArea rows={4} className="font-mono text-[13px] leading-6" />
        </TextField>
      ) : (
        <div className="font-serif text-[16px] leading-7">
          <Markdown text={text.replace(/\n/g, "  \n")} />
        </div>
      )}
    </li>
  );
}

/** An ISO time as the value a datetime-local input takes, in the viewer's time zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
