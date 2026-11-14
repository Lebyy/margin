// Shared pieces of the course portal: accent classes, due dates, status words.

import type { AssignmentStatus, CourseAccent } from "@/lib/api";

/**
 * The Tailwind classes for each course accent, written out in full so the
 * compiler finds them. A course stores the name; only this map turns it into
 * a token, so no page ever writes a colour value for a class.
 */
export const ACCENT_BG: Record<CourseAccent, string> = {
  red: "bg-course-red",
  blue: "bg-course-blue",
  green: "bg-course-green",
  amber: "bg-course-amber",
  teal: "bg-course-teal",
  slate: "bg-course-slate",
};

export const STATUS_LABEL: Record<AssignmentStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * "due in 2 days", "due today", "due tomorrow", "2 days overdue". Counted in
 * calendar days in the viewer's time zone, so "tomorrow" means what the
 * student expects at 11 PM. A submitted assignment is never called overdue.
 */
export function relativeDue(iso: string, now = new Date()): { text: string; overdue: boolean } {
  const due = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(due) - startOf(now)) / DAY);
  if (due.getTime() < now.getTime()) {
    const late = Math.max(0, -days);
    return { text: late === 0 ? "overdue today" : late === 1 ? "1 day overdue" : `${late} days overdue`, overdue: true };
  }
  if (days === 0) return { text: "due today", overdue: false };
  if (days === 1) return { text: "due tomorrow", overdue: false };
  return { text: `due in ${days} days`, overdue: false };
}

/** The exact due time, for the tooltip next to a relative date. */
export function exactDue(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "PHYS 101" when a code is set, otherwise the class name. Used in breadcrumbs, where the name can be long. */
export function courseShortName(c: { code: string; name: string }): string {
  return c.code || c.name;
}
