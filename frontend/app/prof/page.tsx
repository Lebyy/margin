import { redirect } from "next/navigation";

/** `/prof` has no screen of its own. The professor link lands on the list of classes. */
export default function ProfIndex() {
  redirect("/prof/courses");
}
