"use client";

import { FileText, PenLine, Presentation, Search, Shapes, Sigma } from "lucide-react";
import type { ReactNode } from "react";
import { RichReply } from "@/components/workspace/rich-reply";
import type { TranscriptTurn } from "@/lib/api";

type Call = NonNullable<TranscriptTurn["tool_calls"]>[number];

/**
 * What Askretes' tools did on one turn, in the professor's transcript, said in
 * words: what it searched for and found, what it drew and with which items,
 * what it circled and the note it left, what it wrote (a formula typeset),
 * and which slide it opened. The canvas itself is drawn above this list from
 * the stored board, so this is the account of each step, not a dump of the
 * tool's arguments.
 *
 * These are the released draft's calls only: a draft the guard held is stored
 * nowhere, so its calls are not here either. Everything is printed as text.
 */
export function ToolCalls({ calls }: { calls: Call[] }) {
  if (calls.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1.5 rounded-md border border-border bg-surface/70 px-3 py-2 text-sm">
      {calls.map((c, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-0.5 shrink-0 text-muted">{iconFor(c.name)}</span>
          <span className="min-w-0">{describe(c)}</span>
        </li>
      ))}
    </ul>
  );
}

function iconFor(name: string): ReactNode {
  const cls = "size-3.5";
  if (name === "cite_notes") return <Search className={cls} aria-hidden />;
  if (name === "draw_diagram") return <Shapes className={cls} aria-hidden />;
  if (name === "mark_canvas") return <PenLine className={cls} aria-hidden />;
  if (name === "write_on_canvas") return <Sigma className={cls} aria-hidden />;
  if (name === "show_slide") return <Presentation className={cls} aria-hidden />;
  return <FileText className={cls} aria-hidden />;
}

/** One call in a sentence, from its arguments. A tool this page does not know is named as it is. */
function describe(c: Call): ReactNode {
  const a = c.args as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (c.name === "cite_notes") {
    return (
      <>
        Searched your notes for &ldquo;{str(a.query)}&rdquo;
        {c.result ? <span className="block text-xs text-muted">Found: {c.result}</span> : null}
      </>
    );
  }
  if (c.name === "draw_diagram") {
    const items = Array.isArray(a.items) ? (a.items as { label?: string }[]).map((x) => x.label).filter(Boolean) : [];
    const kind = a.kind === "steps" ? "the steps of" : a.kind === "summary" ? "a summary of" : "a concept map of";
    return (
      <>
        Drew {kind} &ldquo;{str(a.title)}&rdquo;
        {items.length ? <span className="block text-xs text-muted">{items.join(" · ")}</span> : null}
      </>
    );
  }
  if (c.name === "mark_canvas") {
    const shape = a.shape === "box" ? "Boxed" : a.shape === "underline" ? "Underlined" : a.shape === "arrow" ? "Pointed at" : "Circled";
    const what = (a.target as { box?: unknown } | undefined)?.box ? "part of the student's writing" : "something the student drew";
    return (
      <>
        {shape} {what}
        {str(a.note) ? <span className="block text-xs text-muted">Note: &ldquo;{str(a.note)}&rdquo;</span> : null}
      </>
    );
  }
  if (c.name === "write_on_canvas") {
    return (
      <>
        Wrote on the canvas: <span className="font-serif">{a.latex ? <RichReply inline text={`$${str(a.text)}$`} /> : <>&ldquo;{str(a.text)}&rdquo;</>}</span>
      </>
    );
  }
  if (c.name === "show_slide") return <>Opened Lecture {String(a.lecture)}, slide {String(a.slide)}</>;
  return <>{c.name}</>;
}
