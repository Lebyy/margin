"use client";

import { Avatar, Button, Chip } from "@heroui/react";
import { ArrowRight } from "lucide-react";
import { memo } from "react";
import { duration } from "@/components/prof/timings-panel";
import { conceptLabel, STRUGGLE_LABEL, type CourseAccent, type StudentSummary } from "@/lib/api";
import { ACCENT_BG } from "@/lib/courses";
import { cn } from "@/lib/utils";

/** The class this card is issued by: its strip colour and the line across the top. */
export type CardIssuer = { code: string; term: string; accent: CourseAccent } | null;

const STATUS_LABEL: Record<StudentSummary["status"], string> = { not_started: "Not started", in_progress: "In progress", finished: "Finished" };

/**
 * One student, drawn like a university ID card: the class's colour strip and
 * code across the top, a portrait box with a generic silhouette, the name and
 * a card number beside it, then the three lines and the average time.
 *
 * The picture is always the silhouette. Askretes stores no photo of anyone, and
 * would not want to: the dashboard is formative, and a face beside struggle
 * labels is the surveillance feel the product avoids. The card number is the
 * last six characters of Askretes' own student id, shown so two students with
 * the same name can be told apart; it is not a university ID.
 */
export const StudentIdCard = memo(function StudentIdCard({ student, issuer, onOpen }: { student: StudentSummary; issuer: CardIssuer; onOpen: (student: StudentSummary) => void }) {
  const cardNumber = student.student_id.slice(-6).toUpperCase();
  return (
    <article aria-label={`${student.display_name}, student card`} className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
      <div className={cn("h-1.5 w-full", issuer ? ACCENT_BG[issuer.accent] : "bg-default")} aria-hidden />
      <div className="flex items-center justify-between px-3.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        <span>{issuer ? [issuer.code, issuer.term].filter(Boolean).join(" · ") : "Class"}</span>
        <span>Student ID</span>
      </div>

      <div className="flex gap-3 px-3.5 pt-2.5">
        <Avatar className="h-[5.5rem] w-[4.25rem] shrink-0 rounded-md" color="default">
          <Avatar.Fallback className="rounded-md bg-default">
            <Silhouette />
          </Avatar.Fallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate font-serif text-lg font-semibold leading-6">{student.display_name}</p>
          <p className="font-mono text-xs tracking-wider text-muted">ID {cardNumber}</p>
          <Chip size="sm" variant="soft" className="self-start" color={student.status === "finished" ? "success" : student.status === "in_progress" ? "accent" : "default"}>
            {STATUS_LABEL[student.status]}
          </Chip>
        </div>
      </div>

      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-y-1 px-3.5 pt-3 text-sm">
        <dt className="text-muted">Concept</dt>
        <dd>{student.concept ? conceptLabel(student.concept) : "no turns yet"}</dd>
        <dt className="text-muted">Struggle</dt>
        <dd>{student.concept ? STRUGGLE_LABEL[student.struggle_type] : "no turns yet"}</dd>
        <dt className="text-muted">Last hint</dt>
        <dd>{student.last_hint_level ? `level ${student.last_hint_level}` : "none yet"}</dd>
        <dt className="text-muted">Avg time</dt>
        <dd className="tabular-nums">{student.average_seconds === null ? "no question finished" : `${duration(student.average_seconds)} per question · ${student.questions_done} done`}</dd>
      </dl>

      <div className="mt-auto flex items-end justify-between gap-3 px-3.5 pb-3 pt-3">
        {/* Enabled with no turns too: a student who never messaged still has their time on each question. Not started has nothing to open. */}
        <Button size="sm" variant="ghost" onPress={() => onOpen(student)} isDisabled={student.status === "not_started"}>
          Open work <ArrowRight className="size-3.5" aria-hidden />
        </Button>
        <Barcode seed={student.student_id} />
      </div>
    </article>
  );
});

/** A generic head-and-shoulders, like a profile with no picture. Drawn in the muted token so it reads as "no photo", not as a person. */
function Silhouette() {
  return (
    <svg viewBox="0 0 68 88" className="h-full w-full text-muted/45" aria-hidden>
      <circle cx="34" cy="31" r="15" fill="currentColor" />
      <path d="M4 88c0-21 13.5-33 30-33s30 12 30 33z" fill="currentColor" />
    </svg>
  );
}

/** Decoration only: bar widths read from the student id, so each card's strip differs and stays the same across reloads. */
function Barcode({ seed }: { seed: string }) {
  const bars = seed
    .slice(-12)
    .split("")
    .map((c) => (parseInt(c, 16) % 3) + 1);
  return (
    <div className="flex h-6 items-stretch gap-[2px] opacity-60" aria-hidden>
      {bars.map((w, i) => (
        <span key={i} className="bg-foreground" style={{ width: w }} />
      ))}
    </div>
  );
}
