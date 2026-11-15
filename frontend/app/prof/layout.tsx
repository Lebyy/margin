import { ProfShell } from "@/components/workspace/prof-shell";

/**
 * The professor side's frame: the same workspace as the student's, with the
 * professor's classes down the left and each assignment opening as a
 * conversation with Askretes beside the class dashboard.
 */
export default function ProfLayout({ children }: LayoutProps<"/prof">) {
  return <ProfShell>{children}</ProfShell>;
}
