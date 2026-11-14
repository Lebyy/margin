"use client";

import { Button, Card, Input, Label, Spinner, TextField } from "@heroui/react";
import { Plus, TrendingDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CourseCardLink } from "@/components/course-card";
import { api, conceptLabel, type ProfCourseCard } from "@/lib/api";
import { browser } from "@/lib/browser";

/**
 * The professor's classes: every class, and a field to start a new one.
 *
 * A class also comes into being when an assignment is saved under a new
 * course name, so this page is not a required first step. It is where a
 * professor goes to see all of them and to add notes and files to one.
 *
 * Each card carries the class's weakest concept from its newest Thursday
 * card, with the percent stored on that card (counted in code when it was
 * made). A class with no card says there is no Margin data yet; nothing is
 * estimated to fill the space.
 */
export default function CoursesPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<ProfCourseCard[] | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  /** The name this professor teaches under. A new class is saved with it, and their classes are listed first. It is a label, not a login. */
  const [me, setMe] = useState("");
  /** The professor profile chosen in the header, or null. */
  const [profProfile, setProfProfile] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .profCourses()
      .then((r) => {
        if (!live) return;
        setCourses(r.courses);
        setMe(browser.profName());
        setProfProfile(browser.profProfile());
      })
      .catch(() => live && setCourses([]));
    return () => {
      live = false;
    };
  }, []);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (me.trim()) browser.setProfName(me.trim());
      const made = await api.saveCourse({ name: name.trim(), description: "", notes: "", ...(me.trim() ? { professor: me.trim() } : {}) });
      router.push(`/prof/courses/${made.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="font-serif text-5xl font-semibold tracking-tight">Your classes</h1>
      <Card>
        <Card.Content>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <TextField value={me} onChange={setMe} className="sm:w-56">
              <Label>Your name</Label>
              <Input maxLength={80} />
            </TextField>
            <TextField value={name} onChange={setName} fullWidth>
              <Label>New class</Label>
              <Input maxLength={120} />
            </TextField>
            <Button type="submit" variant="primary" isPending={saving} isDisabled={saving || !name.trim()}>
              <Plus className="size-4" aria-hidden /> Create
            </Button>
          </form>
        </Card.Content>
      </Card>
      {courses === null ? (
        <div className="flex justify-center py-10">
          <Spinner aria-label="Loading classes" />
        </div>
      ) : courses.length === 0 ? (
        <p className="text-lg text-muted">No classes yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...courses]
            // A chosen professor profile sees only the classes under their name, as a professor's own portal would.
            .filter((c) => !profProfile || c.professor === profProfile)
            .sort((a, b) => Number(b.professor === me && me !== "") - Number(a.professor === me && me !== ""))
            .map((c, i) => (
              <CourseCardLink key={c.id} course={{ ...c, professor: c.professor === me && me !== "" ? "You teach this" : c.professor }} href={`/prof/courses/${c.id}`} index={i}>
                <p className="text-sm text-muted">
                  {c.assignments} {c.assignments === 1 ? "assignment" : "assignments"} · {c.lessons} {c.lessons === 1 ? "lesson" : "lessons"}
                </p>
                {c.weakest ? (
                  <p className="mt-1 flex items-start gap-1.5 text-sm">
                    <TrendingDown className="mt-0.5 size-4 shrink-0 text-margin-red" aria-hidden />
                    <span>
                      Weakest: <span className="font-medium">{conceptLabel(c.weakest.concept)}</span>
                      {c.weakest.percent_struggling !== null ? `, ${c.weakest.percent_struggling}% struggling` : ""}
                      <span className="text-muted"> · {c.weakest.assignment_title}</span>
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted">No Margin data yet</p>
                )}
              </CourseCardLink>
            ))}
        </ul>
      )}
    </div>
  );
}
