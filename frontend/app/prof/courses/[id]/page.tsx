"use client";

import { Alert, Button, Card, Chip, Description, Input, Label, Spinner, TextArea, TextField } from "@heroui/react";
import { Check, FileText, Plus, Upload } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, type Course } from "@/lib/api";
import { Discussion } from "@/components/discussion";
import { SlidesManager } from "@/components/prof/slides-manager";
import { KIND } from "@/lib/kinds";

/**
 * One class, as its professor manages it: the description, the classroom
 * notes, the files, and what has been posted.
 *
 * A file is stored as text. A text file is kept as written. A PDF or a photo
 * of a slide is read into text by the model once, when it is added, and that
 * text is what students see and what Margin searches. The file itself is not
 * kept, so nothing here is a download link.
 *
 * The classroom notes and files apply to every assignment and lesson in the
 * class. Margin can point to them on any of them.
 */
export default function ManageCoursePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    api
      .course(id)
      .then((c) => {
        if (!live) return;
        setCourse(c);
        setDescription(c.description);
        setNotes(c.notes);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);

  if (!course) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner aria-label="Opening the class" />
      </div>
    );
  }

  async function save() {
    if (!course) return;
    await api.saveCourse({ id: course.id, name: course.name, description, notes });
    setSaved(true);
  }

  /** Adds one file. Text is read here and sent as text. A PDF or a picture is sent as it is, and the server reads it. */
  async function addFile(file: File) {
    if (!course) return;
    setFileError(null);
    setAdding(file.name);
    try {
      const isText = file.type.startsWith("text/") || /\.(txt|md|markdown)$/i.test(file.name);
      let material;
      if (isText) {
        material = await api.addMaterial(course.id, { title: file.name, text: await file.text() });
      } else {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        material = await api.addMaterial(course.id, { title: file.name, file: { mimeType: file.type, base64 } });
      }
      setCourse({ ...course, materials: [...course.materials, material] });
    } catch {
      setFileError(`${file.name} could not be read. Text, PDF, PNG, JPEG and WebP files under 7 MB work.`);
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-serif text-5xl font-semibold tracking-tight">{course.name}</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onPress={() => router.push(`/course/${course.id}`)}>Student view</Button>
          <Button variant="primary" onPress={() => router.push(`/prof/setup?course=${encodeURIComponent(course.name)}`)}>
            <Plus className="size-4" aria-hidden /> Add to this class
          </Button>
        </div>
      </header>

      <Card>
        <Card.Content className="flex flex-col gap-4">
          <TextField value={description} onChange={(v) => { setDescription(v); setSaved(false); }} fullWidth>
            <Label>About this class</Label>
            <Input maxLength={600} />
          </TextField>
          <TextField value={notes} onChange={(v) => { setNotes(v); setSaved(false); }} fullWidth>
            <Label>Classroom notes</Label>
            <TextArea rows={7} className="font-serif text-[17px] leading-7" />
            <Description>For every lesson and assignment in this class. Margin points students here.</Description>
          </TextField>
          <div className="flex items-center gap-3">
            <Button variant="primary" onPress={() => void save()}>Save</Button>
            {saved ? (
              <span className="flex items-center gap-1 text-sm text-muted">
                <Check className="size-4 text-margin-green" aria-hidden /> Saved
              </span>
            ) : null}
          </div>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <div className="flex items-center justify-between gap-3">
            <Card.Title>Files</Card.Title>
            <Button variant="secondary" isPending={adding !== null} isDisabled={adding !== null} onPress={() => fileRef.current?.click()}>
              <Upload className="size-4" aria-hidden /> Add a file
            </Button>
          </div>
          <Card.Description>Text, PDF, or a photo of a slide. Stored as text students and Margin can search.</Card.Description>
        </Card.Header>
        <Card.Content>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,text/plain,application/pdf,image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void addFile(file);
            }}
          />
          {adding ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner size="sm" /> Reading {adding}
            </p>
          ) : null}
          {fileError ? (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{fileError}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          {course.materials.length === 0 && !adding ? <p className="text-muted">No files yet.</p> : null}
          <ul className="flex flex-col divide-y divide-border">
            {course.materials.map((m) => (
              <li key={m.id} className="py-3">
                <p className="flex items-center gap-2 font-medium">
                  <FileText className="size-4 text-margin-red" aria-hidden /> {m.title}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{m.body}</p>
              </li>
            ))}
          </ul>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Lecture slides</Card.Title>
        </Card.Header>
        <Card.Content>
          <SlidesManager courseId={course.id} />
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Posted</Card.Title>
        </Card.Header>
        <Card.Content>
          {course.items.length === 0 ? <p className="text-muted">Nothing posted yet.</p> : null}
          <ul className="flex flex-col divide-y divide-border">
            {course.items.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <Chip size="sm" variant="soft" color={KIND[a.kind].color}>{KIND[a.kind].name}</Chip>
                <span className="min-w-0 flex-1 truncate">{a.title}</span>
              </li>
            ))}
          </ul>
        </Card.Content>
      </Card>

      <Discussion courseId={course.id} role="prof" />
    </div>
  );
}
