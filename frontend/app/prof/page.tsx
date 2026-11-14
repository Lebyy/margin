import { redirect } from "next/navigation";

/** `/prof` has no screen of its own. The professor link lands on setup, which is where a professor's first visit has to begin. */
export default function ProfIndex() {
  redirect("/prof/setup");
}
