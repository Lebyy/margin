"use client";

import { Card, Chip } from "@heroui/react";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import NextLink from "next/link";
import { conceptLabel, type AssignmentListItem } from "@/lib/api";
import { KIND } from "@/lib/kinds";

/**
 * One group of cards for things a student can open: assignments, or lessons.
 *
 * The whole card is the link. A separate Open button was a second target on a card the student had already chosen. Each card shows its kind and the concepts it is about, and opens that item's workspace.
 */
export function Shelf({ title, items }: { title: string; items: AssignmentListItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="mb-4 font-serif text-3xl font-semibold tracking-tight">{title}</h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a, i) => {
          const kind = KIND[a.kind];
          const Icon = kind.icon;
          return (
            <motion.li key={a.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.05, duration: 0.25 }}>
              <NextLink href={`/student/assignment/${a.id}`} className="group block h-full rounded-2xl outline-offset-4">
                <Card className="h-full transition-transform group-hover:-translate-y-1">
                  <Card.Header>
                    <Chip size="sm" variant="soft" color={kind.color} className="self-start">
                      <Icon className="size-3.5" aria-hidden /> {kind.name}
                    </Chip>
                    <Card.Title className="mt-2 font-serif text-xl leading-7">{a.title}</Card.Title>
                  </Card.Header>
                  <Card.Content>
                    <div className="flex flex-wrap gap-1.5">
                      {a.concepts.slice(0, 4).map((c) => (
                        <Chip key={c} size="sm" variant="soft">
                          {conceptLabel(c)}
                        </Chip>
                      ))}
                    </div>
                  </Card.Content>
                  <Card.Footer>
                    <span className="inline-flex items-center gap-1 text-sm font-medium">
                      {a.kind === "topic" ? "Start learning" : "Start"} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </Card.Footer>
                </Card>
              </NextLink>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}
