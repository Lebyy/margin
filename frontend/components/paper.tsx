import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The sheet of paper with the red margin line. Both screens are built on it.
 *
 * It is a wrapper of ours and not a HeroUI Card, because the margin line and
 * the ruling are the product's one visual idea and no library has them. The
 * things placed on the sheet (buttons, fields, chips) are all HeroUI.
 *
 * `plain` drops the ruling for dense content such as the heatmap. `as` lets a
 * page make the sheet a <section> or an <article>, so the landmark matches
 * what the sheet holds.
 */
export function Paper({
  children,
  className,
  plain = false,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  plain?: boolean;
  as?: "section" | "article" | "div";
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <Tag className={cn("paper py-5 pr-4 sm:pr-6", plain && "paper-plain", className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * A mark in the margin, beside the line it is about.
 *
 * It is positioned in the gutter left of the red line, which is why its parent
 * must be a direct line of text on a Paper sheet. The mark is decoration for a
 * sighted reader. The same information is always in text next to it, so a
 * screen reader loses nothing when this is hidden.
 */
export function MarginMark({ tone = "red", children }: { tone?: "red" | "green"; children?: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -left-[calc(var(--paper-gutter)+1rem)] flex h-full w-[var(--paper-gutter)] items-center justify-center font-serif text-sm font-semibold max-sm:-left-[calc(var(--paper-gutter)+0.75rem)]",
        tone === "red" ? "text-margin-red" : "text-margin-green",
      )}
    >
      {children}
    </span>
  );
}
