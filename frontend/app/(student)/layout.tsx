import { StudentShell } from "@/components/workspace/student-shell";

/**
 * The student side's frame: the class sidebar and the workspace beside it.
 *
 * It wraps the home page, a class, and an assignment, so moving between them
 * keeps the sidebar mounted and its open classes open. The route group adds
 * nothing to the URL: `/`, `/course/:id`, and `/student/assignment/:id` are
 * the same addresses they were.
 */
export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <StudentShell>{children}</StudentShell>;
}
