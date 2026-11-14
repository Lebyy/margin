"use client";

import { Button, Card, Chip, Spinner } from "@heroui/react";
import { ArrowRight, GraduationCap } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HighlightText } from "@/components/animate-ui/primitives/texts/highlight";
import { api, ApiError, type CourseListItem } from "@/lib/api";

/**
 * The home page: what Margin is, then everything a student can open.
 *
 * Choosing a card is the whole sign-in. The two hard-coded logins are the
 * words `student` and `prof`, there is no password, and nothing is typed.
 *
 * The cards are the classes professors have created, read from the API on
 * load. A class opens to its lessons, its assignments, and its handouts. If
 * there are none, the page says so. It does not create one to fill the gap.
 */
export default function Home() {
  const router = useRouter();
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
    <div className="flex flex-col gap-12 pt-8 sm:pt-14">
      <section className="mx-auto max-w-3xl text-center" aria-label="What Margin is">
        <Chip variant="soft" color="danger" className="mb-5">
          The AI tutor your professor approves of
        </Chip>
        <h1 className="font-serif text-6xl font-semibold tracking-tight sm:text-7xl">
          Use AI.{" "}
          <HighlightText text="Do your own work." className="rounded-lg bg-linear-to-r from-margin-red-soft to-margin-red-soft px-2 text-margin-red" transition={{ duration: 0.9, ease: "easeInOut" }} delay={250} />
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-xl leading-8 text-muted">
          Paste the attempt, find the mistake, never get the answer. And your professor sees what the class does not understand.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Button size="lg" variant="secondary" onPress={() => router.push("/prof/courses")}>
            <GraduationCap className="size-5" aria-hidden /> I teach
          </Button>
          {items && items.length > 0 ? (
            <Button size="lg" variant="ghost" onPress={() => router.push("/prof/dashboard")}>
              Class dashboard <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      </section>

      {items === null ? (
        <div className="flex justify-center py-10">
          <Spinner aria-label="Loading" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-center text-lg text-muted">{problem ?? "Nothing has been posted yet."}</p>
      ) : (
        <section aria-label="Your classes">
          <h2 className="mb-4 font-serif text-3xl font-semibold tracking-tight">Your classes</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c, i) => (
              <motion.li key={c.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.05, duration: 0.25 }} whileHover={{ y: -4 }}>
                <Card className="h-full">
                  <Card.Header>
                    <Card.Title className="font-serif text-2xl leading-8">{c.name}</Card.Title>
                    {c.description ? <Card.Description>{c.description}</Card.Description> : null}
                  </Card.Header>
                  <Card.Content className="flex gap-2">
                    <Chip size="sm" variant="soft" color="success">{c.lessons} to learn</Chip>
                    <Chip size="sm" variant="soft" color="accent">{c.assignments} to do</Chip>
                  </Card.Content>
                  <Card.Footer>
                    <Button variant="primary" onPress={() => router.push(`/course/${c.id}`)}>
                      Enter <ArrowRight className="size-4" aria-hidden />
                    </Button>
                  </Card.Footer>
                </Card>
              </motion.li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-center text-sm text-muted">CS50&rsquo;s rule is, if you use AI, use ours. Margin is that rule for every course.</p>
    </div>
  );
}
