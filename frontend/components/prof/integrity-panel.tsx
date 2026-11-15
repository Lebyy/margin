"use client";

import { Button, Chip, Label, Spinner, Switch } from "@heroui/react";
import { ChevronDown, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { duration } from "@/components/prof/timings-panel";
import { api, type IntegrityReport, type IntegrityRow } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The integrity tab of the professor's dashboard: how each student's work was
 * produced, read from the review in backend/src/integrity.ts.
 *
 * It is built so a professor cannot mistake a signal for a verdict:
 *  - Evidence first, then "worth a look", then everyone else folded away.
 *  - Every pattern carries its innocent explanation, in the same row.
 *  - The time on each question sits beside the class median, so "fast" is
 *    always shown against something.
 *  - The accommodation switch is on the student's row, for students who use
 *    dictation or assistive input; it hides typing signals and keeps the copy trap.
 * Nothing here is shown to the student, and nothing here grades them.
 */
export function IntegrityPanel({ assignmentId, onOpenStudent }: { assignmentId: string; onOpenStudent: (studentId: string) => void }) {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [showClear, setShowClear] = useState(false);

  const load = useCallback(() => {
    api
      .integrity(assignmentId)
      .then((r) => {
        setReport(r);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [assignmentId]);
  useEffect(() => {
    load();
  }, [load]);

  if (failed) return <p className="py-6 text-muted">The integrity review could not be read. Refresh to try again.</p>;
  if (!report) {
    return (
      <div className="flex justify-center py-10">
        <Spinner aria-label="Reading the integrity review" />
      </div>
    );
  }

  const evidence = report.students.filter((s) => s.level === "evidence");
  const look = report.students.filter((s) => s.level === "worth_a_look");
  const clear = report.students.filter((s) => s.level === "clear");
  const described = report.students.filter((s) => s.described > 0).length;

  return (
    <div className="flex flex-col gap-5 pb-4">
      <p className="text-sm text-muted">
        How the work was produced. <span className="text-foreground">Evidence</span> is something ordinary work cannot produce; <span className="text-foreground">worth a look</span> means independent signals agree on one question. Neither is a verdict. Talk with the student first.
      </p>

      <div className="grid grid-cols-3 gap-2">
        <Tally icon={<ShieldAlert className="size-4 text-danger" />} value={evidence.length} label="evidence" />
        <Tally icon={<ShieldQuestion className="size-4 text-warning" />} value={look.length} label="worth a look" />
        <Tally icon={<ShieldCheck className="size-4 text-margin-green" />} value={clear.length} label="clear" />
      </div>
      <p className="-mt-3 text-xs text-muted">
        Typing was recorded for {described} of {report.students.length} students. Work sent before this was turned on, or by voice, has no typing record and is only checked for the copy trap and time.
      </p>

      <section aria-label="Class time per question">
        <h3 className="mb-1.5 text-sm font-medium">Class median time per question</h3>
        <div className="flex flex-wrap gap-1.5">
          {report.class_median_seconds.map((s, i) => (
            <Chip key={i} size="sm" variant="soft">
              <span className="tabular-nums">
                Q{i + 1} {s == null ? "–" : duration(s)}
              </span>
            </Chip>
          ))}
        </div>
      </section>

      {[...evidence, ...look].length === 0 ? (
        <p className="rounded-xl border border-border px-4 py-5 text-sm text-muted">Nothing to review. No student has evidence or agreeing signals.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {[...evidence, ...look].map((row) => (
            <StudentReview key={row.session_id} row={row} medians={report.class_median_seconds} onOpenStudent={onOpenStudent} onChanged={load} />
          ))}
        </ul>
      )}

      {clear.length ? (
        <section>
          <Button size="sm" variant="ghost" className="px-1 text-muted" onPress={() => setShowClear(!showClear)} aria-expanded={showClear}>
            <ChevronDown className={cn("size-4 transition-transform", showClear && "rotate-180")} aria-hidden /> {clear.length} students clear
          </Button>
          {showClear ? (
            <ul className="mt-2 flex flex-col gap-3">
              {clear.map((row) => (
                <StudentReview key={row.session_id} row={row} medians={report.class_median_seconds} onOpenStudent={onOpenStudent} onChanged={load} />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Tally({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="font-serif text-2xl font-semibold tabular-nums">{value}</span>
      </div>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

/** One student: their level, each finding with its innocent explanation, their time per question against the class, and the accommodation switch. */
function StudentReview({ row, medians, onOpenStudent, onChanged }: { row: IntegrityRow; medians: (number | null)[]; onOpenStudent: (id: string) => void; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const total = row.seconds.reduce<number>((a, s) => a + (s ?? 0), 0);
  const away = row.activity.reduce((a, q) => a + q.away_ms, 0);
  const leaves = row.activity.reduce((a, q) => a + q.away_count, 0);
  const pastes = row.activity.reduce((a, q) => a + q.paste_blocked, 0);
  const copies = row.activity.reduce((a, q) => a + q.copies, 0);

  async function toggle(next: boolean) {
    setSaving(true);
    try {
      await api.setIntegrityExempt(row.session_id, next);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className={cn("rounded-xl border bg-surface p-3.5", row.level === "evidence" ? "border-danger/40" : row.level === "worth_a_look" ? "border-warning/50" : "border-border")}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" className="h-auto px-1 font-medium" onPress={() => onOpenStudent(row.student_id)}>
          {row.display_name || "Student"}
        </Button>
        {row.level === "evidence" ? (
          <Chip size="sm" color="danger" variant="soft">
            Evidence
          </Chip>
        ) : row.level === "worth_a_look" ? (
          <Chip size="sm" color="warning" variant="soft">
            Worth a look
          </Chip>
        ) : null}
        {row.exempt ? (
          <Chip size="sm" variant="soft">
            Accommodation on
          </Chip>
        ) : null}
        <span className="ml-auto text-xs tabular-nums text-muted">
          {total ? duration(total) : "no finished questions"}
          {row.completed ? " · submitted" : ""}
        </span>
      </div>

      {row.findings.length ? (
        <ul className="mt-2.5 flex flex-col gap-2">
          {row.findings.map((f, i) => (
            <li key={i} className="text-sm">
              <p>
                <span className={cn("mr-1.5 text-xs font-semibold uppercase tracking-wide", f.strength === "evidence" ? "text-danger" : "text-muted")}>{f.strength === "evidence" ? "Evidence" : "Signal"}</span>
                {f.question_index !== null ? <span className="mr-1 text-muted">Q{f.question_index + 1}.</span> : null}
                {f.detail}
              </p>
              {f.innocent ? <p className="mt-0.5 text-xs text-muted">Could also be: {f.innocent}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Time per question against the class median, so a fast question is always read against something. */}
      <div className="mt-3 flex flex-wrap gap-1">
        {row.seconds.map((s, i) => {
          const m = medians[i];
          const fast = s != null && m != null && s < m * 0.2;
          return (
            <span key={i} title={m != null ? `Class median ${duration(m)}` : undefined} className={cn("rounded-md px-1.5 py-0.5 text-xs tabular-nums", fast ? "bg-warning/15 text-foreground" : "bg-default/60 text-muted")}>
              Q{i + 1} {s == null ? "–" : duration(s)}
            </span>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">
        Away from the page {duration(Math.round(away / 1000))} ({leaves} {leaves === 1 ? "time" : "times"}) · {pastes} {pastes === 1 ? "paste" : "pastes"} stopped · question copied {copies} {copies === 1 ? "time" : "times"} · {row.described} of {row.messages} messages with a typing record
      </p>

      <Switch className="mt-2.5" isSelected={row.exempt} isDisabled={saving} onChange={(v) => void toggle(v)}>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <Switch.Content>
          <Label className="text-xs">Uses dictation or assistive input (hide typing signals)</Label>
        </Switch.Content>
      </Switch>
    </li>
  );
}
