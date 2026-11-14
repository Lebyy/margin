"use client";

import { Chip } from "@heroui/react";
import { AlertCircle, ChevronRight, Sparkles } from "lucide-react";
import NextLink from "next/link";
import type { AssignmentListItem } from "@/lib/api";
import { exactDue, relativeDue, STATUS_LABEL } from "@/lib/courses";
import { KIND } from "@/lib/kinds";
import { cn } from "@/lib/utils";

/**
 * A class's work as a list, in the order the server sends it (nearest due
 * first, undated last).
 *
 * Each row is one link to the assignment page and shows the title, the kind,
 * the due date in words with the exact time on hover (a native title, since a
 * focusable tooltip trigger inside the row link would nest one control in
 * another) and in text for a screen reader, the student's status, and whether Margin is on for it.
 * Overdue work the student has not submitted is marked in red with an icon
 * and the word "overdue", so it is not carried by colour alone.
 * `showCourse` adds the class name, for the Due soon list across classes.
 */
export function AssignmentList({ items, showCourse = false, empty }: { items: AssignmentListItem[]; showCourse?: boolean; empty: string }) {
  if (items.length === 0) return <p className="py-4 text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border">
      {items.map((a) => {
        const due = a.due_at ? relativeDue(a.due_at) : null;
        const overdue = !!due?.overdue && a.status !== "submitted";
        const kind = KIND[a.kind];
        return (
          <li key={a.id}>
            <NextLink href={`/student/assignment/${a.id}`} className="group flex items-center gap-3 px-4 py-3 outline-offset-[-2px] hover:bg-default">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{a.title}</span>
                  {a.margin_enabled !== false && a.kind !== "topic" ? (
                    <Chip size="sm" variant="soft" color="accent">
                      <Sparkles className="size-3" aria-hidden /> Margin available
                    </Chip>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  {showCourse ? <span>{a.course_name}</span> : <span>{kind.name}</span>}
                  {a.due_at && due ? (
                    <time dateTime={a.due_at} title={exactDue(a.due_at)} className={cn("inline-flex items-center gap-1", overdue && "font-medium text-danger")}>
                      {overdue ? <AlertCircle className="size-3.5" aria-hidden /> : null}
                      {due.text}
                      <span className="sr-only">, {exactDue(a.due_at)}</span>
                    </time>
                  ) : (
                    <span>No due date</span>
                  )}
                </div>
              </div>
              {a.status && a.kind !== "topic" ? (
                <Chip size="sm" variant={a.status === "not_started" ? "secondary" : "soft"} color={a.status === "submitted" ? "success" : a.status === "in_progress" ? "warning" : "default"}>
                  {STATUS_LABEL[a.status]}
                </Chip>
              ) : null}
              <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
            </NextLink>
          </li>
        );
      })}
    </ul>
  );
}
