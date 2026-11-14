"use client";

import { Button, Card, Chip, Spinner } from "@heroui/react";
import { ArrowRight, GraduationCap, PencilLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HighlightText } from "@/components/animate-ui/primitives/texts/highlight";
import { Paper } from "@/components/paper";
import { api, ApiError, type AssignmentListItem } from "@/lib/api";

/**
 * The home page: the name, the one line, and two ways in.
 *
 * Choosing a side is the whole sign-in. The two hard-coded logins are the
 * words `student` and `prof`, there is no password, and nothing is typed.
 *
 * The student button goes to the newest assignment a professor saved. That
 * list is read from the API on load. If it is empty, the button is disabled
 * and the page says why, because the only way an assignment exists is that
 * someone saved the setup form. This page does not create one to fill the gap.
 */
export default function Home() {
  const router = useRouter();
  const [assignments, setAssignments] = useState<AssignmentListItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .listAssignments()
      .then((r) => live && setAssignments(r.assignments))
      .catch((e: unknown) => {
        if (!live) return;
        setAssignments([]);
        setProblem(
          e instanceof ApiError && e.code === "database_unavailable"
            ? "The API is running without a database. Set MONGODB_URI in .env and restart."
            : "The API is not answering on localhost:4000. Start it with npm run dev.",
        );
      });
    return () => {
      live = false;
    };
  }, []);

  const latest = assignments?.[0] ?? null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 pt-6 sm:pt-12">
      <Paper as="div" className="py-8 sm:py-10" aria-label="What Margin is">
        <h1 className="font-serif text-5xl font-semibold tracking-tight sm:text-6xl">Margin</h1>
        <p className="mt-3 text-lg text-muted">The AI tutor your professor approves of.</p>
        <p className="mt-6 max-w-2xl font-serif text-xl leading-9 sm:text-2xl sm:leading-10">
          Paste the attempt, find the mistake,{" "}
          <HighlightText
            text="never get the answer."
            className="rounded bg-linear-to-r from-margin-red-soft to-margin-red-soft px-1 text-margin-red"
            transition={{ duration: 0.9, ease: "easeInOut" }}
            delay={250}
          />{" "}
          And your professor sees what the class does not understand.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Chip variant="soft" size="sm">1 · one question</Chip>
          <Chip variant="soft" size="sm">2 · your professor&rsquo;s slide</Chip>
          <Chip variant="soft" size="sm">3 · a different worked example</Chip>
          <Chip variant="soft" size="sm" color="danger">never the solution</Chip>
        </div>
      </Paper>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <Card.Header>
            <div className="flex items-center gap-2">
              <PencilLine className="size-5 text-margin-red" aria-hidden />
              <Card.Title>Student</Card.Title>
            </div>
            <Card.Description>
              Get a hint on your own work. The hint changes after you show a real try.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            {assignments === null ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Spinner size="sm" /> Looking for your assignment
              </div>
            ) : latest ? (
              <p className="text-sm text-muted">
                {latest.course_name} · <span className="text-foreground">{latest.title}</span>
              </p>
            ) : (
              <p className="text-sm text-muted">
                {problem ?? "No assignment has been posted yet. A professor creates one from the setup page."}
              </p>
            )}
          </Card.Content>
          <Card.Footer>
            <Button
              variant="primary"
              isDisabled={!latest}
              onPress={() => latest && router.push(`/student/assignment/${latest.id}`)}
            >
              Enter as student <ArrowRight className="size-4" aria-hidden />
            </Button>
          </Card.Footer>
        </Card>

        <Card>
          <Card.Header>
            <div className="flex items-center gap-2">
              <GraduationCap className="size-5 text-margin-red" aria-hidden />
              <Card.Title>Professor</Card.Title>
            </div>
            <Card.Description>
              Set up an assignment, then see which concept the class is stuck on and what to reteach.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <p className="text-sm text-muted">
              Class patterns first. An individual student only when you open one. Formative, never a grade.
            </p>
          </Card.Content>
          <Card.Footer className="flex gap-2">
            <Button variant="secondary" onPress={() => router.push("/prof/setup")}>
              Enter as prof <ArrowRight className="size-4" aria-hidden />
            </Button>
            {latest ? (
              <Button variant="ghost" onPress={() => router.push("/prof/dashboard")}>
                Dashboard
              </Button>
            ) : null}
          </Card.Footer>
        </Card>
      </div>

      <p className="text-center text-sm text-muted">
        CS50&rsquo;s rule is, if you use AI, use ours. Margin is that rule for every course.
      </p>
    </div>
  );
}
