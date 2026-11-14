"use client";

import { Alert, Button, Card, Chip, Description, Input, Label, Radio, RadioGroup, Spinner, TextArea, TextField } from "@heroui/react";
import { ArrowRight, Check, FilePlus2, Lock } from "lucide-react";
import NextLink from "next/link";
import { useEffect, useState } from "react";
import { Paper } from "@/components/paper";
import { api, ApiError, LEVEL_HELP, LEVEL_NAME, MAX_NOTES_CHARS, type HintLevel } from "@/lib/api";
import { browser } from "@/lib/browser";

/** The form's fields as the page holds them. Concepts are one per line while typing and become a list when sent. */
type Form = {
  course_name: string;
  title: string;
  prompt: string;
  answer_key: string;
  notes: string;
  concepts: string;
  hint_ceiling: string;
};

const EMPTY: Form = { course_name: "", title: "", prompt: "", answer_key: "", notes: "", concepts: "", hint_ceiling: "3" };

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
    Promise.resolve(stored ? api.profAssignment(stored) : null)
      .then((a) => {
        if (!live || !a) return;
        setEditingId(a.id);
        setForm({
          course_name: a.course_name,
          title: a.title,
          prompt: a.prompt,
          answer_key: "",
          notes: a.notes,
          concepts: a.concepts.join("\n"),
          hint_ceiling: String(a.hint_ceiling),
        });
      })
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const set = (field: keyof Form) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
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
    if (!editingId && !form.answer_key.trim()) missing.answer_key = "The guard needs the answer key to check hints against.";
    if (concepts.length === 0) missing.concepts = "List at least one concept.";
    if (new Set(concepts).size !== concepts.length) missing.concepts = "Each concept can appear once.";
    setIssues(missing);
    if (Object.keys(missing).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      const result = await api.saveAssignment({
        ...(editingId ? { id: editingId } : {}),
        course_name: form.course_name.trim(),
        title: form.title.trim(),
        prompt: form.prompt.trim(),
        ...(form.answer_key.trim() ? { answer_key: form.answer_key.trim() } : {}),
        notes: form.notes,
        concepts,
        hint_ceiling: Number(form.hint_ceiling),
      });
      browser.setProfAssignmentId(result._id);
      setEditingId(result._id);
      // The key leaves the page's memory here. It is on the server now, and nothing sends it back.
      setForm((f) => ({ ...f, answer_key: "" }));
      setSaved(result._id);
    } catch (e) {
      if (e instanceof ApiError && e.issues.length > 0) {
        setIssues(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
        setError("Some fields were not accepted.");
      } else {
        setError("The assignment was not saved. Check that the API and the database are running.");
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
              {editingId ? "Edit the assignment" : "Set up an assignment"}
            </h1>
            <p className="mt-1 text-muted">
              Signed in as <span className="font-mono">prof</span>. Students see the prompt and the notes. They never see
              the answer key.
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
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField value={form.course_name} onChange={set("course_name")} isRequired isInvalid={!!issues.course_name} fullWidth name="course_name">
                <Label>Course</Label>
                <Input placeholder="Intro CS, Python recursion" />
                {issues.course_name ? <FieldNote>{issues.course_name}</FieldNote> : null}
              </TextField>
              <TextField value={form.title} onChange={set("title")} isRequired isInvalid={!!issues.title} fullWidth name="title">
                <Label>Title</Label>
                <Input placeholder="Write sum_list(xs) recursively" />
                {issues.title ? <FieldNote>{issues.title}</FieldNote> : null}
              </TextField>
            </div>

            <TextField value={form.prompt} onChange={set("prompt")} isRequired isInvalid={!!issues.prompt} fullWidth name="prompt">
              <Label>Prompt</Label>
              <TextArea rows={3} placeholder="What the student is asked to do." />
              <Description>Students see this exactly as written.</Description>
              {issues.prompt ? <FieldNote>{issues.prompt}</FieldNote> : null}
            </TextField>

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
                placeholder={editingId ? "A key is stored. Leave this empty to keep it, or paste a new one to replace it." : "Your solution. It stays on the server."}
              />
              <Description>
                Stored on the server and read only by the guard, which checks every hint against it. It is not sent to the
                tutor, to students, or back to this page.
              </Description>
              {issues.answer_key ? <FieldNote>{issues.answer_key}</FieldNote> : null}
            </TextField>

            <div className="rounded-lg border border-border px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Lock className="size-3.5" aria-hidden /> Canary
              </p>
              <p className="mt-0.5 text-sm text-muted">
                Set by the server and stored beside the key. If that marker ever shows up in a hint, the guard treats the
                hint as a leak. It is not editable, so the guard always knows which marker to look for.
              </p>
            </div>

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
                Paste a whole lecture or just the key points. A level-2 hint cites the lecture and slide where a student&rsquo;s
                concept is covered, and revision cards are written from the same text. {form.notes.length.toLocaleString()} of{" "}
                {MAX_NOTES_CHARS.toLocaleString()} characters.
              </Description>
            </TextField>

            <TextField value={form.concepts} onChange={set("concepts")} isRequired isInvalid={!!issues.concepts} fullWidth name="concepts">
              <Label>Concepts</Label>
              <TextArea rows={4} className="font-mono text-[13px]" spellCheck={false} placeholder={"base_case\nrecursive_call_progress\nreturn_value_propagation\ncall_stack_tracing"} />
              <Description>One per line. Every student turn is labelled with exactly one of these, and each becomes a row of your heatmap.</Description>
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

            <RadioGroup value={form.hint_ceiling} onChange={set("hint_ceiling")} name="hint_ceiling">
              <Label>Hint ceiling</Label>
              <Description>The highest level a student can reach on this assignment. The tutor never goes past it.</Description>
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
                    The key is stored on the server and has been cleared from this page. Send students to{" "}
                    <NextLink className="underline underline-offset-2" href={`/student/assignment/${saved}`}>
                      the student page
                    </NextLink>
                    , then open the dashboard once someone has studied.
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
