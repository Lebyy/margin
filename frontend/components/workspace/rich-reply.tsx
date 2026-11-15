"use client";

import { Markdown } from "@/components/workspace/markdown";

/**
 * Askretes' reply (or a question's text) as the student reads it: Markdown,
 * with formulas typeset and slide citations as links. It is a thin name for
 * the shared renderer (components/workspace/markdown.tsx), kept so the places
 * that show a reply say what they show. `inline` keeps it inside a sentence.
 */
export function RichReply({ text, inline = false }: { text: string; inline?: boolean }) {
  return <Markdown text={text} inline={inline} />;
}
