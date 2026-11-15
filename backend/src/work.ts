// The professor's view of the work students did outside typed chat: on the
// canvas and in files they attached, and what Askretes' tools did with it.
//
// Every number here is counted in code from stored records (messages and the
// scribe's labels), the same rule as the heatmap: no model writes or changes a
// statistic. The scribe already labels a turn that carried canvas or file work
// from that work itself (scribe.ts reads the canvas picture and the files), so
// those labels are what the struggle numbers below are made of.
//
// It is read per assignment and only from sessions of that assignment, so a
// student's work for another class never appears here. Names are read from
// our own database for the professor's list; nothing here goes to a model.

import mongoose from "mongoose";
import { Assignment, Message, ScribeEvent, Session, Student } from "./models.ts";
import type { StruggleType } from "./types.ts";

/** One concept, counted over the turns that carried canvas or file work. */
export type WorkConcept = {
  concept: string;
  /** Turns with canvas or file work labelled with this concept. */
  turns: number;
  /** Of those, turns the scribe labelled as a struggle. */
  struggling_turns: number;
  /** Distinct students with at least one such struggling turn. */
  students_struggling: number;
  /** students_struggling over the students who did any canvas or file work, rounded. */
  percent_struggling: number;
};

/** One recent piece of work, for the professor's gallery. The picture or file is served by the session routes. */
export type WorkItem = {
  student_id: string;
  display_name: string;
  session_id: string;
  message_id: string;
  kind: "canvas" | "file";
  /** On a canvas item: whether the picture Askretes was shown is stored. */
  has_picture: boolean;
  /** On a file item: the attachment's id, name, and kind. */
  file?: { id: string | null; name: string; kind: string };
  concept: string | null;
  struggle_type: StruggleType | null;
  /** What Askretes did with this work on the next turn: marks left, diagrams drawn, formulas written. */
  margin: { marks: number; drawings: number; writes: number; notes: string[] };
  created_at: string;
};

export type WorkSummary = {
  assignment_id: string;
  /** Students with any session on this assignment. */
  total_students: number;
  canvas: { students: number; turns: number; pictures: number };
  files: { students: number; count: number; by_kind: Record<string, number> };
  margin: { marks: number; drawings: number; writes: number; slides: number };
  /** Concepts over canvas and file turns, most struggled first. */
  concepts: WorkConcept[];
  /** The newest pieces of work, at most 18. */
  recent: WorkItem[];
};

type Msg = {
  _id: mongoose.Types.ObjectId;
  session_id: mongoose.Types.ObjectId;
  role: "student" | "tutor";
  created_at: Date;
  canvas?: { shared?: boolean; picture?: boolean; picture_key?: string | null } | null;
  attachments?: { id?: string | null; name: string; kind: string }[];
  actions?: { type: string; note?: string }[];
};

/** The canvas and file work on one assignment, or null for an unknown assignment. */
export async function workSummary(assignmentId: string): Promise<WorkSummary | null> {
  if (!mongoose.isValidObjectId(assignmentId) || !(await Assignment.exists({ _id: assignmentId }))) return null;

  const sessions = await Session.find({ assignment_id: assignmentId }).select("_id student_id").lean();
  const studentOf = new Map(sessions.map((s) => [String(s._id), String(s.student_id)]));
  const messages = (await Message.find({ session_id: { $in: sessions.map((s) => s._id) } })
    .sort({ created_at: 1, _id: 1 })
    .select("session_id role created_at canvas attachments actions")
    .lean()) as unknown as Msg[];

  // A student turn "carries work" when it shared the canvas or attached files. The tutor turn right after it in the same session is what Askretes did with that work.
  const workTurns: { msg: Msg; reply: Msg | null }[] = [];
  const marginTotals = { marks: 0, drawings: 0, writes: 0, slides: 0 };
  messages.forEach((m, i) => {
    if (m.role === "tutor") {
      for (const a of m.actions ?? []) {
        if (a.type === "mark") marginTotals.marks += 1;
        else if (a.type === "diagram") marginTotals.drawings += 1;
        else if (a.type === "write") marginTotals.writes += 1;
        else if (a.type === "show_slide") marginTotals.slides += 1;
      }
      return;
    }
    if (!m.canvas?.shared && !(m.attachments ?? []).length) return;
    const next = messages[i + 1];
    workTurns.push({ msg: m, reply: next && next.role === "tutor" && String(next.session_id) === String(m.session_id) ? next : null });
  });

  const labels = await ScribeEvent.find({ message_id: { $in: workTurns.map((w) => w.msg._id) } })
    .select("message_id concept struggle_type")
    .lean();
  const labelOf = new Map(labels.map((l) => [String(l.message_id), l]));

  const canvasStudents = new Set<string>();
  const fileStudents = new Set<string>();
  const workStudents = new Set<string>();
  let canvasTurns = 0;
  let pictures = 0;
  let fileCount = 0;
  const byKind: Record<string, number> = {};
  const perConcept = new Map<string, { turns: number; struggling: number; students: Set<string> }>();

  for (const { msg } of workTurns) {
    const student = studentOf.get(String(msg.session_id)) ?? "";
    workStudents.add(student);
    if (msg.canvas?.shared) {
      canvasStudents.add(student);
      canvasTurns += 1;
      if (msg.canvas.picture) pictures += 1;
    }
    for (const f of msg.attachments ?? []) {
      fileStudents.add(student);
      fileCount += 1;
      byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    }
    const label = labelOf.get(String(msg._id));
    if (label) {
      const c = perConcept.get(label.concept) ?? { turns: 0, struggling: 0, students: new Set<string>() };
      c.turns += 1;
      if (label.struggle_type !== "none") {
        c.struggling += 1;
        c.students.add(student);
      }
      perConcept.set(label.concept, c);
    }
  }

  const concepts: WorkConcept[] = [...perConcept.entries()]
    .map(([concept, c]) => ({
      concept,
      turns: c.turns,
      struggling_turns: c.struggling,
      students_struggling: c.students.size,
      percent_struggling: workStudents.size ? Math.round((c.students.size / workStudents.size) * 100) : 0,
    }))
    .sort((a, b) => b.students_struggling - a.students_struggling || b.struggling_turns - a.struggling_turns);

  // The gallery: newest first, one item per canvas share and one per file.
  const recentTurns = workTurns.slice(-18).reverse();
  const names = new Map(
    (await Student.find({ _id: { $in: [...new Set(recentTurns.map((w) => studentOf.get(String(w.msg.session_id))))] } }).select("display_name").lean()).map((s) => [String(s._id), s.display_name]),
  );
  const recent: WorkItem[] = [];
  for (const { msg, reply } of recentTurns) {
    const student = studentOf.get(String(msg.session_id)) ?? "";
    const label = labelOf.get(String(msg._id));
    const actions = reply?.actions ?? [];
    const margin = {
      marks: actions.filter((a) => a.type === "mark").length,
      drawings: actions.filter((a) => a.type === "diagram").length,
      writes: actions.filter((a) => a.type === "write").length,
      notes: actions.flatMap((a) => (a.type === "mark" && a.note ? [a.note] : [])).slice(0, 3),
    };
    const base = {
      student_id: student,
      display_name: names.get(student) ?? "Student",
      session_id: String(msg.session_id),
      message_id: String(msg._id),
      concept: label?.concept ?? null,
      struggle_type: (label?.struggle_type as StruggleType | undefined) ?? null,
      margin,
      created_at: new Date(msg.created_at).toISOString(),
    };
    if (msg.canvas?.shared) recent.push({ ...base, kind: "canvas", has_picture: !!msg.canvas.picture_key });
    for (const f of msg.attachments ?? []) recent.push({ ...base, kind: "file", has_picture: false, file: { id: f.id ?? null, name: f.name, kind: f.kind } });
    if (recent.length >= 18) break;
  }

  return {
    assignment_id: assignmentId,
    total_students: new Set(sessions.map((s) => String(s.student_id))).size,
    canvas: { students: canvasStudents.size, turns: canvasTurns, pictures },
    files: { students: fileStudents.size, count: fileCount, by_kind: byKind },
    margin: marginTotals,
    concepts,
    recent: recent.slice(0, 18),
  };
}

/**
 * The notes Askretes left on students' own work for one concept, for the
 * Thursday card's coach: what students actually got wrong on the canvas, in
 * Askretes' words (already checked by the guard). No names, no counts; at most
 * eight, newest first, without repeats.
 */
export async function workNotesFor(assignmentId: string, concept: string): Promise<string[]> {
  const sessions = await Session.find({ assignment_id: assignmentId }).select("_id").lean();
  const events = await ScribeEvent.find({ assignment_id: assignmentId, concept, struggle_type: { $ne: "none" } }).select("message_id").lean();
  const struggling = new Set(events.map((e) => String(e.message_id)));
  const messages = (await Message.find({ session_id: { $in: sessions.map((s) => s._id) } })
    .sort({ created_at: 1, _id: 1 })
    .select("session_id role actions")
    .lean()) as unknown as Msg[];
  const notes: string[] = [];
  messages.forEach((m, i) => {
    if (m.role !== "student" || !struggling.has(String(m._id))) return;
    const reply = messages[i + 1];
    if (!reply || reply.role !== "tutor" || String(reply.session_id) !== String(m.session_id)) return;
    for (const a of reply.actions ?? []) if (a.type === "mark" && a.note) notes.push(a.note);
  });
  return [...new Set(notes.reverse())].slice(0, 8);
}
