"use client";

import { Spinner } from "@heroui/react";
import NextLink from "next/link";
import { useEffect, useState } from "react";
import { AssignmentList } from "@/components/assignment-list";
import { CourseCardLink, DueBadge } from "@/components/course-card";
import { api, ApiError, type CourseListItem, type MyCourses } from "@/lib/api";
import { browser } from "@/lib/browser";

/**
 * The student's front door: Due soon, My courses, and the other classes.
 *
 * Choosing this side is the whole sign-in: the two hard-coded logins are
 * `student` and `prof`, and nothing is typed here. A browser that already
 * has a student (from joining a class or starting work) sees that student's
 * classes and the next five things due across them. Every other class is
 * listed under Other classes; opening one is where a student joins it. A
 * browser with no student yet sees all classes in that second list.
 *
 * Everything shown was created by a person: a class by a professor, an
 * enrollment by the student. If there are no classes, the page says so and
 * does not make one.
 */
export default function Home() {
  const [all, setAll] = useState<CourseListItem[] | null>(null);
  const [mine, setMine] = useState<MyCourses | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Set when a named student profile is chosen in the header. That student's
  // portal shows their own classes only, the way a real student's would; the
  // list of other classes to join is for a browser with no profile.
  const [profile, setProfile] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const studentId = browser.studentId();
    Promise.all([
      api.courses(),
      // A stored id the database no longer knows reads as "no student yet", not as an error.
      studentId ? api.myCourses(studentId).catch(() => null) : Promise.resolve(null),
    ])
      .then(([c, m]) => {
        if (!live) return;
        setProfile(browser.studentProfile());
        setAll(c.courses);
        setMine(m);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setAll([]);
        setProblem(e instanceof ApiError && e.code === "database_unavailable" ? "The database is not connected." : "Margin is not reachable.");
      });
    return () => {
      live = false;
    };
  }, []);

  const joined = new Set((mine?.courses ?? []).map((c) => c.id));
  const others = (all ?? []).filter((c) => !joined.has(c.id));

  return (
    <div className="flex flex-col gap-10 pt-2">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-margin-red">The AI tutor your professor approves of</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">{profile ? `${profile.split(" ")[0]}'s courses` : "My courses"}</h1>
          <p className="mt-3 text-lg leading-7 text-muted">Open a class and start the assignment. Write your own attempt, then ask. Margin will not give you the answer.</p>
        </div>
        <NextLink href="/prof/courses" className="shrink-0 text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">
          I teach
        </NextLink>
      </header>

      {all === null ? (
        <div className="flex justify-center py-10">
          <Spinner aria-label="Loading" />
        </div>
      ) : problem ? (
        <p className="text-lg text-muted">{problem}</p>
      ) : (
        <>
          {mine && mine.courses.length > 0 ? (
            <>
              <section aria-labelledby="due-soon-heading">
                <h2 id="due-soon-heading" className="mb-3 font-serif text-2xl font-semibold tracking-tight">
                  Due soon
                </h2>
                <AssignmentList items={mine.due_soon} showCourse empty="Nothing is due in your classes." />
              </section>
              <section aria-labelledby="my-courses-heading">
                <h2 id="my-courses-heading" className="mb-3 font-serif text-2xl font-semibold tracking-tight">
                  Your classes
                </h2>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {mine.courses.map((c, i) => (
                    <CourseCardLink key={c.id} course={c} href={`/course/${c.id}`} index={i} badge={<DueBadge count={c.due_this_week} />} />
                  ))}
                </ul>
              </section>
            </>
          ) : null}

          {profile ? null : (
          <section aria-labelledby="other-courses-heading">
            <h2 id="other-courses-heading" className="mb-1 font-serif text-2xl font-semibold tracking-tight">
              {mine && mine.courses.length > 0 ? "Other classes" : "Classes"}
            </h2>
            <p className="mb-3 text-muted">Open a class to join it.</p>
            {others.length === 0 ? (
              <p className="text-muted">{all.length === 0 ? "No class has been created yet." : "You are in every class."}</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {others.map((c, i) => (
                  <CourseCardLink key={c.id} course={c} href={`/course/${c.id}`} index={i}>
                    <p className="text-sm text-muted">{workLine(c.assignments, c.lessons)}</p>
                  </CourseCardLink>
                ))}
              </ul>
            )}
          </section>
          )}
          {profile && (!mine || mine.courses.length === 0) ? <p className="text-lg text-muted">{profile} is not in a class yet.</p> : null}
        </>
      )}

      <p className="text-sm text-muted">CS50&rsquo;s rule is, if you use AI, use ours. Margin is that rule for every course.</p>
    </div>
  );
}

/** The line under a class name. Zero of a kind is left off, so a class with one assignment does not also say it has no lessons. */
function workLine(assignments: number, lessons: number): string {
  const parts: string[] = [];
  if (assignments > 0) parts.push(`${assignments} ${assignments === 1 ? "assignment" : "assignments"}`);
  if (lessons > 0) parts.push(`${lessons} ${lessons === 1 ? "lesson" : "lessons"}`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing posted yet";
}
