"use client";

import { Alert, Spinner } from "@heroui/react";
import { ChevronRight } from "lucide-react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AssignmentBuilder } from "@/components/prof/assignment-builder";
import { ChooseProfessor } from "@/components/prof/choose-professor";
import { useWorkspace } from "@/components/workspace/student-shell";
import { api, type Assignment, type ProfCourseCard } from "@/lib/api";
import { browser } from "@/lib/browser";
import { ACCENT_BG } from "@/lib/courses";
import { cn } from "@/lib/utils";

/**
 * A new assignment, or edits to one, in a class.
 *
 * The class comes from the assignment being edited, else ?course_id=, else
 * the professor picks one of theirs. The form itself is the assignment
 * builder (components/prof/assignment-builder.tsx): questions and an optional
 * key from any file or typed text, read into a typeset preview the professor
 * can correct, then posted. The same builder is offered from a class's chat.
 */
export default function SetupPage() {
  const router = useRouter();
  const { refresh } = useWorkspace();
  const [courses, setCourses] = useState<ProfCourseCard[] | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [editing, setEditing] = useState<(Assignment & { has_answer_key: boolean }) | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams(window.location.search);
    const assignmentId = params.get("assignment");
    Promise.all([api.profCourses(), assignmentId ? api.profAssignment(assignmentId) : Promise.resolve(null)])
      .then(([all, a]) => {
        if (!live) return;
        const me = browser.profProfile();
        setProfile(me);
        const mine = all.courses.filter((c) => !me || c.professor === me);
        setCourses(mine);
        const cid = a?.course_id ?? params.get("course_id") ?? null;
        setCourseId(cid && mine.some((c) => c.id === cid) ? cid : null);
        setEditing(a);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return (
      <Alert status="danger" className="mx-auto mt-10 max-w-xl">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>This page could not be loaded.</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }
  if (courses === null) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner aria-label="Opening" />
      </div>
    );
  }
  if (!profile) return <ChooseProfessor />;

  const course = courses.find((c) => c.id === courseId) ?? null;

  if (!course) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header>
          <h1 className="font-serif text-4xl font-semibold tracking-tight">New assignment</h1>
          <p className="mt-2 text-muted">Which class is it for?</p>
        </header>
        {courses.length === 0 ? (
          <p className="text-muted">
            You have no classes yet.{" "}
            <NextLink href="/prof/courses" className="text-accent underline underline-offset-2">
              Create one
            </NextLink>{" "}
            first.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/70 border-y border-border/70">
            {courses.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setCourseId(c.id)} className="group flex w-full items-center gap-3 rounded-lg px-2 py-3.5 text-left hover:bg-default/60">
                  <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", ACCENT_BG[c.accent])} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-sm text-muted">{[c.code, c.term].filter(Boolean).join(" · ")}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden className={cn("size-2.5 rounded-full", ACCENT_BG[course.accent])} />
          <NextLink href={`/prof/courses/${course.id}`} className="hover:text-foreground">
            {course.code || course.name}
          </NextLink>
        </p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight">{editing ? `Edit ${editing.title}` : "New assignment"}</h1>
        <p className="text-muted">Students see the questions. Only the guard reads the answer key.</p>
      </header>
      <AssignmentBuilder
        courseId={course.id}
        courseName={course.name}
        initial={editing ? { id: editing.id, title: editing.title, due_at: editing.due_at ?? null, margin_enabled: editing.margin_enabled !== false, has_questions: true } : null}
        onSaved={(id) => {
          browser.setProfAssignmentId(id);
          refresh();
          router.push(`/prof/dashboard?assignment=${id}`);
        }}
      />
    </div>
  );
}
