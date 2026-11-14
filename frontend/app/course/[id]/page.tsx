"use client";

import { Alert, Breadcrumbs, Button, Chip, Disclosure, Input, Label, Spinner, Tabs, TextField } from "@heroui/react";
import { FileText, Sparkles } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AssignmentList } from "@/components/assignment-list";
import { Discussion } from "@/components/discussion";
import { Paper } from "@/components/paper";
import { api, ApiError, type Course } from "@/lib/api";
import { browser } from "@/lib/browser";
import { ACCENT_BG, courseShortName } from "@/lib/courses";
import { cn } from "@/lib/utils";

/** The tabs of a course page, in order. The URL's `?tab=` picks one, so a link can open a class straight at its slides. */
const TABS = ["overview", "assignments", "discussion"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", assignments: "Assignments", discussion: "Discussion" };

/**
 * One class, as a student opens it: Overview, Assignments, Discussion.
 *
 * The header carries the class's accent, code, title, instructor, and term,
 * under a breadcrumb back to My courses. A student who has not joined the
 * class sees a Join card above the tabs; joining is what puts it in My
 * courses. Starting work on one of its assignments also joins it, so the
 * card is a convenience, not a gate.
 *
 * The Assignments tab lists work by due date with this student's status,
 * read from their own sessions. Everything here was saved by a professor or
 * done by this student; nothing is filled in for them.
 */
export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [failed, setFailed] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [joined, setJoined] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    let live = true;
    // The stored student and the URL's `?tab=` are read here, after the first
    // render, and applied with the course when it arrives, so the server render
    // and the first client render agree and the page needs no Suspense boundary.
    const known = browser.studentId();
    const asked = new URLSearchParams(window.location.search).get("tab");
    Promise.all([api.course(id, known), known ? api.myCourses(known).catch((e: unknown) => (e instanceof ApiError && e.status === 404 ? null : undefined)) : Promise.resolve(undefined)])
      .then(([c, mine]) => {
        if (!live) return;
        // A stored student this database answers 404 for is forgotten, so Join
        // asks for a name instead of failing. Any other error keeps the id.
        if (known && mine === null) browser.forgetStudent();
        setStudentId(known && mine !== null ? known : null);
        if (asked && (TABS as readonly string[]).includes(asked)) setTab(asked as Tab);
        setCourse(c);
        setJoined(!!mine?.courses.some((m) => m.id === c.id));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id]);

  /** Changes the tab and the URL together, without a navigation, so Back still leaves the class. */
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
  const lessons = course.items.filter((a) => a.kind === "topic");
  const withMargin = work.filter((a) => a.margin_enabled !== false).length;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs>
        <Breadcrumbs.Item href="/">My courses</Breadcrumbs.Item>
        <Breadcrumbs.Item>{courseShortName(course)}</Breadcrumbs.Item>
      </Breadcrumbs>

      <header className="flex flex-col gap-2">
        <div className={cn("h-1.5 w-24 rounded-full", ACCENT_BG[course.accent])} aria-hidden />
        {course.code ? <p className="text-sm font-semibold uppercase tracking-wide text-muted">{course.code}</p> : null}
        <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">{course.name}</h1>
        <p className="text-muted">{[course.professor && `Taught by ${course.professor}`, course.term].filter(Boolean).join(" · ")}</p>
      </header>

      {joined === false ? (
        <JoinCard
          courseId={course.id}
          studentId={studentId}
          onJoined={(sid) => {
            browser.setStudentId(sid);
            setStudentId(sid);
            setJoined(true);
          }}
        />
      ) : null}

      <Tabs selectedKey={tab} onSelectionChange={(key) => choose(String(key) as Tab)}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Class sections">
            {TABS.map((t) => (
              <Tabs.Tab key={t} id={t}>
                {TAB_LABEL[t]}
                {t === "assignments" && work.length > 0 ? <span className="ml-1.5 text-muted">{work.length}</span> : null}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="overview" className="flex flex-col gap-6 pt-5">
          {course.description ? <p className="max-w-3xl font-serif text-xl leading-8">{course.description}</p> : <p className="text-muted">The professor has not written a description yet.</p>}
          <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted">Instructor</dt>
            <dd>{course.professor || "Not given"}</dd>
            <dt className="text-muted">Term</dt>
            <dd>{course.term || "Not given"}</dd>
          </dl>
          {/* Whether the tutor is part of this class. Each assignment is opted in by the professor, so the note counts them rather than promising Margin everywhere. */}
          <p className="flex max-w-3xl items-start gap-2 rounded-xl border border-border px-4 py-3 text-sm">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-margin-red" aria-hidden />
            {work.length === 0
              ? "Nothing to do has been posted yet."
              : withMargin === work.length
                ? "Margin is on for every assignment in this class. It points at the mistake and does not write the solution."
                : withMargin === 0
                  ? "Your professor has not turned Margin on for any assignment in this class."
                  : `Margin is on for ${withMargin} of ${work.length} assignments in this class. It points at the mistake and does not write the solution.`}
          </p>

          {course.notes || course.materials.length > 0 ? (
            <section aria-labelledby="from-prof-heading" className="flex flex-col gap-3">
              <h2 id="from-prof-heading" className="font-serif text-2xl font-semibold tracking-tight">
                From your professor
              </h2>
              {course.notes ? (
                <Paper as="article" aria-label="Class notes">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-margin-red">Class notes</h3>
                  <p className="mt-2 whitespace-pre-wrap font-serif text-lg leading-8">{course.notes}</p>
                </Paper>
              ) : null}
              {course.materials.map((m) => (
                <Disclosure key={m.id} className="rounded-2xl border border-border px-4">
                  <Disclosure.Heading>
                    <Disclosure.Trigger className="flex w-full items-center gap-2 py-3.5 text-left font-medium">
                      <FileText className="size-4 text-margin-red" aria-hidden /> {m.title}
                      <Disclosure.Indicator className="ml-auto" />
                    </Disclosure.Trigger>
                  </Disclosure.Heading>
                  <Disclosure.Content>
                    <Disclosure.Body>
                      <p className="whitespace-pre-wrap pb-4 font-serif text-[17px] leading-7">{m.body}</p>
                    </Disclosure.Body>
                  </Disclosure.Content>
                </Disclosure>
              ))}
            </section>
          ) : null}
        </Tabs.Panel>

        <Tabs.Panel id="assignments" className="flex flex-col gap-8 pt-5">
          <section aria-labelledby="work-heading">
            <h2 id="work-heading" className="sr-only">
              Assignments
            </h2>
            <AssignmentList items={work} empty="No assignment has been posted in this class yet." />
          </section>
          {lessons.length > 0 ? (
            <section aria-labelledby="lessons-heading">
              <h2 id="lessons-heading" className="mb-3 font-serif text-2xl font-semibold tracking-tight">
                Learn
              </h2>
              <AssignmentList items={lessons} empty="" />
            </section>
          ) : null}
        </Tabs.Panel>

        <Tabs.Panel id="discussion" className="pt-5">
          <Discussion courseId={course.id} role="student" />
        </Tabs.Panel>
      </Tabs>
    </div>
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
        <p className="text-sm text-muted">Join it to see it under My courses with what is due.</p>
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
