"use client";

import { Alert, AlertDialog, Button, Input, Label, Spinner, TextField } from "@heroui/react";
import { Check, ExternalLink, Presentation, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, lectureFileUrl, MAX_PDF_BYTES, type Lecture } from "@/lib/api";

/**
 * The professor's lecture slides for one class: upload, rename, number,
 * date, delete.
 *
 * A PDF is sent as it is, at most 20 MB. The server checks it really is a
 * PDF (by its first bytes, not its name), keeps the file for students to
 * read, and reads its text page by page for Margin. A slide with no text
 * layer (a scanned page) cannot be read without OCR, which Margin does not
 * do; the list says how many such pages a lecture has, so the professor
 * knows Margin cannot cite them.
 *
 * Deleting asks first, in an alert dialog, because it removes the file,
 * its text, and the link from every assignment that covered it.
 */
export function SlidesManager({ courseId, onChange }: { courseId: string; onChange?: (lectures: Lecture[]) => void }) {
  const [lectures, setLectures] = useState<Lecture[] | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Lecture | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    api
      .lectures(courseId)
      .then((r) => live && setLectures(r.lectures))
      .catch(() => live && setLectures([]));
    return () => {
      live = false;
    };
  }, [courseId]);

  /** Keeps the list and the parent (the setup form's lecture picker) in step. */
  function update(next: Lecture[]) {
    const sorted = [...next].sort((a, b) => a.lecture_number - b.lecture_number);
    setLectures(sorted);
    onChange?.(sorted);
  }

  async function upload(file: File) {
    setError(null);
    // Checked here only to save a long upload that would be refused. The server checks again, and checks the bytes.
    if (file.size > MAX_PDF_BYTES) {
      setError(`${file.name} is over 20 MB.`);
      return;
    }
    setUploading(file.name);
    try {
      const made = await api.uploadLecture(courseId, file, {});
      update([...(lectures ?? []), made]);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setError(code === "not_a_pdf" ? `${file.name} is not a PDF.` : code === "unreadable_pdf" ? `${file.name} could not be opened as a PDF.` : e instanceof ApiError && e.status === 413 ? `${file.name} is over 20 MB.` : `${file.name} was not uploaded. Try again.`);
    } finally {
      setUploading(null);
    }
  }

  async function remove(lecture: Lecture) {
    setDeleting(true);
    try {
      await api.deleteLecture(lecture.id);
      update((lectures ?? []).filter((l) => l.id !== lecture.id));
      setConfirm(null);
    } catch {
      setError("The lecture was not deleted. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">PDF only, up to 20 MB. Students read the slides here, and Margin cites them by lecture and slide when an assignment covers that lecture.</p>
        <Button variant="secondary" isPending={uploading !== null} isDisabled={uploading !== null} onPress={() => fileRef.current?.click()}>
          <Upload className="size-4" aria-hidden /> Upload a lecture
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
      {uploading ? (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner size="sm" /> Uploading and reading {uploading}
        </p>
      ) : null}
      {error ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {lectures === null ? (
        <p className="flex items-center gap-2 text-muted">
          <Spinner size="sm" /> Loading lectures
        </p>
      ) : lectures.length === 0 && !uploading ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
          <Presentation className="size-6 text-muted" aria-hidden />
          <p className="font-medium">No slides yet</p>
          <p className="text-sm text-muted">Upload a lecture PDF to show it to students and let Margin cite it.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
          {lectures.map((l) => (
            <LectureRow key={l.id} courseId={courseId} lecture={l} onSaved={(saved) => update(lectures.map((x) => (x.id === saved.id ? saved : x)))} onDelete={() => setConfirm(l)} />
          ))}
        </ul>
      )}

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>Delete Lecture {confirm?.lecture_number}?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>
                  &ldquo;{confirm?.title}&rdquo; and its {confirm?.page_count} slides will be removed. Students will no longer see it, and Margin will stop citing it on every assignment that covers it. This cannot be undone.
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button variant="tertiary" onPress={() => setConfirm(null)}>
                  Keep it
                </Button>
                <Button variant="danger" isPending={deleting} onPress={() => confirm && void remove(confirm)}>
                  Delete lecture
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}

/** One lecture, with its number, title, and date editable in place. */
function LectureRow({ courseId, lecture, onSaved, onDelete }: { courseId: string; lecture: Lecture; onSaved: (l: Lecture) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(lecture.title);
  const [number, setNumber] = useState(String(lecture.lecture_number));
  const [date, setDate] = useState(lecture.lecture_date ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const changed = title !== lecture.title || number !== String(lecture.lecture_number) || date !== (lecture.lecture_date ?? "");
  const validNumber = /^\d{1,3}$/.test(number);

  async function save() {
    setSaving(true);
    try {
      onSaved(await api.updateLecture(lecture.id, { title: title.trim() || lecture.title, lecture_number: Number(number), lecture_date: date }));
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 p-4">
      <form
        className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_10rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed && validNumber) void save();
        }}
      >
        <TextField value={number} onChange={(v) => { setNumber(v); setSaved(false); }} isInvalid={!validNumber} name="lecture_number">
          <Label>Lecture</Label>
          <Input inputMode="numeric" maxLength={3} />
        </TextField>
        <TextField value={title} onChange={(v) => { setTitle(v); setSaved(false); }} name="lecture_title">
          <Label>Title</Label>
          <Input maxLength={120} />
        </TextField>
        <TextField value={date} onChange={(v) => { setDate(v); setSaved(false); }} name="lecture_date">
          <Label>Date</Label>
          <Input type="date" />
        </TextField>
        <div className="flex items-center gap-1">
          <Button type="submit" size="sm" variant="secondary" isDisabled={!changed || !validNumber || saving} isPending={saving}>
            Save
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Delete lecture ${lecture.lecture_number}`} onPress={onDelete}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>
          {lecture.page_count} {lecture.page_count === 1 ? "slide" : "slides"}
        </span>
        {lecture.unreadable_pages > 0 ? (
          <span className="text-danger">
            {lecture.unreadable_pages} {lecture.unreadable_pages === 1 ? "slide has" : "slides have"} no readable text, so Margin cannot cite {lecture.unreadable_pages === 1 ? "it" : "them"}.
          </span>
        ) : (
          <span>Text read from every slide</span>
        )}
        <a href={lectureFileUrl(courseId, lecture.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">
          <ExternalLink className="size-3.5" aria-hidden /> Open PDF
        </a>
        {saved ? (
          <span className="inline-flex items-center gap-1" role="status">
            <Check className="size-4 text-margin-green" aria-hidden /> Saved
          </span>
        ) : null}
      </div>
    </li>
  );
}
