"use client";

import { Button, Card, Chip } from "@heroui/react";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { conceptLabel, type AssignmentListItem } from "@/lib/api";
import { KIND } from "@/lib/kinds";

/**
 * One group of cards for things a student can open: assignments, or lessons.
 * Each card shows its kind, and the concepts it is about, and opens that item's workspace. It is used on a class page, where the group is one class's work.
 */
export function Shelf({ title, items }: { title: string; items: AssignmentListItem[] }) {
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="mb-4 font-serif text-3xl font-semibold tracking-tight">{title}</h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a, i) => {
          const kind = KIND[a.kind];
          const Icon = kind.icon;
          return (
            <motion.li key={a.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.05, duration: 0.25 }} whileHover={{ y: -4 }}>
              <Card className="h-full">
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
                  <Button variant="primary" onPress={() => router.push(`/student/assignment/${a.id}`)}>
                    {a.kind === "topic" ? "Start learning" : "Open"} <ArrowRight className="size-4" aria-hidden />
                  </Button>
                </Card.Footer>
              </Card>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}
