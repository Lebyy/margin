"use client";

import { Presentation } from "lucide-react";
import NextLink from "next/link";
import { useContext, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CitationContext } from "@/components/student/cited-text";
import type { Lecture } from "@/lib/api";
import { texToSvg } from "@/lib/math";
import { cn } from "@/lib/utils";

/**
 * Markdown, everywhere Askretes shows formatted text: Askretes' replies, a
 * question's text, a student's .md file (or a Word or PowerPoint file's
 * text) in the side panel, and a student's message in the professor's
 * transcript.
 *
 * It is react-markdown with GitHub-flavoured Markdown (tables, task lists,
 * strikethrough, autolinks) and math ($...$ and $$...$$). react-markdown
 * builds React elements and does not render raw HTML, so HTML in a reply or a
 * file shows as nothing more than its text. A link is a link only for http,
 * https, and mailto (the URL check below); a slide citation, "[Lecture 3,
 * slide 9]", becomes a link to that slide when the class has it. Formulas are
 * typeset by the same restricted MathJax renderer as before (lib/math.ts).
 *
 * `inline` drops the paragraph wrapper, for a short piece of text inside a
 * sentence (a formula in a tool call's description).
 */
export function Markdown({ text, inline = false, className, onAppLink }: { text: string; inline?: boolean; className?: string; onAppLink?: (target: string) => void }) {
  const cites = useContext(CitationContext);
  const components: Components = {
    p: ({ children }) => (inline ? <>{children}</> : <p className="my-3 first:mt-0 last:mb-0">{children}</p>),
    h1: ({ children }) => <h3 className="mb-2 mt-5 font-serif text-2xl font-semibold first:mt-0">{children}</h3>,
    h2: ({ children }) => <h4 className="mb-2 mt-5 font-serif text-xl font-semibold first:mt-0">{children}</h4>,
    h3: ({ children }) => <h5 className="mb-1.5 mt-4 font-semibold first:mt-0">{children}</h5>,
    h4: ({ children }) => <h6 className="mb-1 mt-3 font-semibold first:mt-0">{children}</h6>,
    ul: ({ children, className: c }) => <ul className={cn("my-3 flex list-disc flex-col gap-1 pl-6", c?.includes("contains-task-list") && "list-none pl-1")}>{children}</ul>,
    ol: ({ children }) => <ol className="my-3 flex list-decimal flex-col gap-1 pl-6">{children}</ol>,
    blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-border pl-4 text-muted">{children}</blockquote>,
    hr: () => <hr className="my-4 border-border" />,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse font-sans text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b border-border px-2 py-1.5 text-left font-medium">{children}</th>,
    td: ({ children }) => <td className="border-b border-border/60 px-2 py-1.5 align-top">{children}</td>,
    pre: ({ children }) => <>{children}</>,
    code: ({ className: c, children }) => {
      const text = String(children ?? "").replace(/\n$/, "");
      // remark-math marks formulas as code with these classes; they are typeset rather than shown as code.
      if (c?.includes("math-display")) return <Formula tex={text} display />;
      if (c?.includes("math-inline")) return <Formula tex={text} display={false} />;
      const block = /language-/.test(c ?? "") || text.includes("\n");
      return block ? (
        <pre className="my-3 overflow-x-auto rounded-xl border border-border bg-surface px-4 py-3 font-mono text-[13px] leading-6">
          <code>{text}</code>
        </pre>
      ) : (
        <code className="rounded-md bg-default px-1.5 py-0.5 font-mono text-[0.85em]">{text}</code>
      );
    },
    a: ({ href, children }) => {
      const cite = href?.startsWith("cite:") ? href.slice(5).split(":") : null;
      if (cite) {
        const lecture = cites?.lectures.find((l) => l.id === cite[0]);
        const page = Number(cite[1]);
        const end = cite[2] ? Number(cite[2]) : undefined;
        if (!cites || !lecture) return <>{children}</>;
        // A slide reference reads as a small chip with the slides icon, so it is plainly something to press, and opens the slide in the pane beside the chat.
        return (
          <NextLink
            href={`/course/${cites.courseId}?tab=slides&lecture=${lecture.id}&page=${page}`}
            title={`Open Lecture ${lecture.lecture_number}: ${lecture.title} at slide ${page}`}
            className="mx-0.5 inline-flex items-baseline gap-1 rounded-md bg-accent/10 px-1.5 font-sans text-[0.88em] font-medium text-accent no-underline transition-colors hover:bg-accent/20"
            onClick={(e) => {
              if (!cites.open || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              cites.open(lecture.id, page, end);
            }}
          >
            <Presentation className="size-3.5 shrink-0 translate-y-0.5" aria-hidden />
            {children}
          </NextLink>
        );
      }
      // A link the page wrote itself (a student's name in the analyst's answer) opens something on this page rather than leaving it.
      if (href?.startsWith("app:")) {
        if (!onAppLink) return <>{children}</>;
        const target = href.slice(4);
        return (
          <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => onAppLink(target)}>
            {children}
          </button>
        );
      }
      if (!href) return <>{children}</>;
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
          {children}
        </a>
      );
    },
    // A picture in Markdown would load from anywhere; it is shown as its description instead.
    img: ({ alt }) => <span className="text-muted">[{alt || "image"}]</span>,
  };

  // Slide citations become links the renderer can see: [Lecture 3, slide 9] -> [Lecture 3, slide 9](cite:<lecture id>:9), only for a lecture and slide the class has.
  const prepared = cites?.lectures.length ? linkSlides(text, cites.lectures) : text;

  const body = (
    <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]} components={components} urlTransform={safeUrl}>
      {prepared}
    </ReactMarkdown>
  );
  return inline ? <span className={className}>{body}</span> : <div className={cn("break-words", className)}>{body}</div>;
}

/** Only these links survive: web pages, email, the page's own slide citations, and the page's own app: links. Anything else (javascript:, data:, file:) is removed. */
function safeUrl(url: string): string {
  return /^(https?:|mailto:|cite:|app:)/i.test(url) ? url : "";
}

/** One formula. Inline sits on the line; display gets its own centred line and scrolls sideways if it is wider than the column. */
export function Formula({ tex, display }: { tex: string; display: boolean }): ReactNode {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void texToSvg(tex, display).then((out) => live && setSvg(out));
    return () => {
      live = false;
    };
  }, [tex, display]);
  const label = `formula: ${tex}`;
  if (!svg) return <span className="font-mono text-[0.9em] text-muted">{display ? `$$${tex}$$` : `$${tex}$`}</span>;
  return display ? (
    // The SVG comes from the restricted MathJax renderer, never from the text as markup.
    <span role="img" aria-label={label} className="my-2 block overflow-x-auto text-center" dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <span role="img" aria-label={label} className="inline-block align-middle" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

/*
 * Slide references, in every way a reply writes them: the bracketed form the
 * tutor is told to use, "[Lecture 3, slide 9]", and the looser ones a model
 * also writes, "Lecture 3, slide 9", "Lecture 7 slides 12-16", "slide 4 of
 * Lecture 2". Each becomes a Markdown link to `cite:<lecture id>:<first>[:<last>]`,
 * which the link renderer above turns into a chip that opens the pane.
 *
 * Only a lecture the class has, and slides inside it, are linked; a wrong
 * number stays as the words written, so a student is never sent to a slide
 * that is not there. Code is left alone: a reference inside backticks or a
 * fenced block would otherwise show Markdown link syntax inside the code.
 */
const BRACKETED = /\[Lecture (\d{1,3}),? slides? (\d{1,4})(?:\s?[-–]\s?(\d{1,4}))?\](?!\()/gi;
const LECTURE_FIRST = /(?<![[\w])Lecture (\d{1,3}),?\s+slides? (\d{1,4})(?:\s?(?:[-–]|to)\s?(\d{1,4}))?(?![\w\]])/gi;
const SLIDE_FIRST = /(?<![[\w])slides? (\d{1,4})(?:\s?(?:[-–]|to)\s?(\d{1,4}))? (?:of|in|from) Lecture (\d{1,3})(?![\w\]])/gi;

function linkSlides(text: string, lectures: Lecture[]): string {
  const target = (n: string, from: string, to?: string) => {
    const lecture = lectures.find((l) => l.lecture_number === Number(n));
    const a = Number(from);
    const b = to ? Number(to) : a;
    if (!lecture || a < 1 || a > lecture.page_count) return null;
    const last = Math.min(Math.max(b, a), lecture.page_count);
    return `cite:${lecture.id}:${a}${last > a ? `:${last}` : ""}`;
  };
  const outsideCode = (part: string) =>
    part
      .replace(BRACKETED, (whole, n: string, a: string, b?: string) => {
        const t = target(n, a, b);
        return t ? `${whole}(${t})` : whole;
      })
      .replace(LECTURE_FIRST, (whole, n: string, a: string, b?: string) => {
        const t = target(n, a, b);
        return t ? `[${whole}](${t})` : whole;
      })
      .replace(SLIDE_FIRST, (whole, a: string, b: string | undefined, n: string) => {
        const t = target(n, a, b);
        return t ? `[${whole}](${t})` : whole;
      });
  // Fenced blocks and inline code pass through untouched; everything between them is linked.
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : outsideCode(part)))
    .join("");
}
