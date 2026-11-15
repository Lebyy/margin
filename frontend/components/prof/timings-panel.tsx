"use client";

import { Alert, Button, Card, Chip, Spinner, Table } from "@heroui/react";
import { memo, useMemo, useState } from "react";
import type { Timings } from "@/lib/api";

/** Rows drawn at first, and added per "Show more". Each row is 22 table cells, so a class of 200 drawn at once was 3,700 cells. */
const ROWS_PER_PAGE = 24;

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
 * Speed, measured on a class of 200: this table was most of the page's 9,000
 * elements, and it was rebuilt on every keystroke in the search and every
 * drawer opened, freezing the page for one to three seconds. Now the
 * dashboard loads the data with everything else and passes it in; the panel
 * is memoized, so it redraws only when the data or the filter changes; the
 * filter arrives as one stable Set; and rows are drawn 24 at a time.
 *
 * `timings` is undefined while loading and null when the request failed.
 * `studentIds` is the dashboard's student filter: when set, only those
 * students' rows are shown, so one filter narrows the whole page.
 */
export const TimingsPanel = memo(function TimingsPanel({ timings, studentIds = null }: { timings: Timings | null | undefined; studentIds?: Set<string> | null }) {
  const [rows, setRows] = useState(ROWS_PER_PAGE);
  const shown = useMemo(() => (timings && studentIds ? { ...timings, sessions: timings.sessions.filter((s) => studentIds.has(s.student_id)) } : timings), [timings, studentIds]);
  // A new filter starts from the first page again, so the count under the table always describes what matches.
  const [seenFilter, setSeenFilter] = useState(studentIds);
  if (seenFilter !== studentIds) {
    setSeenFilter(studentIds);
    setRows(ROWS_PER_PAGE);
  }

  return (
    <Card aria-label="Time per question">
      <Card.Header>
        <Card.Title>Time per question</Card.Title>
        <Card.Description>From opening a question to pressing Next or Finish. Students are told this is shared. Use it to see which question is hard, not to rank anyone.</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {timings === undefined ? (
          <div className="flex items-center gap-2 py-6 text-muted">
            <Spinner size="sm" /> Loading times
          </div>
        ) : !shown ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>The times could not be loaded.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : shown.sessions.length === 0 ? (
          <p className="py-4 text-muted">{studentIds ? "No student matches these filters." : "Nobody has started yet."}</p>
        ) : (
          <>
            <TimingsTable questions={shown.questions} sessions={shown.sessions.slice(0, rows)} />
            {shown.sessions.length > rows ? (
              <Button variant="secondary" className="self-center" onPress={() => setRows((n) => n + ROWS_PER_PAGE)}>
                Show {Math.min(ROWS_PER_PAGE, shown.sessions.length - rows)} more of {shown.sessions.length - rows}
              </Button>
            ) : null}
          </>
        )}
      </Card.Content>
    </Card>
  );
});

/** The table of seconds per question. Look-back answers are in each student's Open work drawer, after the last question. */
function TimingsTable({ questions, sessions }: { questions: Timings["questions"]; sessions: Timings["sessions"] }) {
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
