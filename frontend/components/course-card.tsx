"use client";

import { Card, Chip } from "@heroui/react";
import { motion } from "motion/react";
import NextLink from "next/link";
import type { ReactNode } from "react";
import type { CourseCard as CourseCardData } from "@/lib/api";
import { ACCENT_BG } from "@/lib/courses";
import { cn } from "@/lib/utils";

/**
 * One class on a My courses grid, for a student or a professor.
 *
 * The whole card is one link. The band across the top is the class's accent
 * token, the same one that rules the course page's header, so a student can
 * find the class by colour as well as by name; the code and title are always
 * printed too, so colour never carries the meaning alone. `badge` is the
 * student's "N due this week"; `children` is whatever a side adds under the
 * title (the professor's weakest concept). Cards rise in turn as the grid
 * loads, and appear in place under reduced motion (MotionConfig, providers.tsx).
 */
export function CourseCardLink({ course, href, index, badge, children }: { course: CourseCardData; href: string; index: number; badge?: ReactNode; children?: ReactNode }) {
  return (
    <motion.li initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * 0.05, duration: 0.25 }}>
      <NextLink href={href} className="group block h-full rounded-2xl outline-offset-4">
        <Card className="h-full overflow-hidden p-0 transition-transform group-hover:-translate-y-1">
          <div className={cn("h-2 w-full", ACCENT_BG[course.accent])} aria-hidden />
          <div className="flex flex-1 flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{course.code || "Class"}</p>
              {badge}
            </div>
            <h3 className="font-serif text-2xl font-semibold leading-8 tracking-tight">{course.name}</h3>
            <p className="text-sm text-muted">{[course.professor, course.term].filter(Boolean).join(" · ") || " "}</p>
            {children}
          </div>
        </Card>
      </NextLink>
    </motion.li>
  );
}

/** The student's "N due this week" badge. Nothing is shown at zero, so a quiet class stays quiet. */
export function DueBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Chip size="sm" variant="soft" color="warning">
      {count} due this week
    </Chip>
  );
}
