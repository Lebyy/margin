"use client";

import { Button, Card, Chip, Input, Label, Spinner, TextField } from "@heroui/react";
import { ArrowRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type CourseListItem } from "@/lib/api";
import { browser } from "@/lib/browser";

/**
 * The professor's classes: every class, and a field to start a new one.
 *
 * A class also comes into being when an assignment is saved under a new
 * course name, so this page is not a required first step. It is where a
 * professor goes to see all of them and to add notes and files to one.
 */
export default function CoursesPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<CourseListItem[] | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  /** The name this professor teaches under. A new class is saved with it, and their classes are listed first. It is a label, not a login. */
  const [me, setMe] = useState("");

  useEffect(() => {
    let live = true;
    api
      .courses()
      .then((r) => {
        if (!live) return;
        setCourses(r.courses);
        setMe(browser.profName());
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
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <TextField value={me} onChange={setMe} className="w-56">
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
        <ul className="grid gap-4 sm:grid-cols-2">
          {[...courses].sort((a, b) => Number(b.professor === me && me !== "") - Number(a.professor === me && me !== "")).map((c) => (
            <li key={c.id}>
              <Card className="h-full">
                <Card.Header>
                  <Card.Title className="font-serif text-2xl">{c.name}</Card.Title>
                  {c.professor ? <p className="text-sm text-muted">{c.professor === me ? "You teach this" : c.professor}</p> : null}
                  {c.description ? <Card.Description>{c.description}</Card.Description> : null}
                </Card.Header>
                <Card.Content className="flex gap-2">
                  <Chip size="sm" variant="soft" color="success">{c.lessons} lessons</Chip>
                  <Chip size="sm" variant="soft" color="accent">{c.assignments} assignments</Chip>
                </Card.Content>
                <Card.Footer>
                  <Button variant="secondary" onPress={() => router.push(`/prof/courses/${c.id}`)}>
                    Manage <ArrowRight className="size-4" aria-hidden />
                  </Button>
                </Card.Footer>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
