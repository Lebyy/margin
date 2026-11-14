"use client";

import { Card, Spinner } from "@heroui/react";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import NextLink from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError, type CourseListItem } from "@/lib/api";

/**
 * The student's front door.
 *
 * The classes are the page. A card is one link, and opening it is the whole
 * sign-in: the two hard-coded logins are the words `student` and `prof`,
 * there is no password, and nothing is typed here. Teaching is a separate
 * link, because this screen is for the person doing the work.
 *
 * The cards are the classes professors have created, read from the API on
 * load. A class opens to its assignments and its lessons. If there are none,
 * the page says so. It does not create one to fill the gap.
 */
export default function Home() {
  const [items, setItems] = useState<CourseListItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .courses()
      .then((r) => live && setItems(r.courses))
      .catch((e: unknown) => {
        if (!live) return;
        setItems([]);
        setProblem(e instanceof ApiError && e.code === "database_unavailable" ? "The database is not connected." : "Margin is not reachable.");
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8 pt-2">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-margin-red">The AI tutor your professor approves of</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">Your classes</h1>
          <p className="mt-3 text-lg leading-7 text-muted">Open a class and start the assignment. Write your own attempt, then ask. Margin will not give you the answer.</p>
        </div>
        <NextLink href="/prof/courses" className="shrink-0 text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">
          I teach
        </NextLink>
      </header>

      {items === null ? (
        <div className="flex justify-center py-10">
          <Spinner aria-label="Loading" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-lg text-muted">{problem ?? "Nothing has been posted yet."}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c, i) => (
            <motion.li key={c.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.05, duration: 0.25 }}>
              <NextLink href={`/course/${c.id}`} className="group block h-full rounded-2xl outline-offset-4">
                <Card className="h-full transition-transform group-hover:-translate-y-1">
                  <Card.Header>
                    <Card.Title className="font-serif text-2xl leading-8">{c.name}</Card.Title>
                    {c.professor ? <p className="text-sm text-muted">{c.professor}</p> : null}
                    {c.description ? <Card.Description>{c.description}</Card.Description> : null}
                  </Card.Header>
                  <Card.Content>
                    <p className="text-sm text-muted">{workLine(c.assignments, c.lessons)}</p>
                  </Card.Content>
                  <Card.Footer>
                    <span className="inline-flex items-center gap-1 text-sm font-medium">
                      Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </Card.Footer>
                </Card>
              </NextLink>
            </motion.li>
          ))}
        </ul>
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
