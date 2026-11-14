"use client";

import { Alert, Chip, Disclosure, Spinner } from "@heroui/react";
import { FileText } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Shelf } from "@/components/course-shelf";
import { Discussion } from "@/components/discussion";
import { Paper } from "@/components/paper";
import { api, type Course } from "@/lib/api";

/**
 * One class, as a student opens it.
 *
 * Assignments come first, because that is the work a student opened the class
 * to do. Lessons follow, then what the professor has handed out. Everything
 * here was saved by a professor. The files are shown as the text that was
 * stored for them, which is the same text Margin searches when it points a
 * student to the notes.
 */
export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .course(id)
      .then((c) => live && setCourse(c))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id]);

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

  const lessons = course.items.filter((a) => a.kind === "topic");
  const work = course.items.filter((a) => a.kind !== "topic");

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="font-serif text-5xl font-semibold tracking-tight">{course.name}</h1>
        {course.professor ? <p className="mt-2 text-muted">Taught by {course.professor}</p> : null}
        {course.description ? <p className="mt-3 max-w-3xl text-xl leading-8 text-muted">{course.description}</p> : null}
        <p className="mt-4 max-w-2xl text-muted">Open an assignment, write your attempt, and ask. Margin reads what you wrote and will not write it for you.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {work.length > 0 ? <Chip variant="soft" color="accent">{work.length} {work.length === 1 ? "assignment" : "assignments"}</Chip> : null}
          {lessons.length > 0 ? <Chip variant="soft" color="success">{lessons.length} {lessons.length === 1 ? "lesson" : "lessons"}</Chip> : null}
          {course.materials.length > 0 ? <Chip variant="soft">{course.materials.length} {course.materials.length === 1 ? "handout" : "handouts"}</Chip> : null}
        </div>
      </header>

      <Shelf title="Assignments" items={work} />
      <Shelf title="Learn" items={lessons} />
      {course.items.length === 0 ? <p className="text-lg text-muted">Nothing has been posted in this class yet.</p> : null}

      {course.notes || course.materials.length > 0 ? (
        <section aria-label="From your professor">
          <h2 className="mb-4 font-serif text-3xl font-semibold tracking-tight">From your professor</h2>
          <div className="flex flex-col gap-3">
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
          </div>
        </section>
      ) : null}

      <Discussion courseId={course.id} role="student" />
    </div>
  );
}
