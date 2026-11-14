"use client";

import { Alert, Button, Card, Chip, Spinner } from "@heroui/react";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { motion } from "motion/react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Paper } from "@/components/paper";
import { useAssignment } from "@/components/prof/use-assignment";
import { api, type ProfessorMessage } from "@/lib/api";

/**
 * The professor's messages: one for every Thursday card that was generated.
 *
 * Each message is the text the server stored when a card was made: the
 * weakest concept, the percent that code counted, and the three practice
 * problems. This page prints the stored body. It does not call the model and
 * does not rebuild the text, so the percent here is the percent on that card.
 *
 * Before any card exists the page says so and points at the dashboard, where
 * a card is generated. It does not offer to write a message about nothing.
 */
export default function MessagesPage() {
  const pick = useAssignment();
  const assignmentId = pick.state === "ready" ? pick.assignmentId : null;
  // The result is kept with the assignment it belongs to, so messages loaded for one assignment are never shown under another's title.
  const [loadedFor, setLoadedFor] = useState<{ id: string; messages: ProfessorMessage[] | null } | null>(null);
  const current = loadedFor && loadedFor.id === assignmentId ? loadedFor : null;
  const messages = current?.messages ?? null;
  const failed = current !== null && current.messages === null;

  useEffect(() => {
    if (!assignmentId) return;
    let live = true;
    api
      .profMessages(assignmentId)
      .then((r) => live && setLoadedFor({ id: assignmentId, messages: r.messages }))
      .catch(() => live && setLoadedFor({ id: assignmentId, messages: null }));
    return () => {
      live = false;
    };
  }, [assignmentId]);

  const title = pick.state === "ready" ? pick.assignments.find((a) => a.id === pick.assignmentId)?.title : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Paper as="div" aria-label="Messages">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight">Messages</h1>
            <p className="mt-1 text-muted">
              Each Thursday card is also sent to you as a message.{title ? ` These are for “${title}”.` : ""}
            </p>
          </div>
          <NextLink href="/prof/dashboard" className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm text-muted hover:bg-default hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden /> Dashboard
          </NextLink>
        </div>
      </Paper>

      {pick.state === "loading" || (assignmentId && messages === null && !failed) ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted">
          <Spinner size="sm" /> Loading messages
        </div>
      ) : pick.state === "error" || failed ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{pick.state === "error" ? pick.message : "The messages could not be loaded."}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : pick.state === "none" ? (
        <EmptyMessages text="There is no assignment yet. Create one on the setup page, and have a student start a session." href="/prof/setup" action="Go to setup" />
      ) : messages && messages.length === 0 ? (
        <EmptyMessages text="No message yet. A message is written when you generate a Thursday card on the dashboard." href="/prof/dashboard" action="Go to the dashboard" />
      ) : (
        <section aria-labelledby="messages-list-heading">
        {/* Each message's title is HeroUI's Card.Title, which is always an h3. This
            h2 sits between it and the page's h1, so a screen reader's heading list
            does not skip a level (axe heading-order, D-R6). It is read, not shown. */}
        <h2 id="messages-list-heading" className="sr-only">
          Messages, newest first
        </h2>
        <ol className="flex flex-col gap-4">
          {(messages ?? []).map((m, i) => (
            <motion.li key={m.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 6) * 0.05, duration: 0.25 }}>
              <MessageCard message={m} newest={i === 0} />
            </motion.li>
          ))}
        </ol>
        </section>
      )}
    </div>
  );
}

/**
 * One stored message.
 * The body's first line is the card's title, the second is the headline with the percent, and the numbered lines are the practice problems. They are split for layout only. Every word shown is from the stored body.
 */
function MessageCard({ message, newest }: { message: ProfessorMessage; newest: boolean }) {
  const lines = message.body.split("\n");
  const [title, headline, ...rest] = lines;
  return (
    <Card>
      <Card.Header>
        <div className="flex flex-wrap items-center gap-2">
          <MessageSquareText className="size-4 text-margin-red" aria-hidden />
          <Card.Title>{title}</Card.Title>
          {newest ? (
            <Chip size="sm" variant="soft" color="accent">
              newest
            </Chip>
          ) : null}
          <time className="ml-auto text-xs text-muted" dateTime={message.created_at}>
            {new Date(message.created_at).toLocaleString()}
          </time>
        </div>
      </Card.Header>
      <Card.Content>
        <p className="font-serif text-lg leading-7">{headline}</p>
        <div className="mt-2 flex flex-col gap-1 text-sm leading-6 text-muted">
          {rest.map((line, i) => (
            <p key={i} className={/^\d+\./.test(line) ? "pl-4 text-foreground" : line === "Practice problems:" ? "mt-2 font-medium text-foreground" : ""}>
              {line}
            </p>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}

/** The state before any message exists. It names the one step that produces a message and links to it. */
function EmptyMessages({ text, href, action }: { text: string; href: string; action: string }) {
  const router = useRouter();
  return (
    <Card>
      <Card.Content className="flex flex-col items-start gap-3 py-8">
        <p className="text-muted">{text}</p>
        <Button variant="secondary" onPress={() => router.push(href)}>
          {action}
        </Button>
      </Card.Content>
    </Card>
  );
}
