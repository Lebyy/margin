"use client";

import { Button, ScrollShadow, Spinner } from "@heroui/react";
import { BookOpen, ChevronRight, Circle, CircleCheck, CircleDot, House } from "lucide-react";
import NextLink from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ProfileMenu } from "@/components/profile-menu";
import type { AssignmentListItem, Course, CourseListItem } from "@/lib/api";
import { ACCENT_BG, relativeDue, STATUS_LABEL } from "@/lib/courses";
import { cn } from "@/lib/utils";
import { AskretesWordmark } from "@/components/brand/askretes-mark";

/** What the workspace frame loaded for the sidebar. Every row in it is a class a professor made or an assignment a professor posted. */
export type SidebarData = {
  /** The named student profile chosen in the menu, or null. With a profile, only that student's own classes are listed, the way a real student's portal is. */
  profile: string | null;
  /** The classes this student is in, each with its assignments and this student's status on them. */
  mine: Course[];
  /** How many assignments are due this week, per class, as the server counted them. */
  dueThisWeek: Record<string, number>;
  /** Every class this student is not in. Opening one is where they join it. */
  others: CourseListItem[];
  problem: string | null;
};

/**
 * The class list: a home link, the student's classes with their assignments
 * folded under each, and the classes they could join.
 *
 * A class row is a link to the class, with a separate button beside it that
 * opens or closes its assignments. They are two controls and not one,
 * because a row that both navigated and toggled would do one of those things
 * by surprise. The class the student is in right now opens on its own, so
 * the conversation they are reading is always visible in the list.
 *
 * An assignment's mark says where the student is with it: an empty circle
 * for not started, a dotted one for in progress, a check for submitted, and
 * a book for a lesson, which has nothing to submit. The same words are in
 * the row's accessible name, so the mark is never the only carrier.
 */
export function ClassSidebar({ data, pathname, action }: { data: SidebarData | null; pathname: string; action?: ReactNode }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Open the class that holds the page on screen: the class itself, or the class an open assignment belongs to.
  const currentCourse = data ? findCurrentCourse(data.mine, pathname) : null;
  useEffect(() => {
    if (!currentCourse) return;
    const id = window.setTimeout(() => setOpen((prev) => (prev.has(currentCourse) ? prev : new Set(prev).add(currentCourse))), 0);
    return () => window.clearTimeout(id);
  }, [currentCourse]);

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <NextLink href="/" className="flex items-center gap-2 rounded-md outline-offset-4" aria-label="Askretes, home">
          <AskretesWordmark className="text-[1.375rem]" />
        </NextLink>
        <span className="ml-auto" />
        {action}
      </div>

      <ScrollShadow className="min-h-0 flex-1 px-2 pb-4" hideScrollBar>
        <nav aria-label="Your classes" className="flex flex-col gap-5">
          <NextLink href="/" aria-current={pathname === "/" ? "page" : undefined} className={rowClass(pathname === "/")}>
            <House className="size-4 shrink-0 text-muted" aria-hidden /> Home
          </NextLink>

          {data === null ? (
            <div className="flex justify-center py-6">
              <Spinner size="sm" aria-label="Loading your classes" />
            </div>
          ) : data.problem ? (
            <p className="px-3 text-sm text-muted">{data.problem}</p>
          ) : (
            <>
              <section aria-labelledby="sidebar-mine">
                <h2 id="sidebar-mine" className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted">
                  Classes
                </h2>
                {data.mine.length === 0 ? (
                  <p className="px-3 text-sm text-muted">{data.profile ? `${data.profile} is not in a class yet.` : "Join a class to see it here."}</p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {data.mine.map((c) => (
                      <ClassRow key={c.id} course={c} due={data.dueThisWeek[c.id] ?? 0} isOpen={open.has(c.id)} onToggle={() => toggle(c.id)} pathname={pathname} />
                    ))}
                  </ul>
                )}
              </section>

              {data.profile || data.others.length === 0 ? null : (
                <section aria-labelledby="sidebar-others">
                  <h2 id="sidebar-others" className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    {data.mine.length > 0 ? "Other classes" : "Join a class"}
                  </h2>
                  <ul className="flex flex-col gap-0.5">
                    {data.others.map((c) => {
                      const href = `/course/${c.id}`;
                      return (
                        <li key={c.id}>
                          <NextLink href={href} aria-current={pathname === href ? "page" : undefined} className={rowClass(pathname === href)}>
                            <span aria-hidden className={cn("size-2 shrink-0 rounded-full opacity-60", ACCENT_BG[c.accent])} />
                            <span className="truncate text-muted">{c.code || c.name}</span>
                          </NextLink>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </nav>
      </ScrollShadow>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2.5">
        <ProfileMenu side="student" placement="top start" />
        <NextLink href="/prof/courses" className="ml-auto shrink-0 rounded-md px-2 py-1 text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">
          I teach
        </NextLink>
      </div>
    </>
  );
}

/** One class and, when open, its assignments as conversations. */
function ClassRow({ course, due, isOpen, onToggle, pathname }: { course: Course; due: number; isOpen: boolean; onToggle: () => void; pathname: string }) {
  const href = `/course/${course.id}`;
  const listId = `sidebar-class-${course.id}`;
  return (
    <li>
      <div className="flex items-center gap-0.5">
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={`${isOpen ? "Hide" : "Show"} assignments in ${course.name}`}
          aria-expanded={isOpen}
          aria-controls={listId}
          onPress={onToggle}
          className="shrink-0"
        >
          <ChevronRight className={cn("size-3.5 text-muted transition-transform", isOpen && "rotate-90")} />
        </Button>
        <NextLink href={href} aria-current={pathname === href ? "page" : undefined} className={cn(rowClass(pathname === href), "min-w-0 flex-1 pl-1.5")} title={course.name}>
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", ACCENT_BG[course.accent])} />
          <span className="min-w-0 flex-1 truncate">
            {course.code ? <span className="font-medium">{course.code}</span> : null}
            <span className={course.code ? "ml-1.5 text-muted" : "font-medium"}>{course.code ? shortName(course.name, course.code) : course.name}</span>
          </span>
          {due > 0 ? (
            <span className="shrink-0 rounded-full bg-margin-red-soft px-1.5 text-xs font-medium tabular-nums text-margin-red" aria-label={`${due} due this week`}>
              {due}
            </span>
          ) : null}
        </NextLink>
      </div>
      {isOpen ? (
        <ul id={listId} className="mb-1 ml-[1.15rem] flex flex-col gap-0.5 border-l border-border pl-2">
          {course.items.length === 0 ? (
            <li className="px-3 py-1.5 text-sm text-muted">Nothing posted yet</li>
          ) : (
            course.items.map((a) => <AssignmentRow key={a.id} item={a} pathname={pathname} />)
          )}
        </ul>
      ) : null}
    </li>
  );
}

/** One assignment: its status mark, its title, and how soon it is due. */
function AssignmentRow({ item, pathname }: { item: AssignmentListItem; pathname: string }) {
  const href = `/student/assignment/${item.id}`;
  const active = pathname === href;
  const isLesson = item.kind === "topic";
  const status = item.status ?? "not_started";
  const due = item.due_at ? relativeDue(item.due_at) : null;
  const overdue = !!due?.overdue && status !== "submitted";
  const Mark = isLesson ? BookOpen : status === "submitted" ? CircleCheck : status === "in_progress" ? CircleDot : Circle;
  const said = isLesson ? "Lesson" : STATUS_LABEL[status];
  return (
    <li>
      <NextLink href={href} aria-current={active ? "page" : undefined} className={cn(rowClass(active), "py-1.5")}>
        <Mark
          aria-hidden
          className={cn("size-3.5 shrink-0", status === "submitted" && !isLesson ? "text-margin-green" : status === "in_progress" && !isLesson ? "text-margin-red" : "text-muted")}
        />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        <span className="sr-only">, {said}</span>
        {due && status !== "submitted" && !isLesson ? (
          <span className={cn("shrink-0 text-xs", overdue ? "font-medium text-danger" : "text-muted")}>{compactDue(due.text)}</span>
        ) : null}
      </NextLink>
    </li>
  );
}

/** The look of every row in the list. The current page is marked with a filled row and, for a screen reader, with aria-current on the link. */
function rowClass(active: boolean): string {
  return cn(
    "flex min-h-8 items-center gap-2 rounded-lg px-3 py-1 text-sm outline-offset-[-2px] transition-colors",
    active ? "bg-default font-medium text-foreground" : "text-foreground/90 hover:bg-default/70",
  );
}

/** "due in 3 days" reads as "3d", "due tomorrow" as "tmrw", so the title keeps the width. The full words are on the assignment page. */
function compactDue(text: string): string {
  if (text === "due today") return "today";
  if (text === "due tomorrow") return "tmrw";
  const inDays = text.match(/^due in (\d+) days$/);
  if (inDays) return `${inDays[1]}d`;
  if (text.includes("overdue")) return "late";
  return text;
}

/** "CS 251: Data Structures" with its code already shown reads as "Data Structures". */
function shortName(name: string, code: string): string {
  const stripped = name.startsWith(code) ? name.slice(code.length).replace(/^[\s:–-]+/, "") : name;
  return stripped || name;
}

/** The class that holds the page on screen, or null for the home page and a class the student is not in. */
function findCurrentCourse(mine: Course[], pathname: string): string | null {
  const course = pathname.match(/^\/course\/([^/]+)/)?.[1];
  if (course) return mine.some((c) => c.id === course) ? course : null;
  const assignment = pathname.match(/^\/student\/assignment\/([^/]+)/)?.[1];
  if (assignment) return mine.find((c) => c.items.some((a) => a.id === assignment))?.id ?? null;
  return null;
}
