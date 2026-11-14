"use client";

import { Alert, Button, Card, Chip, Description, Input, Label, Radio, RadioGroup, Spinner, TextArea, TextField } from "@heroui/react";
import { ArrowRight, Check, FilePlus2, Lock, Plus, Trash2 } from "lucide-react";
import NextLink from "next/link";
import { useEffect, useState } from "react";
import { Paper } from "@/components/paper";
import { api, ApiError, LEVEL_HELP, LEVEL_NAME, MAX_NOTES_CHARS, MAX_QUESTIONS, type AssignmentKind, type HintLevel } from "@/lib/api";
import { EXAMPLES } from "@/lib/examples";
import { KIND } from "@/lib/kinds";
import { cn } from "@/lib/utils";
import { browser } from "@/lib/browser";

/** The form's fields as the page holds them. Concepts are one per line while typing and become a list when sent. */
type Form = {
  kind: AssignmentKind;
  course_name: string;
  title: string;
  prompt: string;
  answer_key: string;
  notes: string;
  concepts: string;
  hint_ceiling: string;
  /** Questions 2 and on. The prompt and key above are question 1. */
  more: MoreQuestion[];
};

/**
 * One question after the first, as the form holds it.
 * `from` is the place it had when the form loaded a saved assignment (1-based
 * among the later questions). The server uses it to keep that question's
 * stored key when the key field is left empty, so removing question 2 does not
 * hand question 3 the wrong key. A question added on this visit has no `from`
 * and must have its key typed. `uid` is only React's list key.
 */
type MoreQuestion = { uid: number; prompt: string; answer_key: string; from?: number };

let nextUid = 1;

const EMPTY: Form = { kind: "code", course_name: "", title: "", prompt: "", answer_key: "", notes: "", concepts: "", hint_ceiling: "3", more: [] };

/**
 * The professor's setup form: the one way an assignment enters the product.
 *
 * The form starts empty. The demo assignment is typed in by a person, and the
 * placeholders only suggest its shape. Nothing here fills the database on its
 * own, and there is no button that loads a prepared assignment.
 *
 * The answer key travels one way. It is sent in the JSON body of the save
 * request, never in a URL, and it is cleared from this page's state as soon
 * as the save succeeds. No response carries it back, so a reload shows the
 * prompt and the notes and an empty key field. On an edit, leaving that field
 * empty keeps the stored key.
 *
 * The canary is not a field a professor can type. The server stores its own
 * marker beside every key and the guard looks for that exact marker. A canary
 * typed here would be one the guard did not know.
 */
export default function SetupPage() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  // Reload the assignment this browser last saved, without its key.
  useEffect(() => {
    let live = true;
    const stored = browser.profAssignmentId();
    // With nothing stored this resolves to null at once, and the form opens empty.
    // Arriving from a class page with ?course= starts a new item in that class, so the stored assignment is not reloaded.
    const forCourse = new URLSearchParams(window.location.search).get("course");
    Promise.resolve(stored && !forCourse ? api.profAssignment(stored) : null)
      .then((a) => {
        if (!live) return;
        if (forCourse) setForm((f) => ({ ...f, course_name: forCourse }));
        if (!a) return;
        setEditingId(a.id);
        setForm({
          kind: a.kind,
          course_name: a.course_name,
          title: a.title,
          prompt: a.prompt,
          answer_key: "",
          notes: a.notes,
          concepts: a.concepts.join("\n"),
          hint_ceiling: String(a.hint_ceiling),
          // Later questions come back with their prompts and never their keys; `from` keeps each stored key on save.
          more: (a.questions ?? []).slice(1).map((prompt, i) => ({ uid: nextUid++, prompt, answer_key: "", from: i + 1 })),
        });
      })
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const set = (field: Exclude<keyof Form, "more">) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(null);
  };

  /** Changes one field of one later question. */
  const setMore = (uid: number, field: "prompt" | "answer_key") => (value: string) => {
    setForm((f) => ({ ...f, more: f.more.map((m) => (m.uid === uid ? { ...m, [field]: value } : m)) }));
    setSaved(null);
  };

  const concepts = form.concepts
    .split(/[\n,]/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  /** Saves the form. The server validates again. These checks only save a round trip for a field left empty. */
  async function save() {
    const missing: Record<string, string> = {};
    if (!form.course_name.trim()) missing.course_name = "Name the course.";
    if (!form.title.trim()) missing.title = "Give the assignment a title.";
    if (!form.prompt.trim()) missing.prompt = "Write the prompt students will see.";
    if (!editingId && form.kind !== "topic" && !form.answer_key.trim()) missing.answer_key = "The guard needs the answer key to check hints against.";
    if (concepts.length === 0) missing.concepts = "List at least one concept.";
    if (new Set(concepts).size !== concepts.length) missing.concepts = "Each concept can appear once.";
    form.more.forEach((m, i) => {
      if (!m.prompt.trim()) missing[`more.${m.uid}`] = `Write question ${i + 2}, or remove it.`;
      // A question with a stored key (`from`) may leave the field empty to keep it.
      else if (form.kind !== "topic" && !m.answer_key.trim() && m.from === undefined) missing[`more.${m.uid}`] = `Question ${i + 2} needs its answer key.`;
    });
    setIssues(missing);
    if (Object.keys(missing).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      const result = await api.saveAssignment({
        ...(editingId ? { id: editingId } : {}),
        kind: form.kind,
        course_name: form.course_name.trim(),
        title: form.title.trim(),
        prompt: form.prompt.trim(),
        ...(form.answer_key.trim() ? { answer_key: form.answer_key.trim() } : {}),
        notes: form.notes,
        concepts,
        hint_ceiling: Number(form.hint_ceiling),
        questions: form.more.map((m) => ({
          prompt: m.prompt.trim(),
          ...(m.answer_key.trim() ? { answer_key: m.answer_key.trim() } : m.from !== undefined ? { from: m.from } : {}),
        })),
      });
      browser.setProfAssignmentId(result._id);
      setEditingId(result._id);
      // The key leaves the page's memory here. It is on the server now, and nothing sends it back.
      // Every question's key is cleared, and each question now has a stored key at its current place.
      setForm((f) => ({ ...f, answer_key: "", more: f.more.map((m, i) => ({ ...m, answer_key: "", from: i + 1 })) }));
      setSaved(result._id);
    } catch (e) {
      if (e instanceof ApiError && e.issues.length > 0) {
        setIssues(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
        setError("Some fields were not accepted.");
      } else {
        setError("Not saved. Try again.");
      }
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Paper as="div" aria-label="Assignment setup">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight">
              {editingId ? "Edit" : "New"} {form.kind === "topic" ? "topic" : "assignment"}
            </h1>
            <p className="mt-1 text-muted">
              {form.kind === "topic" ? "Material to learn. Margin teaches it from your notes." : "Students see the prompt and the notes. Never the answer key."}
            </p>
          </div>
          {editingId ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                setEditingId(null);
                setForm(EMPTY);
                setSaved(null);
                setIssues({});
              }}
            >
              <FilePlus2 className="size-4" aria-hidden /> New assignment
            </Button>
          ) : null}
        </div>
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
            {/*
              What kind of work this is. The kind decides how the guard reads the key and what the student's work area looks like. A topic has no key at all: it is material to learn, and Margin teaches it openly.
            */}
            <div role="group" aria-label="Kind of assignment" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(KIND) as AssignmentKind[]).map((k) => {
                const Icon = KIND[k].icon;
                const on = form.kind === k;
                return (
                  <Button
                    key={k}
                    variant={on ? "secondary" : "outline"}
                    aria-pressed={on}
                    className={cn("h-auto flex-col items-start gap-1 px-3 py-3 text-left", on && "ring-2 ring-accent")}
                    onPress={() => {
                      setForm((f) => ({ ...f, kind: k }));
                      setSaved(null);
                    }}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <Icon className="size-4" aria-hidden /> {KIND[k].name}
                    </span>
                    <span className="whitespace-normal text-xs font-normal text-muted">{KIND[k].blurb}</span>
                  </Button>
                );
              })}
            </div>

            {/* Examples fill the form and save nothing. The professor still reads, edits, and saves. */}
            {!editingId ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm text-muted">Start from an example</span>
                {EXAMPLES.filter((e) => e.kind === form.kind).map((e) => (
                  <Button
                    key={e.title}
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      setForm({ kind: e.kind, course_name: e.course_name, title: e.title, prompt: e.prompt, answer_key: e.answer_key, notes: e.notes, concepts: e.concepts.join("\n"), hint_ceiling: String(e.hint_ceiling), more: [] });
                      setIssues({});
                    }}
                  >
                    {e.title}
                  </Button>
                ))}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField value={form.course_name} onChange={set("course_name")} isRequired isInvalid={!!issues.course_name} fullWidth name="course_name">
                <Label>Course</Label>
                <Input />
                {issues.course_name ? <FieldNote>{issues.course_name}</FieldNote> : null}
              </TextField>
              <TextField value={form.title} onChange={set("title")} isRequired isInvalid={!!issues.title} fullWidth name="title">
                <Label>Title</Label>
                <Input />
                {issues.title ? <FieldNote>{issues.title}</FieldNote> : null}
              </TextField>
            </div>

            <TextField value={form.prompt} onChange={set("prompt")} isRequired isInvalid={!!issues.prompt} fullWidth name="prompt">
              <Label>{form.more.length > 0 ? "Question 1" : "Prompt"}</Label>
              <TextArea rows={3} />
                            {issues.prompt ? <FieldNote>{issues.prompt}</FieldNote> : null}
            </TextField>

            {form.kind === "topic" ? null : (
              <>
            <TextField value={form.answer_key} onChange={set("answer_key")} isRequired={!editingId} isInvalid={!!issues.answer_key} fullWidth name="answer_key">
              <Label>
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="size-3.5" aria-hidden /> Answer key
                </span>
              </Label>
              <TextArea
                rows={5}
                className="font-mono text-[13px]"
                spellCheck={false}
                autoComplete="off"
                placeholder={editingId ? "Leave empty to keep the stored key." : "Your solution"}
              />
              <Description>
                Only the guard reads it. It is never sent to the tutor, to students, or back to this page.
              </Description>
              {issues.answer_key ? <FieldNote>{issues.answer_key}</FieldNote> : null}
            </TextField>

            <div className="rounded-lg border border-border px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Lock className="size-3.5" aria-hidden /> Canary
              </p>
              <p className="mt-0.5 text-sm text-muted">
                A marker stored beside the key. A hint that contains it is held.
              </p>
            </div>

              </>
            )}

            {/*
              Questions 2 and on. Each has its own prompt and its own key, and the
              student moves through them in order with Next. The time each one took
              is shown on the dashboard; students are told that, and see no clock.
            */}
            {form.more.map((m, i) => (
              <section key={m.uid} aria-label={`Question ${i + 2}`} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-medium">Question {i + 2}</h2>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove question ${i + 2}`}
                    onPress={() => {
                      setForm((f) => ({ ...f, more: f.more.filter((x) => x.uid !== m.uid) }));
                      setSaved(null);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden /> Remove
                  </Button>
                </div>
                <TextField value={m.prompt} onChange={setMore(m.uid, "prompt")} isRequired fullWidth name={`question_${i + 2}_prompt`}>
                  <Label>Prompt</Label>
                  <TextArea rows={3} />
                </TextField>
                {form.kind === "topic" ? null : (
                  <TextField value={m.answer_key} onChange={setMore(m.uid, "answer_key")} isRequired={m.from === undefined} fullWidth name={`question_${i + 2}_key`}>
                    <Label>
                      <span className="inline-flex items-center gap-1.5">
                        <Lock className="size-3.5" aria-hidden /> Answer key
                      </span>
                    </Label>
                    <TextArea rows={4} className="font-mono text-[13px]" spellCheck={false} autoComplete="off" placeholder={m.from !== undefined ? "Leave empty to keep the stored key." : "Your solution"} />
                  </TextField>
                )}
                {issues[`more.${m.uid}`] ? <FieldNote>{issues[`more.${m.uid}`]}</FieldNote> : null}
              </section>
            ))}
            {form.more.length + 1 < MAX_QUESTIONS ? (
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setForm((f) => ({ ...f, more: [...f.more, { uid: nextUid++, prompt: "", answer_key: "" }] }));
                    setSaved(null);
                  }}
                >
                  <Plus className="size-4" aria-hidden /> Add question
                </Button>
              </div>
            ) : null}

            {/* A whole lecture can be pasted here (D-R5). The server caps notes at
                MAX_NOTES_CHARS (routes.ts); maxLength stops the paste at the same
                number so the save is not refused after the fact. The box grows to a
                tall, scrollable field so a long paste can still be read and edited. */}
            <TextField value={form.notes} onChange={set("notes")} fullWidth name="notes" maxLength={MAX_NOTES_CHARS}>
              <Label>Lecture notes</Label>
              <TextArea
                rows={10}
                className="max-h-[32rem] min-h-40 resize-y"
                placeholder={"Lecture 7, slides 12-16: recursion\nEvery recursive function needs a base case...\n\nPaste a whole lecture: headings like \"Lecture 7\" or \"Slide 13\" are kept with the text under them."}
              />
              <Description>
                Paste a whole lecture or just the key points. Hints cite it, and study cards are written from it. {form.notes.length.toLocaleString()} of{" "}
                {MAX_NOTES_CHARS.toLocaleString()} characters.
              </Description>
            </TextField>

            <TextField value={form.concepts} onChange={set("concepts")} isRequired isInvalid={!!issues.concepts} fullWidth name="concepts">
              <Label>Concepts</Label>
              <TextArea rows={4} className="font-mono text-[13px]" spellCheck={false} placeholder={"base_case\nrecursive_call_progress\nreturn_value_propagation\ncall_stack_tracing"} />
              <Description>One per line. Each becomes a row of your heatmap.</Description>
              {issues.concepts ? <FieldNote>{issues.concepts}</FieldNote> : null}
            </TextField>
            {concepts.length > 0 ? (
              <div className="-mt-2 flex flex-wrap gap-1.5" aria-label="Concepts as they will be saved">
                {concepts.map((c, i) => (
                  <Chip key={`${c}-${i}`} size="sm" variant="soft">
                    {c}
                  </Chip>
                ))}
              </div>
            ) : null}

            {form.kind === "topic" ? null : (
            <RadioGroup value={form.hint_ceiling} onChange={set("hint_ceiling")} name="hint_ceiling">
              <Label>Hint ceiling</Label>
              <Description>The highest hint a student can reach.</Description>
              {([1, 2, 3] as HintLevel[]).map((n) => (
                <Radio key={n} value={String(n)}>
                  <Radio.Content>
                    <Radio.Control>
                      <Radio.Indicator />
                    </Radio.Control>
                    Level {n} · {LEVEL_NAME[n]}
                  </Radio.Content>
                  <Description>{LEVEL_HELP[n]}</Description>
                </Radio>
              ))}
            </RadioGroup>
            )}

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
                    The key has been cleared from this page.{" "}
                    <NextLink className="underline underline-offset-2" href={`/student/assignment/${saved}`}>
                      Open the student page
                    </NextLink>
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" isPending={saving} isDisabled={saving}>
                {editingId ? "Save changes" : "Save assignment"}
              </Button>
              {editingId ? (
                <NextLink href="/prof/dashboard" className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm text-muted hover:bg-default hover:text-foreground">
                  Open the dashboard <ArrowRight className="size-4" aria-hidden />
                </NextLink>
              ) : null}
            </div>
          </form>
        </Card.Content>
      </Card>
    </div>
  );
}

/** A field's error, in the danger color and as text, so it is not carried by color alone. */
function FieldNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-danger">{children}</p>;
}
