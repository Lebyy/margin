"use client";

import { Button, Spinner, TextArea, TextField, Tooltip } from "@heroui/react";
import { ArrowUp, ChartColumn, FileText, PanelRight, RefreshCw, Search, Shapes, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavButton } from "@/components/workspace/student-shell";
import { Markdown } from "@/components/workspace/markdown";
import { api, ApiError, type AnalystNames, type AnalystTurn } from "@/lib/api";
import { AskretesMark } from "@/components/brand/askretes-mark";

/** What each analyst tool is called in the professor's words, for the line above an answer. */
const TOOL: Record<string, { label: string; icon: ReactNode }> = {
  class_overview: { label: "Read the class overview", icon: <ChartColumn className="size-3.5" /> },
  list_students: { label: "Listed students", icon: <Users className="size-3.5" /> },
  student_work: { label: "Read a student's work", icon: <Search className="size-3.5" /> },
  canvas_and_files: { label: "Read canvas and file work", icon: <Shapes className="size-3.5" /> },
  assignment: { label: "Read the assignment", icon: <FileText className="size-3.5" /> },
};

/** Questions a professor can ask with one press. Each is sent as typed. */
const STARTERS = ["Where is the class stuck, and what should I reteach?", "Which students have not started yet?", "What did Askretes mark on students' canvases?", "Summarise S1's work so far."];

/**
 * The professor's conversation with Askretes about one assignment.
 *
 * The answers come from the class data: the analyst calls tools that read the
 * same records the dashboard shows (backend analyst.ts), and the line above
 * each answer says which it read. Students reach the model only as labels
 * (S1, S2, ...); this page swaps each label for the student's name, as a link
 * that opens their transcript, using the map the server sends. The dashboard
 * stays beside the chat, so a number in an answer can be checked against it.
 * Every question and answer is kept, so the conversation is here next time.
 */
export function AnalystChat({
  assignmentId,
  title,
  classLabel,
  paneOpen,
  onTogglePane,
  onRefresh,
  onOpenStudent,
}: {
  assignmentId: string;
  title: string;
  classLabel: string;
  paneOpen: boolean;
  onTogglePane: () => void;
  onRefresh: () => void;
  onOpenStudent: (studentId: string) => void;
}) {
  const [turns, setTurns] = useState<AnalystTurn[] | null>(null);
  const [names, setNames] = useState<AnalystNames>({});
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    api
      .analystHistory(assignmentId)
      .then((h) => {
        if (!live) return;
        setTurns(h.messages);
        setNames(h.names);
      })
      .catch(() => live && setTurns([]));
    return () => {
      live = false;
    };
  }, [assignmentId]);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [turns?.length, sending]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    setSending(true);
    setError(null);
    setQuestion("");
    setTurns((prev) => [...(prev ?? []), { role: "professor", content: q, tool_calls: [] }]);
    try {
      const r = await api.askAnalyst(assignmentId, q);
      setNames(r.names);
      setTurns((prev) => [...(prev ?? []), { role: "analyst", content: r.reply, tool_calls: r.tool_calls }]);
    } catch (e) {
      setTurns((prev) => (prev ?? []).slice(0, -1));
      setQuestion(q);
      setError(e instanceof ApiError && e.code === "analyst_unavailable" ? "Askretes could not answer just now. Try again." : "Not sent. Try again.");
    } finally {
      setSending(false);
    }
  }

  /** The analyst's labels as names: "S12" becomes a link with the student's name that opens their transcript. Only labels in the map are replaced. */
  const withNames = (text: string) => text.replace(/\bS(\d{1,4})\b/g, (whole) => (names[whole] ? `[${names[whole].name.replace(/[[\]]/g, "")}](app:student:${names[whole].id})` : whole));

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="Ask Askretes about your class">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
        <NavButton />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <span className="shrink-0 text-muted">{classLabel}</span>
          <span className="text-muted" aria-hidden>
            /
          </span>
          <h1 className="truncate font-medium">{title}</h1>
        </div>
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Refresh the class data" onPress={onRefresh}>
            <RefreshCw className="size-4" />
          </Button>
          <Tooltip.Content>Refresh</Tooltip.Content>
        </Tooltip>
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label={paneOpen ? "Close the dashboard" : "Open the dashboard"} aria-pressed={paneOpen} onPress={onTogglePane}>
            <PanelRight className="size-4" />
          </Button>
          <Tooltip.Content>{paneOpen ? "Close the dashboard" : "Dashboard"}</Tooltip.Content>
        </Tooltip>
      </header>

      <div ref={thread} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-8 pt-4 sm:px-6" aria-live="polite">
          {turns === null ? (
            <div className="flex justify-center py-16">
              <Spinner aria-label="Loading the conversation" />
            </div>
          ) : turns.length === 0 && !sending ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <p className="font-serif text-3xl tracking-tight">What do you want to know about your class?</p>
              <p className="max-w-md text-muted">Askretes reads the same data as the dashboard and shows you what it read. Formative, never a grade.</p>
              <div className="mt-3 flex max-w-xl flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <Button key={s} size="sm" variant="secondary" className="h-auto whitespace-normal py-1.5 text-left" onPress={() => void ask(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {turns.map((t, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                  {t.role === "professor" ? (
                    <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-default px-4 py-2.5 text-[15px] leading-6">
                      <p className="whitespace-pre-wrap">{t.content}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {t.tool_calls.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {[...new Map(t.tool_calls.map((c) => [c.name === "student_work" ? `${c.name}:${String(c.args.student)}` : c.name, c])).values()].map((c, j) => (
                            <span key={j} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted">
                              {TOOL[c.name]?.icon}
                              {c.name === "student_work" && typeof c.args.student === "string" && names[c.args.student.toUpperCase()]
                                ? `Read ${names[c.args.student.toUpperCase()].name}'s work`
                                : (TOOL[c.name]?.label ?? c.name)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="font-serif text-[17px] leading-7">
                        <Markdown text={withNames(t.content)} onAppLink={(target) => target.startsWith("student:") && onOpenStudent(target.slice(8))} />
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          )}
          {sending ? (
            <p className="flex items-center gap-2.5 text-sm text-muted" role="status">
              <AskretesMark thinking className="size-7" /> Reading the class data
            </p>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 px-3 pb-3 sm:px-6 sm:pb-4">
        <form
          className="mx-auto flex w-full max-w-3xl flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <div className="rounded-3xl border border-border bg-surface shadow-[0_1px_2px_oklch(0.2_0.02_60/0.04),0_6px_20px_-8px_oklch(0.2_0.02_60/0.12)] transition-colors focus-within:border-foreground/25">
            <TextField value={question} onChange={setQuestion} isDisabled={sending} fullWidth aria-label="Ask Askretes about your class">
              <TextArea
                rows={1}
                placeholder="Ask who is stuck, on what, and why"
                className="max-h-48 min-h-12 resize-none border-0 bg-transparent px-4 pt-3.5 text-[15px] leading-6 shadow-none outline-none focus:ring-0"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(question);
                  }
                }}
              />
            </TextField>
            <div className="flex items-center px-2 pb-2">
              <Button type="submit" isIconOnly size="sm" variant="primary" className="ml-auto rounded-full" aria-label="Send" isDisabled={sending || !question.trim()}>
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
          {error ? <p className="px-2 text-sm text-danger">{error}</p> : null}
          <p className="text-center text-xs text-muted">Askretes is AI and can make mistakes.</p>
        </form>
      </div>
    </section>
  );
}
