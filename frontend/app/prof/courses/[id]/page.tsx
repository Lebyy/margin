"use client";

import { Alert, Breadcrumbs, Button, Card, Chip, Description, Input, Label, Radio, RadioGroup, Spinner, Tabs, TextArea, TextField } from "@heroui/react";
import { BarChart3, Check, FileText, Pencil, Plus, TrendingDown, Upload } from "lucide-react";
import NextLink from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Discussion } from "@/components/discussion";
import { SlidesManager } from "@/components/prof/slides-manager";
import { api, conceptLabel, COURSE_ACCENTS, type Course, type CourseAccent, type ProfCourseCard } from "@/lib/api";
import { ACCENT_BG, exactDue, relativeDue } from "@/lib/courses";
import { KIND } from "@/lib/kinds";
import { cn } from "@/lib/utils";

const TABS = ["overview", "slides", "assignments", "dashboard", "discussion"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", slides: "Slides", assignments: "Assignments", dashboard: "Dashboard", discussion: "Discussion" };

/**
 * One class, as its professor manages it, in tabs.
 *
 * - Overview: the card details (code, term, colour), the description, the
 *   classroom notes, and handout files. A handout is stored as text, read
 *   once by the model; only lecture slides keep the file.
 * - Slides: lecture PDFs, kept for students and read per page for Margin.
 * - Assignments: the class's work with due dates and whether Margin is on,
 *   each with Edit (the setup form) and Dashboard. New opens the setup form
 *   with this class's name filled in.
 * - Dashboard: the weakest concept from the class's newest Thursday card,
 *   and a way into each assignment's dashboard. The numbers there are the
 *   stored ones; this page computes none.
 * - Discussion: the class discussion, as before.
 *
 * The old URLs (/prof/setup, /prof/dashboard, /prof/messages) still work
 * and are what these links open, so the demo path does not change.
 */
export default function ManageCoursePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [card, setCard] = useState<ProfCourseCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    let live = true;
    const asked = new URLSearchParams(window.location.search).get("tab");
    Promise.all([api.course(id), api.profCourses().catch(() => ({ courses: [] as ProfCourseCard[] }))])
      .then(([c, all]) => {
        if (!live) return;
        if (asked && (TABS as readonly string[]).includes(asked)) setTab(asked as Tab);
        setCourse(c);
        setCard(all.courses.find((x) => x.id === c.id) ?? null);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id]);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  if (failed) {
    return (
      <Alert status="danger" className="mx-auto mt-10 max-w-xl">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>This class could not be opened.</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }
  if (!course) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner aria-label="Opening the class" />
      </div>
    );
  }

  const work = course.items.filter((a) => a.kind !== "topic");
  const newHref = `/prof/setup?course=${encodeURIComponent(course.name)}`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Breadcrumbs className="flex-wrap">
        <Breadcrumbs.Item href="/prof/courses">Your classes</Breadcrumbs.Item>
        <Breadcrumbs.Item>{course.code || course.name}</Breadcrumbs.Item>
      </Breadcrumbs>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className={cn("h-1.5 w-24 rounded-full", ACCENT_BG[course.accent])} aria-hidden />
          {course.code ? <p className="text-sm font-semibold uppercase tracking-wide text-muted">{course.code}</p> : null}
          <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">{course.name}</h1>
          <p className="text-muted">{[course.professor, course.term].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onPress={() => router.push(`/course/${course.id}`)}>
            Student view
          </Button>
          <Button variant="primary" onPress={() => router.push(newHref)}>
            <Plus className="size-4" aria-hidden /> New assignment
          </Button>
        </div>
      </header>

      <Tabs selectedKey={tab} onSelectionChange={(key) => choose(String(key) as Tab)}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Class sections">
            {TABS.map((t) => (
              <Tabs.Tab key={t} id={t}>
                {TAB_LABEL[t]}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="overview" className="flex flex-col gap-6 pt-5">
          <OverviewEditor course={course} onSaved={(c) => setCourse({ ...course, ...c })} />
          <Handouts course={course} onAdded={(m) => setCourse({ ...course, materials: [...course.materials, m] })} />
        </Tabs.Panel>

        <Tabs.Panel id="slides" className="pt-5">
          <SlidesManager courseId={course.id} />
        </Tabs.Panel>

        <Tabs.Panel id="assignments" className="pt-5">
          {course.items.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border p-6">
              <p className="font-medium">Nothing posted in this class yet.</p>
              <Button variant="primary" onPress={() => router.push(newHref)}>
                <Plus className="size-4" aria-hidden /> New assignment
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
              {course.items.map((a) => {
                const due = a.due_at ? relativeDue(a.due_at) : null;
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Chip size="sm" variant="soft" color={KIND[a.kind].color}>
                      {KIND[a.kind].name}
                    </Chip>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{a.title}</p>
                      <p className="text-sm text-muted">
                        {a.due_at && due ? (
                          <time dateTime={a.due_at} title={exactDue(a.due_at)}>
                            {due.text}, {exactDue(a.due_at)}
                          </time>
                        ) : (
                          "No due date"
                        )}
                        {" · "}
                        {a.margin_enabled === false ? "Margin off" : "Margin on"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onPress={() => router.push(`/prof/setup?assignment=${a.id}`)}>
                        <Pencil className="size-4" aria-hidden /> Edit
                      </Button>
                      <Button size="sm" variant="secondary" onPress={() => router.push(`/prof/dashboard?assignment=${a.id}`)}>
                        <BarChart3 className="size-4" aria-hidden /> Dashboard
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Tabs.Panel>

        <Tabs.Panel id="dashboard" className="flex flex-col gap-4 pt-5">
          {card?.weakest ? (
            <Card>
              <Card.Header>
                <Card.Title className="flex items-center gap-2">
                  <TrendingDown className="size-4 text-margin-red" aria-hidden /> Weakest concept, from the newest Thursday card
                </Card.Title>
                <Card.Description>{card.weakest.assignment_title}</Card.Description>
              </Card.Header>
              <Card.Content>
                <p className="font-serif text-2xl">
                  {conceptLabel(card.weakest.concept)}
                  {card.weakest.percent_struggling !== null ? <span className="text-muted">, {card.weakest.percent_struggling}% struggling</span> : null}
                </p>
              </Card.Content>
            </Card>
          ) : (
            <p className="rounded-2xl border border-dashed border-border p-6 text-muted">No Margin data yet. A Thursday card is made on an assignment&rsquo;s dashboard once students have worked on it.</p>
          )}
          {work.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {work.map((a) => (
                <li key={a.id}>
                  <NextLink href={`/prof/dashboard?assignment=${a.id}`} className="flex items-center gap-2 rounded-xl border border-border px-4 py-3 hover:bg-default">
                    <BarChart3 className="size-4 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                    {a.margin_enabled === false ? <span className="text-xs text-muted">Margin off</span> : null}
                  </NextLink>
                </li>
              ))}
            </ul>
          ) : null}
        </Tabs.Panel>

        <Tabs.Panel id="discussion" className="pt-5">
          <Discussion courseId={course.id} role="prof" />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

/** The card details and the text a class shows students. Saving sends only these fields; the server keeps anything not sent. */
function OverviewEditor({ course, onSaved }: { course: Course; onSaved: (c: Partial<Course>) => void }) {
  const [code, setCode] = useState(course.code);
  const [term, setTerm] = useState(course.term);
  const [accent, setAccent] = useState<CourseAccent>(course.accent);
  const [description, setDescription] = useState(course.description);
  const [notes, setNotes] = useState(course.notes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    try {
      await api.saveCourse({ id: course.id, name: course.name, description, notes, code, term, accent });
      onSaved({ code, term, accent, description, notes });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Card.Content>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField value={code} onChange={touch(setCode)} name="code">
              <Label>Course code</Label>
              <Input maxLength={24} placeholder="PHYS 101" />
            </TextField>
            <TextField value={term} onChange={touch(setTerm)} name="term">
              <Label>Term</Label>
              <Input maxLength={40} placeholder="Fall 2026" />
            </TextField>
          </div>
          {/* The colour is a choice of theme tokens, shown as swatches and named in words, so it never has to be read by colour alone. */}
          <RadioGroup value={accent} onChange={(v) => touch(setAccent)(v as CourseAccent)} orientation="horizontal" name="accent">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-3">
              {COURSE_ACCENTS.map((a) => (
                <Radio key={a} value={a}>
                  <Radio.Content>
                    <Radio.Control>
                      <Radio.Indicator />
                    </Radio.Control>
                    <span className="inline-flex items-center gap-1.5 capitalize">
                      <span className={cn("size-3 rounded-full", ACCENT_BG[a])} aria-hidden /> {a}
                    </span>
                  </Radio.Content>
                </Radio>
              ))}
            </div>
          </RadioGroup>
          <TextField value={description} onChange={touch(setDescription)} fullWidth name="description">
            <Label>About this class</Label>
            <Input maxLength={600} />
          </TextField>
          <TextField value={notes} onChange={touch(setNotes)} fullWidth name="notes">
            <Label>Classroom notes</Label>
            <TextArea rows={7} className="font-serif text-[17px] leading-7" />
            <Description>For every lesson and assignment in this class. Margin points students here.</Description>
          </TextField>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" isPending={saving}>
              Save
            </Button>
            {saved ? (
              <span className="flex items-center gap-1 text-sm text-muted" role="status">
                <Check className="size-4 text-margin-green" aria-hidden /> Saved
              </span>
            ) : null}
          </div>
        </form>
      </Card.Content>
    </Card>
  );
}

/**
 * Handouts: a text file kept as written, or a PDF or photo read into text by
 * the model once. Only the text is kept, so there is no download link. A
 * lecture deck belongs under Slides, where the file is kept and read per page.
 */
function Handouts({ course, onAdded }: { course: Course; onAdded: (m: Course["materials"][number]) => void }) {
  const [adding, setAdding] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addFile(file: File) {
    setFileError(null);
    setAdding(file.name);
    try {
      const isText = file.type.startsWith("text/") || /\.(txt|md|markdown)$/i.test(file.name);
      let material;
      if (isText) {
        material = await api.addMaterial(course.id, { title: file.name, text: await file.text() });
      } else {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        material = await api.addMaterial(course.id, { title: file.name, file: { mimeType: file.type, base64 } });
      }
      onAdded(material);
    } catch {
      setFileError(`${file.name} could not be read. Text, PDF, PNG, JPEG and WebP files under 7 MB work.`);
    } finally {
      setAdding(null);
    }
  }

  return (
    <Card>
      <Card.Header>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Card.Title>Handouts</Card.Title>
          <Button variant="secondary" isPending={adding !== null} isDisabled={adding !== null} onPress={() => fileRef.current?.click()}>
            <Upload className="size-4" aria-hidden /> Add a handout
          </Button>
        </div>
        <Card.Description>Text, PDF, or a photo. Stored as text students and Margin can search. Lecture decks go under Slides.</Card.Description>
      </Card.Header>
      <Card.Content>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.markdown,text/plain,application/pdf,image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void addFile(file);
          }}
        />
        {adding ? (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner size="sm" /> Reading {adding}
          </p>
        ) : null}
        {fileError ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{fileError}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        {course.materials.length === 0 && !adding ? <p className="text-muted">No handouts yet.</p> : null}
        <ul className="flex flex-col divide-y divide-border">
          {course.materials.map((m) => (
            <li key={m.id} className="py-3">
              <p className="flex items-center gap-2 font-medium">
                <FileText className="size-4 text-margin-red" aria-hidden /> {m.title}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{m.body}</p>
            </li>
          ))}
        </ul>
      </Card.Content>
    </Card>
  );
}
