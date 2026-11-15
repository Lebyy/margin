"use client";

import { Button, Input, Label, Radio, RadioGroup, Spinner, TextArea, TextField } from "@heroui/react";
import { Plus, Search, TrendingDown, X } from "lucide-react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChooseProfessor } from "@/components/prof/choose-professor";
import { useWorkspace } from "@/components/workspace/student-shell";
import { api, conceptLabel, COURSE_ACCENTS, type CourseAccent, type ProfCourseCard } from "@/lib/api";
import { browser } from "@/lib/browser";
import { ACCENT_BG } from "@/lib/courses";
import { cn } from "@/lib/utils";

/**
 * The professor's classes, laid out the way a chat app lists projects: a
 * search, a "New class" button, and a grid of cards. Each card shows the
 * class's code and term, its description, how much is posted, and the
 * weakest concept from its newest Thursday card (a stored number, computed
 * nowhere here). A card opens the class workspace: Askretes' class chat and
 * its panel.
 *
 * Only the chosen professor's classes are shown, as a professor's own portal
 * would. A new class is saved under their name.
 */
export default function CoursesPage() {
  const router = useRouter();
  const { refresh } = useWorkspace();
  const [courses, setCourses] = useState<ProfCourseCard[] | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .profCourses()
      .then((r) => {
        if (!live) return;
        const me = browser.profProfile();
        setProfile(me);
        setCourses(r.courses.filter((c) => !me || c.professor === me));
      })
      .catch(() => live && setCourses([]));
    return () => {
      live = false;
    };
  }, []);

  if (courses !== null && !profile) return <ChooseProfessor />;

  const shown = (courses ?? []).filter((c) => !query.trim() || `${c.name} ${c.code} ${c.term}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl font-semibold tracking-tight">Your classes</h1>
          <p className="mt-1.5 text-muted">Open a class to talk to Askretes about it, post work, and see where students are stuck.</p>
        </div>
        <Button variant="primary" onPress={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden /> New class
        </Button>
      </header>

      {creating ? (
        <NewClass
          professor={profile ?? ""}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            refresh();
            router.push(`/prof/courses/${id}`);
          }}
        />
      ) : null}

      {courses === null ? (
        <div className="flex justify-center py-10">
          <Spinner aria-label="Loading classes" />
        </div>
      ) : courses.length === 0 ? (
        creating ? null : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
            <p className="font-serif text-2xl">No classes yet</p>
            <p className="max-w-sm text-muted">Create your first class. You can post assignments from any file, or just ask Askretes to make one.</p>
            <Button variant="primary" onPress={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> New class
            </Button>
          </div>
        )
      ) : (
        <>
          {courses.length > 3 ? (
            <TextField value={query} onChange={setQuery} aria-label="Search your classes" className="max-w-md">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input placeholder="Search classes" className="pl-9" />
              </div>
            </TextField>
          ) : null}
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((c) => (
              <li key={c.id}>
                <NextLink href={`/prof/courses/${c.id}`} className="group flex h-full flex-col gap-3 rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-foreground/25">
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <span aria-hidden className={cn("size-2.5 rounded-full", ACCENT_BG[c.accent])} />
                    {[c.code, c.term].filter(Boolean).join(" · ") || "Class"}
                  </div>
                  <div>
                    <h2 className="font-serif text-xl font-semibold leading-tight tracking-tight group-hover:underline">{c.name}</h2>
                    {c.description ? <p className="mt-1.5 line-clamp-2 text-sm text-muted">{c.description}</p> : null}
                  </div>
                  <div className="mt-auto flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
                    <span className="text-muted">
                      {c.assignments} {c.assignments === 1 ? "assignment" : "assignments"}
                      {c.lessons ? ` · ${c.lessons} ${c.lessons === 1 ? "lesson" : "lessons"}` : ""}
                    </span>
                    {c.weakest ? (
                      <span className="flex items-start gap-1.5">
                        <TrendingDown className="mt-0.5 size-4 shrink-0 text-margin-red" aria-hidden />
                        <span>
                          <span className="font-medium">{conceptLabel(c.weakest.concept)}</span>
                          {c.weakest.percent_struggling !== null ? <span className="text-muted">, {c.weakest.percent_struggling}% struggling</span> : null}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">No student work yet</span>
                    )}
                  </div>
                </NextLink>
              </li>
            ))}
          </ul>
          {shown.length === 0 ? <p className="text-muted">No class matches &ldquo;{query}&rdquo;.</p> : null}
        </>
      )}
    </div>
  );
}

/**
 * The new-class form: the name, and the details a class card shows (code, term, a short description, a colour). Only the name is required; the rest can be filled in later from the class's panel.
 */
function NewClass({ professor, onCancel, onCreated }: { professor: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [term, setTerm] = useState("");
  const [description, setDescription] = useState("");
  const [accent, setAccent] = useState<CourseAccent>("blue");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const made = await api.saveCourse({ name: name.trim(), code: code.trim(), term: term.trim(), description: description.trim(), notes: "", accent, ...(professor ? { professor } : {}) });
      onCreated(made.id);
    } catch {
      setError("The class was not created. Try again.");
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div className="flex items-center">
        <h2 className="font-serif text-2xl font-semibold">New class</h2>
        <Button isIconOnly size="sm" variant="ghost" className="ml-auto" aria-label="Cancel" onPress={onCancel}>
          <X className="size-4" />
        </Button>
      </div>
      <TextField value={name} onChange={setName} isRequired autoFocus fullWidth>
        <Label>Name</Label>
        <Input placeholder="Introduction to Electromagnetism" maxLength={120} />
      </TextField>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField value={code} onChange={setCode}>
          <Label>Code</Label>
          <Input placeholder="PHYS 102" maxLength={20} />
        </TextField>
        <TextField value={term} onChange={setTerm}>
          <Label>Term</Label>
          <Input placeholder="Spring 2027" maxLength={40} />
        </TextField>
      </div>
      <TextField value={description} onChange={setDescription} fullWidth>
        <Label>Description</Label>
        <TextArea rows={2} placeholder="What students will learn, in a sentence or two." maxLength={600} />
      </TextField>
      <RadioGroup value={accent} onChange={(v) => setAccent(v as CourseAccent)} orientation="horizontal" aria-label="Colour">
        <Label>Colour</Label>
        <div className="flex gap-2">
          {COURSE_ACCENTS.map((a) => (
            <Radio key={a} value={a} aria-label={a} className="group">
              <Radio.Control className="sr-only" />
              <span className={cn("block size-7 rounded-full ring-offset-2 ring-offset-surface", ACCENT_BG[a], accent === a ? "ring-2 ring-foreground" : "")} />
            </Radio>
          ))}
        </div>
      </RadioGroup>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" isPending={saving} isDisabled={saving || !name.trim()}>
          Create class
        </Button>
        <Button variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </form>
  );
}
