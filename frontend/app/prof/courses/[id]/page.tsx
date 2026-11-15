"use client";

import { ChooseProfessor } from "@/components/prof/choose-professor";
import { browser } from "@/lib/browser";
import { Alert, Button, Card, Description, Input, Label, Radio, RadioGroup, Spinner, TextArea, TextField } from "@heroui/react";
import { BarChart3, Check, FileText, Pencil, Plus, TrendingDown, Upload } from "lucide-react";
import NextLink from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SlidesManager } from "@/components/prof/slides-manager";
import { AssignmentBuilder } from "@/components/prof/assignment-builder";
import { ClassChat } from "@/components/prof/class-chat";
import { ArtifactPane } from "@/components/workspace/artifact-pane";
import { useWorkspace } from "@/components/workspace/student-shell";
import { api, conceptLabel, COURSE_ACCENTS, type ClassChatDraft, type Course, type CourseAccent, type ProfCourseCard } from "@/lib/api";
import { ACCENT_BG, exactDue, relativeDue } from "@/lib/courses";
import { KIND } from "@/lib/kinds";
import { cn } from "@/lib/utils";


/**
 * One class, as its professor runs it: a chat with Askretes about the class
 * (which can draft assignments from the professor's files), and a panel with
 * the class's assignments, the assignment builder, its details and notes, and
 * its slides. The sections below describe what each panel view holds.
 *
 * - Overview: the card details (code, term, colour), the description, the
 *   classroom notes, and handout files. A handout is stored as text, read
 *   once by the model; only lecture slides keep the file.
 * - Slides: lecture PDFs, kept for students and read per page for Askretes.
 * - Assignments: the class's work with due dates and whether Askretes is on,
 *   each with Edit (the setup form) and Dashboard. New opens the setup form
 *   with this class's name filled in.
 * - Dashboard: the weakest concept from the class's newest Thursday card,
 *   and a way into each assignment's dashboard. The numbers there are the
 *   stored ones; this page computes none.
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
  const { refresh: refreshSidebar } = useWorkspace();
  const [paneOpen, setPaneOpen] = useState(false);
  const [paneView, setPaneView] = useState("home");
  const [expanded, setExpanded] = useState(false);
  /** A draft the class chat made, opened in the builder for review. */
  const [chatDraft, setChatDraft] = useState<ClassChatDraft | null>(null);

  useEffect(() => {
    let live = true;
    const asked = new URLSearchParams(window.location.search).get("tab");
    // Opens on the panel where it fits beside the chat; ?tab=slides (an older link) opens the slides.
    window.setTimeout(() => live && setPaneOpen(window.matchMedia("(min-width: 1200px)").matches || asked === "slides"), 0);
    Promise.all([api.course(id), api.profCourses().catch(() => ({ courses: [] as ProfCourseCard[] }))])
      .then(([c, all]) => {
        if (!live) return;
        if (asked === "slides") setPaneView("slides");
        setCourse(c);
        setCard(all.courses.find((x) => x.id === c.id) ?? null);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id]);


  if (failed) {
    return (
      <Alert status="danger" className="m-10 mx-auto max-w-xl">
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

  // Only the professor who teaches a class manages it. The class itself is public (students open it), so this page
  // checks the label here; the professor routes it calls refuse the same way on the server (prof-scope.ts).
  const me = browser.profProfile();
  if (!me) return <div className="min-h-0 flex-1 overflow-y-auto p-10"><ChooseProfessor /></div>;
  if (course.professor !== me) {
    return (
      <Alert status="warning" className="m-10 mx-auto max-w-xl">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Not your class</Alert.Title>
          <Alert.Description>
            {course.name} is taught by {course.professor || "another professor"}. Your classes are under{" "}
            <NextLink href="/prof/courses" className="underline underline-offset-2">
              Your classes
            </NextLink>
            .
          </Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  const work = course.items.filter((a) => a.kind !== "topic");

  // The class's own panel: its assignments and how they are going, the builder for a new one, its details and notes, and its slides.
  const overview = (
    <div className="flex flex-col gap-6 pb-2">
      <header className="flex flex-col gap-1.5">
        <p className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden className={cn("size-2.5 rounded-full", ACCENT_BG[course.accent])} />
          {[course.code, course.term].filter(Boolean).join(" · ")}
        </p>
        <h2 className="font-serif text-3xl font-semibold tracking-tight">{course.name}</h2>
        {course.description ? <p className="text-muted">{course.description}</p> : null}
        <div className="mt-1 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onPress={() => setPaneView("new")}>
            <Plus className="size-4" aria-hidden /> New assignment
          </Button>
          <Button size="sm" variant="ghost" onPress={() => router.push(`/course/${course.id}`)}>
            Student view
          </Button>
        </div>
      </header>

      {card?.weakest ? (
        <div className="rounded-2xl border border-border bg-surface px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-margin-red">
            <TrendingDown className="size-3.5" aria-hidden /> Weakest right now
          </p>
          <p className="mt-1 font-serif text-xl">
            {conceptLabel(card.weakest.concept)}
            {card.weakest.percent_struggling !== null ? <span className="text-muted">, {card.weakest.percent_struggling}% struggling</span> : null}
          </p>
          <p className="text-sm text-muted">{card.weakest.assignment_title}</p>
        </div>
      ) : null}

      <section aria-labelledby="class-work" className="flex flex-col gap-1">
        <h3 id="class-work" className="px-1 text-xs font-medium text-muted">
          Assignments {course.items.length ? <span className="tabular-nums">{course.items.length}</span> : null}
        </h3>
        {course.items.length === 0 ? (
          <p className="px-1 py-3 text-muted">Nothing posted yet. Ask Askretes in the chat, or press New assignment.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/70 border-y border-border/70">
            {course.items.map((a) => {
              const due = a.due_at ? relativeDue(a.due_at) : null;
              return (
                <li key={a.id} className="group flex items-center gap-3 px-1 py-3">
                  <BarChart3 className="size-4 shrink-0 text-muted" aria-hidden />
                  <NextLink href={`/prof/dashboard?assignment=${a.id}`} className="min-w-0 flex-1">
                    <span className="block truncate font-medium group-hover:underline">{a.title}</span>
                    <span className="block text-sm text-muted">
                      {KIND[a.kind].name}
                      {a.due_at && due ? <time dateTime={a.due_at} title={exactDue(a.due_at)}>{` · ${due.text}`}</time> : " · no due date"}
                      {a.margin_enabled === false ? " · Askretes off" : ""}
                    </span>
                  </NextLink>
                  <Button size="sm" variant="ghost" onPress={() => router.push(`/prof/setup?course_id=${course.id}&assignment=${a.id}`)}>
                    <Pencil className="size-3.5" aria-hidden /> Edit
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {work.length === 0 ? null : <p className="px-1 text-xs text-muted">Open an assignment to see its dashboard and ask Askretes about it.</p>}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {expanded && paneOpen ? null : (
        <ClassChat
          courseId={course.id}
          title={course.code ? `${course.code} · ${course.name.replace(course.code, "").replace(/^[\s:–-]+/, "") || course.name}` : course.name}
          paneOpen={paneOpen}
          onTogglePane={() => setPaneOpen(!paneOpen)}
          onReview={(d) => {
            setChatDraft(d);
            setPaneView("new");
            setPaneOpen(true);
          }}
        />
      )}
      <ArtifactPane
        tabbed
        label={`${course.name} panel`}
        defaultWidth={44}
        widthKey="margin.prof.class-pane.width"
        expanded={expanded}
        onExpandedChange={setExpanded}
        isOpen={paneOpen}
        onOpenChange={(open) => {
          setPaneOpen(open);
          if (!open) setExpanded(false);
        }}
        view={paneView}
        onView={setPaneView}
        home={{ title: "Class", content: overview }}
        views={[
          {
            id: "new",
            label: chatDraft ? "Review draft" : "New assignment",
            content: (
              <div className="pb-4">
                <AssignmentBuilder
                  key={chatDraft?.draft_id ?? "blank"}
                  courseId={course.id}
                  courseName={course.name}
                  fromChat={chatDraft ? { draft: chatDraft, title: chatDraft.title, due_at: chatDraft.due_at } : null}
                  onSaved={(aid) => {
                    setChatDraft(null);
                    refreshSidebar();
                    void api.course(course.id).then(setCourse);
                    router.push(`/prof/dashboard?assignment=${aid}`);
                  }}
                />
              </div>
            ),
          },
          {
            id: "details",
            label: "Details & notes",
            content: (
              <div className="flex flex-col gap-6 pb-4">
                <OverviewEditor course={course} onSaved={(c) => setCourse({ ...course, ...c })} />
                <Handouts course={course} onAdded={(m) => setCourse({ ...course, materials: [...course.materials, m] })} />
              </div>
            ),
          },
          { id: "slides", label: "Slides", content: <SlidesManager courseId={course.id} /> },
        ]}
      />
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
            <Description>For every lesson and assignment in this class. Askretes points students here.</Description>
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
        <Card.Description>Text, PDF, or a photo. Stored as text students and Askretes can search. Lecture decks go under Slides.</Card.Description>
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
