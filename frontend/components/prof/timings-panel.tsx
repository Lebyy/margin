"use client";

import { Alert, Card, Chip, Spinner, Table } from "@heroui/react";
import { useEffect, useState } from "react";
import { api, type Timings } from "@/lib/api";

/**
 * Time per question. (Each student's look-back answers moved to their Open work drawer, where the name search reaches them.)
 *
 * One row per session (a student who started twice has two rows), with the
 * seconds each question took from the server's clock. The page formats the
 * numbers and computes none: a question still open, or never reached, comes
 * back as null and is shown as a dash or "working", never as a running time.
 * Students are told their time per question is shared with the professor, and
 * the header says what the numbers are for, so the table reads as feedback on
 * where the assignment is hard, not a ranking. Rows are in the order the
 * server sends (newest first), not sorted by speed.
 *
 * It reads `/api/prof/timings`, which is a database read, so opening the
 * dashboard calls no model. `version` is the dashboard's refresh counter.
 * `studentIds` is the dashboard's student filter: when set, only those
 * students' rows and look-back answers are shown, so one filter narrows the
 * whole page.
 */
export function TimingsPanel({ assignmentId, version, studentIds = null }: { assignmentId: string; version: number; studentIds?: Set<string> | null }) {
  const [data, setData] = useState<{ id: string; timings: Timings | null } | null>(null);

  useEffect(() => {
    let live = true;
    api
      .timings(assignmentId)
      .then((t) => live && setData({ id: assignmentId, timings: t }))
      .catch(() => live && setData({ id: assignmentId, timings: null }));
    return () => {
      live = false;
    };
  }, [assignmentId, version]);

  // Data loaded for a different assignment is never shown under this one's title.
  const current = data && data.id === assignmentId ? data : null;

  return (
    <Card aria-label="Time per question">
      <Card.Header>
        <Card.Title>Time per question</Card.Title>
        <Card.Description>From opening a question to pressing Next or Finish. Students are told this is shared. Use it to see which question is hard, not to rank anyone.</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {!current ? (
          <div className="flex items-center gap-2 py-6 text-muted">
            <Spinner size="sm" /> Loading times
          </div>
        ) : !current.timings ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>The times could not be loaded.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : current.timings.sessions.length === 0 ? (
          <p className="py-4 text-muted">Nobody has started yet.</p>
        ) : (
          <TimingsTable
            timings={studentIds ? { ...current.timings, sessions: current.timings.sessions.filter((s) => studentIds.has(s.student_id)) } : current.timings}
          />
        )}
      </Card.Content>
    </Card>
  );
}

/** The table of seconds per question. Look-back answers are in each student's Open work drawer, after the last question. */
function TimingsTable({ timings }: { timings: Timings }) {
  const { questions, sessions } = timings;
  return (
    <>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Seconds each student spent on each question">
            <Table.Header>
              <Table.Column isRowHeader>Student</Table.Column>
              {questions.map((prompt, i) => (
                <Table.Column key={i}>
                  <span title={prompt}>Q{i + 1}</span>
                </Table.Column>
              ))}
              <Table.Column>Total</Table.Column>
            </Table.Header>
            <Table.Body>
              {sessions.map((s) => (
                <Table.Row key={s.session_id} id={s.session_id}>
                  <Table.Cell>
                    <span className="font-medium">{s.display_name}</span>
                    {s.completed_at ? null : (
                      <Chip size="sm" variant="soft" className="ml-2">
                        on Q{s.current_question + 1}
                      </Chip>
                    )}
                  </Table.Cell>
                  {s.seconds.map((n, i) => (
                    <Table.Cell key={i}>
                      <span className="tabular-nums">{n !== null ? duration(n) : i === s.current_question && !s.completed_at ? <span className="text-muted">working</span> : <span className="text-muted" aria-label="not reached">–</span>}</span>
                    </Table.Cell>
                  ))}
                  <Table.Cell>
                    <span className="tabular-nums font-medium">{s.total_seconds !== null ? duration(s.total_seconds) : <span className="font-normal text-muted">–</span>}</span>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </>
  );
}


/** Seconds as "4m 12s", "45s", or "1h 3m". Formatting only; the number is the server's. Shared by the timing table, the student cards, and the work drawer, so one time reads the same everywhere. */
export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
