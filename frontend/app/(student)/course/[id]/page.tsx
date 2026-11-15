"use client";

import { Alert, Button, Chip, Input, Label, Spinner, TextField, Tooltip } from "@heroui/react";
import { BookOpen, ChevronRight, Circle, CircleCheck, CircleDot, NotebookPen, PanelRight, Presentation, Sparkles } from "lucide-react";
import NextLink from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SlideViewer } from "@/components/slide-viewer";
import { ArtifactPane, PaneRow, PaneSection } from "@/components/workspace/artifact-pane";
import { ClassNotes } from "@/components/workspace/class-notes";
import { NavButton, useWorkspace } from "@/components/workspace/student-shell";
import { api, ApiError, type AssignmentListItem, type Course, type Lecture } from "@/lib/api";
import { browser } from "@/lib/browser";
import { ACCENT_BG, exactDue, relativeDue, STATUS_LABEL } from "@/lib/courses";
import { cn } from "@/lib/utils";


/** The pane is a column beside the class from this width up, and a drawer below it. */
const PANE_INLINE = "(min-width: 1200px)";

/**
 * One class, as a student opens it in the workspace.
 *
 * The middle is the class itself: its name, who teaches it, whether Askretes is
 * on, and its assignments, each of which opens as a conversation with Askretes.
 * The pane beside it holds the professor's
 * material: the classroom notes and files, and the lecture slides.
 *
 * A student who has not joined the class sees a Join card above the list.
 * Joining is what puts the class in the sidebar. Starting work on one of its
 * assignments also joins it, so the card is a convenience, not a gate.
 *
 * Everything here was saved by a professor or done by this student; nothing
 * is filled in for them.
 */
export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const { refresh: refreshSidebar } = useWorkspace();
  const [course, setCourse] = useState<Course | null>(null);
  const [failed, setFailed] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [joined, setJoined] = useState<boolean | null>(null);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [paneOpen, setPaneOpen] = useState(false);
  const [paneView, setPaneView] = useState("home");
  // The open lecture and page. A citation link from a reply opened in a new tab sets both through the URL: ?tab=slides&lecture=<id>&page=<n>.
  const [lectureId, setLectureId] = useState<string | null>(null);
  const [page, setPage] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    // The stored student and the URL are read here, after the first render,
    // and applied with the course when it arrives, so the server render and
    // the first client render agree and the page needs no Suspense boundary.
    const known = browser.studentId();
    const params = new URLSearchParams(window.location.search);
    const asked = params.get("tab");
    const askedPage = Number(params.get("page"));
    Promise.all([
      api.course(id, known),
      known ? api.myCourses(known).catch((e: unknown) => (e instanceof ApiError && e.status === 404 ? null : undefined)) : Promise.resolve(undefined),
      api.lectures(id).catch(() => ({ lectures: [] as Lecture[] })),
    ])
      .then(([c, mine, l]) => {
        if (!live) return;
        // A stored student this database answers 404 for is forgotten, so Join
        // asks for a name instead of failing. Any other error keeps the id.
        if (known && mine === null) browser.forgetStudent();
        setStudentId(known && mine !== null ? known : null);
        setLectures(l.lectures);
        // A link to the slides opens the pane on them; otherwise the pane opens on the notes where it sits beside the class, and stays shut on a narrow screen.
        if (asked === "slides") {
          setPaneView("slides");
          setPaneOpen(true);
        } else {
          setPaneOpen(window.matchMedia(PANE_INLINE).matches);
        }
        setLectureId(params.get("lecture"));
        setPage(Number.isInteger(askedPage) && askedPage > 0 ? askedPage : null);
        setCourse(c);
        setJoined(!!mine?.courses.some((m) => m.id === c.id));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id]);

  const header = (
    <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
      <NavButton />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{course ? course.code || course.name : ""}</p>
      {course ? (
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant={paneOpen ? "secondary" : "ghost"} aria-label={paneOpen ? "Close the notes pane" : "Open the notes pane"} aria-pressed={paneOpen} onPress={() => setPaneOpen(!paneOpen)}>
            <PanelRight className="size-4" />
          </Button>
          <Tooltip.Content>{paneOpen ? "Close the pane" : "Notes and slides"}</Tooltip.Content>
        </Tooltip>
      ) : null}
    </header>
  );

  if (failed || !course) {
    return (
      <div className="flex flex-1 flex-col">
        {header}
        {failed ? (
          <Alert status="danger" className="mx-auto mt-10 max-w-xl">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>This class could not be opened.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : (
          <div className="flex justify-center pt-24">
            <Spinner aria-label="Opening the class" />
          </div>
        )}
      </div>
    );
  }

  const work = course.items.filter((a) => a.kind !== "topic");
  const lessons = course.items.filter((a) => a.kind === "topic");
  const withMargin = work.filter((a) => a.margin_enabled !== false).length;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col" aria-label={course.name}>
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-12 pt-6 sm:px-6">
            <header className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-sm text-muted">
                <span aria-hidden className={cn("size-2.5 rounded-full", ACCENT_BG[course.accent])} />
                {[course.code, course.term].filter(Boolean).join(" · ")}
              </p>
              <h1 className="font-serif text-4xl font-semibold tracking-tight">{course.name}</h1>
              {course.description ? <p className="max-w-2xl text-[17px] leading-7 text-muted">{course.description}</p> : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                {course.professor ? <span>{course.professor}</span> : null}
                {/* Whether the tutor is part of this class. Each assignment is opted in by the professor, so the line counts them rather than promising Askretes everywhere. */}
                {work.length > 0 ? (
                  <span className="flex items-center gap-1.5 text-muted">
                    <Sparkles className="size-3.5 text-margin-red" aria-hidden />
                    {withMargin === work.length ? "Askretes on for every assignment" : withMargin === 0 ? "Askretes is off in this class" : `Askretes on for ${withMargin} of ${work.length}`}
                  </span>
                ) : null}
              </div>
            </header>

            {joined === false ? (
              <JoinCard
                courseId={course.id}
                studentId={studentId}
                onJoined={(sid) => {
                  browser.setStudentId(sid);
                  setStudentId(sid);
                  setJoined(true);
                  refreshSidebar();
                }}
              />
            ) : null}

            <WorkSection title="Assignments" items={work} empty="No assignment has been posted in this class yet." />
            {lessons.length > 0 ? <WorkSection title="Learn" items={lessons} empty="" /> : null}

            {/* With the pane shut, the professor's material is still one press away from the class itself. */}
            {paneOpen ? null : (
              <section className="flex flex-col gap-1">
                <h2 className="px-1 text-xs font-medium text-muted">From your professor</h2>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onPress={() => { setPaneView("notes"); setPaneOpen(true); }}>
                    <NotebookPen className="size-4" aria-hidden /> Class notes
                  </Button>
                  <Button size="sm" variant="secondary" onPress={() => { setPaneView("home"); setPaneOpen(true); }}>
                    <Presentation className="size-4" aria-hidden /> Lecture slides{lectures.length > 0 ? ` (${lectures.length})` : ""}
                  </Button>
                </div>
              </section>
            )}
          </div>
        </div>
      </section>

      <ArtifactPane
        label="Notes and slides from your professor"
        view={paneView}
        onView={setPaneView}
        isOpen={paneOpen}
        onOpenChange={setPaneOpen}
        home={{
          title: "Class",
          content: (
            <>
              <PaneSection title="From your professor">
                <PaneRow
                  icon={<NotebookPen className="size-4" />}
                  label="Class notes"
                  detail={course.materials.length ? `${course.materials.length} ${course.materials.length === 1 ? "file" : "files"}` : undefined}
                  onPress={() => setPaneView("notes")}
                />
              </PaneSection>
              {lectures.length ? (
                <PaneSection title="Lecture slides">
                  {lectures.map((l) => (
                    <PaneRow
                      key={l.id}
                      icon={<Presentation className="size-4" />}
                      label={`Lecture ${l.lecture_number}: ${l.title}`}
                      detail="PDF"
                      onPress={() => {
                        setLectureId(l.id);
                        setPage(null);
                        setPaneView("slides");
                      }}
                    />
                  ))}
                </PaneSection>
              ) : null}
            </>
          ),
        }}
        views={[
          { id: "notes", label: "Class notes", content: <ClassNotes notes={course.notes} materials={course.materials} /> },
          {
            id: "slides",
            label: "Slides",
            bleed: true,
            content: (
              <SlideViewer
                compact
                courseId={course.id}
                lectures={lectures}
                selectedId={lectureId}
                page={page}
                onSelect={(lid) => {
                  // Choosing a lecture opens it at its first page, and the URL follows so a reload opens the same lecture.
                  setLectureId(lid);
                  setPage(null);
                  const url = new URL(window.location.href);
                  url.searchParams.set("lecture", lid);
                  url.searchParams.delete("page");
                  window.history.replaceState(null, "", url);
                }}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * A class's work as a list of conversations, the way a chat app lists the
 * chats in a project: one quiet row each, opened with a click.
 *
 * Each row carries the student's status as a mark (an empty circle, a dotted
 * one for in progress, a check for submitted, a book for a lesson) with the
 * same word for a screen reader, the title, and when it is due. Work that is
 * overdue and not submitted says so in words and in red. The server sends the
 * rows nearest due first.
 */
function WorkSection({ title, items, empty }: { title: string; items: AssignmentListItem[]; empty: string }) {
  return (
    <section aria-labelledby={`work-${title}`} className="flex flex-col gap-1">
      <h2 id={`work-${title}`} className="flex items-baseline gap-2 px-1 text-xs font-medium text-muted">
        {title}
        {items.length ? <span className="tabular-nums">{items.length}</span> : null}
      </h2>
      {items.length === 0 ? (
        <p className="px-1 py-3 text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/70 border-y border-border/70">
          {items.map((a) => {
            const lesson = a.kind === "topic";
            const status = a.status ?? "not_started";
            const due = a.due_at ? relativeDue(a.due_at) : null;
            const overdue = !!due?.overdue && status !== "submitted";
            const Mark = lesson ? BookOpen : status === "submitted" ? CircleCheck : status === "in_progress" ? CircleDot : Circle;
            return (
              <li key={a.id}>
                <NextLink href={`/student/assignment/${a.id}`} className="group flex items-center gap-3 rounded-lg px-2 py-3.5 outline-offset-[-2px] transition-colors hover:bg-default/60">
                  <Mark aria-hidden className={cn("size-4 shrink-0", !lesson && status === "submitted" ? "text-margin-green" : !lesson && status === "in_progress" ? "text-margin-red" : "text-muted")} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 font-medium sm:block sm:truncate">{a.title}</span>
                    <span className="block text-sm text-muted">
                      {lesson ? "Lesson" : STATUS_LABEL[status]}
                      {a.margin_enabled === false && !lesson ? " · Askretes off" : ""}
                    </span>
                  </span>
                  {due && !lesson ? (
                    <time dateTime={a.due_at ?? undefined} title={a.due_at ? exactDue(a.due_at) : undefined} className={cn("shrink-0 text-sm", overdue ? "font-medium text-danger" : "text-muted")}>
                      {status === "submitted" ? "Submitted" : due.text}
                    </time>
                  ) : null}
                  <ChevronRight className="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </NextLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Joining the class. A browser with a student sends that id; a first visit
 * types a name, which creates the student, the same as starting a session.
 * The name is shown to the professor and never sent to the model.
 */
function JoinCard({ courseId, studentId, onJoined }: { courseId: string; studentId: string | null; onJoined: (studentId: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.joinCourse(courseId, studentId ? { student_id: studentId } : { display_name: name.trim() });
      if (!studentId && name.trim()) browser.setName(name.trim());
      onJoined(r.student_id);
    } catch {
      setError("Could not join. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-border p-4 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void join();
      }}
    >
      <div className="flex-1">
        <p className="font-medium">You are not in this class yet.</p>
        <p className="text-sm text-muted">Join it to keep it in your class list with what is due.</p>
      </div>
      {studentId ? null : (
        <TextField value={name} onChange={setName} isRequired name="display_name" className="sm:w-56">
          <Label>Your name</Label>
          <Input maxLength={80} autoComplete="given-name" />
        </TextField>
      )}
      <Button type="submit" variant="primary" isPending={busy} isDisabled={busy || (!studentId && !name.trim())}>
        Join class
      </Button>
      {error ? (
        <Chip color="danger" variant="soft">
          {error}
        </Chip>
      ) : null}
    </form>
  );
}
