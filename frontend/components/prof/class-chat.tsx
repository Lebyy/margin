"use client";

import { Button, Chip, Spinner, TextArea, TextField, Tooltip } from "@heroui/react";
import { ArrowUp, ChartColumn, FilePlus2, ListChecks, PanelRight, Paperclip, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { fileToBase64 } from "@/components/workspace/attachments";
import { Markdown } from "@/components/workspace/markdown";
import { NavButton } from "@/components/workspace/student-shell";
import { api, ApiError, type ClassChatDraft, type ClassChatTurn } from "@/lib/api";
import { AskretesMark } from "@/components/brand/askretes-mark";

/** Files the chat takes with one message: the same kinds the assignment builder reads. */
const CHAT_ACCEPT = ".pdf,.docx,.pptx,.xlsx,.csv,.md,.markdown,.txt,.tex,.png,.jpg,.jpeg,.webp,.gif,.zip";
const MAX_FILES = 3;
const MAX_TOTAL = 7 * 1024 * 1024;

const STARTERS = ["Make a new assignment from the files I attach", "How is the class doing across assignments?", "Which assignment is the class finding hardest?"];

/**
 * The class's chat with Askretes, in the middle of the class workspace.
 *
 * The professor can ask about the class as a whole, or ask for an
 * assignment: attach the questions (and the key, if they have it) as any
 * files, or paste them, and say the title and due date. Askretes drafts it with
 * a tool (backend class-assistant.ts) and answers with a card: how many
 * questions it read, whether each has an answer. "Review and post" opens the
 * draft in the assignment builder beside the chat. Nothing is posted until
 * the professor posts it there.
 */
export function ClassChat({ courseId, title, paneOpen, onTogglePane, onReview }: { courseId: string; title: string; paneOpen: boolean; onTogglePane: () => void; onReview: (draft: ClassChatDraft) => void }) {
  const [turns, setTurns] = useState<(ClassChatTurn & { files?: string[] })[] | null>(null);
  const [question, setQuestion] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    api
      .classChat(courseId)
      .then((h) => live && setTurns(h.messages))
      .catch(() => live && setTurns([]));
    return () => {
      live = false;
    };
  }, [courseId]);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [turns?.length, sending]);

  function addFiles(list: FileList | File[]) {
    const next = [...files, ...Array.from(list)].slice(0, MAX_FILES);
    if (next.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) {
      setError("Up to 7 MB of files per message.");
      return;
    }
    setError(null);
    setFiles(next);
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    const sentFiles = files;
    setSending(true);
    setError(null);
    setQuestion("");
    setFiles([]);
    setTurns((prev) => [...(prev ?? []), { role: "professor", content: q, tool_calls: [], draft: null, files: sentFiles.map((f) => f.name) }]);
    try {
      const encoded = await Promise.all(sentFiles.map(async (f) => ({ name: f.name, base64: await fileToBase64(f) })));
      const r = await api.askClass(courseId, q, encoded);
      setTurns((prev) => [...(prev ?? []), { role: "analyst", content: r.reply, tool_calls: r.tool_calls, draft: r.draft }]);
      // A fresh draft opens straight in the builder, so the professor sees the questions at once.
      if (r.draft) onReview(r.draft);
    } catch (e) {
      setTurns((prev) => (prev ?? []).slice(0, -1));
      setQuestion(q);
      setFiles(sentFiles);
      setError(e instanceof ApiError && e.detail ? e.detail : "Askretes could not answer just now. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label={`Askretes for ${title}`}>
      <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
        <NavButton />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label={paneOpen ? "Close the class panel" : "Open the class panel"} aria-pressed={paneOpen} onPress={onTogglePane}>
            <PanelRight className="size-4" />
          </Button>
          <Tooltip.Content>{paneOpen ? "Close the panel" : "Class panel"}</Tooltip.Content>
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
              <p className="font-serif text-3xl tracking-tight">What do you need for {title}?</p>
              <p className="max-w-md text-muted">Ask about the class, or attach a problem set (any file, even handwriting) and say &ldquo;make this an assignment due Friday&rdquo;.</p>
              <div className="mt-3 flex max-w-xl flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <Button key={s} size="sm" variant="secondary" className="h-auto whitespace-normal py-1.5" onPress={() => (s.startsWith("Make") ? picker.current?.click() : void ask(s))}>
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
                    <div className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1.5">
                      {t.files?.length ? (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {t.files.map((f) => (
                            <span key={f} className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs">
                              <Paperclip className="size-3" aria-hidden /> {f}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="rounded-2xl bg-default px-4 py-2.5 text-[15px] leading-6">
                        <p className="whitespace-pre-wrap">{t.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {t.tool_calls.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {[...new Set(t.tool_calls.map((c) => c.name))].map((n) => (
                            <span key={n} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted">
                              {n === "draft_assignment" ? <FilePlus2 className="size-3.5" /> : <ChartColumn className="size-3.5" />}
                              {n === "draft_assignment" ? "Drafted an assignment" : "Read the class"}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="font-serif text-[17px] leading-7">
                        <Markdown text={t.content} />
                      </div>
                      {t.draft ? <DraftCard draft={t.draft} onReview={() => onReview(t.draft as ClassChatDraft)} /> : null}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          )}
          {sending ? (
            <p className="flex items-center gap-2.5 text-sm text-muted" role="status">
              <AskretesMark thinking className="size-7" /> {files.length ? "Reading your files" : "Working"}
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
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
        >
          <div className="rounded-3xl border border-border bg-surface shadow-[0_1px_2px_oklch(0.2_0.02_60/0.04),0_6px_20px_-8px_oklch(0.2_0.02_60/0.12)] transition-colors focus-within:border-foreground/25">
            {files.length ? (
              <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                {files.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-lg border border-border bg-paper py-1 pl-2 pr-1 text-xs">
                    <Paperclip className="size-3" aria-hidden /> <span className="max-w-48 truncate">{f.name}</span>
                    <Button isIconOnly size="sm" variant="ghost" className="size-5 min-w-5" aria-label={`Remove ${f.name}`} onPress={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                      <X className="size-3" />
                    </Button>
                  </span>
                ))}
              </div>
            ) : null}
            <TextField value={question} onChange={setQuestion} isDisabled={sending} fullWidth aria-label={`Message Askretes about ${title}`}>
              <TextArea
                rows={1}
                placeholder={files.length ? "Title, due date, which file is the key" : "Ask, or attach files to make an assignment"}
                className="max-h-48 min-h-12 resize-none border-0 bg-transparent px-4 pt-3.5 text-[15px] leading-6 shadow-none outline-none focus:ring-0"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(question);
                  }
                }}
              />
            </TextField>
            <div className="flex items-center gap-1 px-2 pb-2">
              <Tooltip delay={300}>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Attach files" onPress={() => picker.current?.click()} isDisabled={sending || files.length >= MAX_FILES}>
                  <Paperclip className="size-4" />
                </Button>
                <Tooltip.Content>Attach files (up to 3)</Tooltip.Content>
              </Tooltip>
              <input
                ref={picker}
                type="file"
                multiple
                accept={CHAT_ACCEPT}
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
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

/** The draft an answer made: what was read, and the button that opens it in the builder. */
function DraftCard({ draft, onReview }: { draft: ClassChatDraft; onReview: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-2">
        <ListChecks className="size-4 text-margin-red" aria-hidden />
        <p className="min-w-0 flex-1 truncate font-medium">{draft.title}</p>
        <Chip size="sm" variant="soft">
          Draft
        </Chip>
      </div>
      <p className="text-sm text-muted">
        {draft.questions.length} {draft.questions.length === 1 ? "question" : "questions"}
        {draft.missing_answers ? ` · ${draft.missing_answers} without an answer` : " · every question has an answer"}
        {draft.due_at ? ` · due ${new Date(draft.due_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
      </p>
      <Button size="sm" variant="primary" className="self-start" onPress={onReview}>
        Review and post
      </Button>
    </div>
  );
}
