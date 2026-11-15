// How each kind of assignment looks and reads on screen.
//
// The server decides what a kind means: how the guard reads the key and what
// the tutor may say. This file only decides the words and the color a person
// sees. The four kinds are the ones in the API's AssignmentKind, and a kind
// missing here would not compile.

import { BookOpen, Code2, PenLine, Sigma, type LucideIcon } from "lucide-react";
import type { AssignmentKind } from "@/lib/api";

export const KIND: Record<
  AssignmentKind,
  {
    /** The name on chips and pickers. */
    name: string;
    /** One line for the setup picker. */
    blurb: string;
    icon: LucideIcon;
    /** HeroUI chip color. */
    color: "accent" | "success" | "warning" | "danger";
    /** The heading over the student's work area. */
    work: string;
    /** The placeholder in the work area. */
    placeholder: string;
  }
> = {
  code: { name: "Code", blurb: "A program to write.", icon: Code2, color: "accent", work: "Your code", placeholder: "Write your code here" },
  written: { name: "Written", blurb: "A short answer or a paragraph.", icon: PenLine, color: "warning", work: "Your answer", placeholder: "Write your answer in your own words" },
  math: { name: "Math", blurb: "A problem worked to a final answer.", icon: Sigma, color: "danger", work: "Your working", placeholder: "Show your working, one step per line" },
  topic: { name: "Learn", blurb: "Material to learn. No answer key. Askretes teaches it.", icon: BookOpen, color: "success", work: "Your notes", placeholder: "Write what you understand so far" },
};
