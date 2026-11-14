// The course-portal routes: My courses, joining a class, the assignment list
// with due dates and status, and the professor's course cards.
//
// None of these call a model. Every number here (due this week, status) is
// counted from rows people created: an enrollment exists because a student
// joined, a status because a session was started or submitted. Assignment
// rows are read with an explicit field list that never includes the key, the
// question keys, or the canary, so no response built here can carry them.

import express, { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { accentFor, Assignment, Course, Enrollment, LectureFile, Session, SlidePage, Student, ThursdayCard } from "./models.ts";
import { deletePdf, extractPages, looksLikePdf, MAX_PDF_BYTES, openPdf, storePdf, titleFromFilename } from "./slides.ts";

/** The assignment fields the course pages read. Never the key, the question keys, or the canary. */
const LIST_FIELDS = "course_id course_name title kind concepts due_at margin_enabled created_at";

export type AssignmentStatus = "not_started" | "in_progress" | "submitted";

/** How far ahead "due this week" and "Due soon" look. Seven days from now, not the calendar week, so Sunday night does not reset the count. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A student's status on each assignment, from their sessions.
 *
 * Submitted is a session that finished the last question (`completed_at`,
 * set by Finish). In progress is any other session. Not started is no
 * session. There is no submissions collection to drift out of step with the
 * sessions it would copy.
 */
export async function statusByAssignment(studentId: string | null, assignmentIds: mongoose.Types.ObjectId[]): Promise<Map<string, AssignmentStatus>> {
  const out = new Map<string, AssignmentStatus>();
  if (!studentId || !mongoose.isValidObjectId(studentId) || assignmentIds.length === 0) return out;
  const sessions = await Session.find({ student_id: new mongoose.Types.ObjectId(studentId), assignment_id: { $in: assignmentIds } }).select("assignment_id completed_at").lean();
  for (const s of sessions) {
    const id = String(s.assignment_id);
    if (s.completed_at) out.set(id, "submitted");
    else if (out.get(id) !== "submitted") out.set(id, "in_progress");
  }
  return out;
}

/** One assignment as a course list shows it. */
export function listItem(a: { _id: unknown; course_id?: unknown; course_name: string; title: string; kind?: string | null; concepts?: string[] | null; due_at?: Date | null; margin_enabled?: boolean | null }, status: AssignmentStatus) {
  return {
    id: String(a._id),
    course_id: a.course_id ? String(a.course_id) : null,
    course_name: a.course_name,
    title: a.title,
    kind: a.kind ?? "code",
    concepts: a.concepts ?? [],
    due_at: a.due_at ? new Date(a.due_at).toISOString() : null,
    margin_enabled: a.margin_enabled !== false,
    status,
  };
}

/** The card fields every course listing shares. */
export function courseCard(c: { _id: unknown; name: string; code?: string | null; term?: string | null; professor?: string | null; description?: string | null; accent?: string | null }) {
  return {
    id: String(c._id),
    name: c.name,
    code: c.code ?? "",
    term: c.term ?? "",
    professor: c.professor ?? "",
    description: c.description ?? "",
    accent: accentFor(c),
  };
}

/**
 * Enrolls a student in a class. An upsert, so a repeat is harmless. Called
 * when the student presses Join and when they start a session on one of the
 * class's assignments, so a student who opened work from a link still finds
 * the class under My courses.
 */
export async function enroll(studentId: unknown, courseId: unknown): Promise<void> {
  if (!studentId || !courseId) return;
  await Enrollment.updateOne({ student_id: studentId, course_id: courseId }, { $setOnInsert: { student_id: studentId, course_id: courseId } }, { upsert: true });
}

/** One lecture as the lists show it. `unreadable_pages` is for the professor: pages that had no text to read. */
async function lectureView(l: { _id: mongoose.Types.ObjectId; course_id: unknown; lecture_number: number; title: string; lecture_date?: Date | null; page_count: number; uploaded_at?: Date | null }) {
  const unreadable = await SlidePage.countDocuments({ lecture_file_id: l._id, text: "" });
  return {
    id: String(l._id),
    course_id: String(l.course_id),
    lecture_number: l.lecture_number,
    title: l.title,
    lecture_date: l.lecture_date ? new Date(l.lecture_date).toISOString().slice(0, 10) : null,
    page_count: l.page_count,
    unreadable_pages: unreadable,
    uploaded_at: l.uploaded_at ? new Date(l.uploaded_at).toISOString() : null,
  };
}

/** A lecture's editable fields, from a query string on upload or a JSON body on edit. */
const lectureFields = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  lecture_number: z.coerce.number().int().min(0).max(999).optional(),
  // A calendar day, "2026-11-10". Empty clears it.
  lecture_date: z.union([z.iso.date(), z.literal("")]).optional(),
});

export function createCourseRouter(): Router {
  const router = Router();

  /**
   * POST /api/prof/courses/:id/lectures: a professor uploads one lecture PDF.
   *
   * The body is the raw file with `Content-Type: application/pdf`, so a 20 MB
   * deck is not inflated by base64 into a JSON body. The title, number, and
   * date come in the query string; `filename` is only used for a default
   * title. In order: the course must exist (404), the type must be PDF (415),
   * the size at most MAX_PDF_BYTES (413, from the body limit), the bytes must
   * start with %PDF- (415), and pdf.js must be able to open it (422). Only
   * then is anything stored: the file under a random id, one lecture row, and
   * one text row per page. A page with no text is stored empty, and the
   * response counts those pages so the professor is told.
   */
  router.post(
    "/api/prof/courses/:id/lectures",
    // Any type is read as raw bytes here, so a wrong type gets the 415 below rather than an empty body.
    express.raw({ type: () => true, limit: MAX_PDF_BYTES }),
    async (req, res) => {
      const course = mongoose.isValidObjectId(req.params.id) ? await Course.findById(req.params.id).select("_id").lean() : null;
      if (!course) {
        res.status(404).json({ error: "course_not_found" });
        return;
      }
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!/^application\/pdf\b/i.test(req.get("content-type") ?? "") || !looksLikePdf(body)) {
        res.status(415).json({ error: "not_a_pdf" });
        return;
      }
      const fields = lectureFields.safeParse(req.query);
      if (!fields.success) {
        res.status(400).json({ error: "invalid_lecture" });
        return;
      }
      let pages: string[];
      try {
        pages = await extractPages(body);
      } catch (error) {
        console.error("lecture PDF could not be read:", (error as Error).name);
        res.status(422).json({ error: "unreadable_pdf" });
        return;
      }
      const last = await LectureFile.findOne({ course_id: course._id }).sort({ lecture_number: -1 }).select("lecture_number").lean();
      const fileId = await storePdf(body);
      const lecture = await new LectureFile({
        course_id: course._id,
        lecture_number: fields.data.lecture_number ?? (last ? last.lecture_number + 1 : 1),
        title: fields.data.title ?? titleFromFilename(String(req.query.filename ?? "")),
        lecture_date: fields.data.lecture_date ? new Date(fields.data.lecture_date) : null,
        file_id: fileId,
        page_count: pages.length,
      }).save();
      await SlidePage.insertMany(pages.map((text, i) => ({ lecture_file_id: lecture._id, page_number: i + 1, text })));
      res.status(201).json(await lectureView(lecture.toObject()));
    },
  );

  /** PATCH /api/prof/lectures/:id: rename, renumber, or redate a lecture. The file and its pages are not touched. */
  router.patch("/api/prof/lectures/:id", async (req, res) => {
    const fields = lectureFields.safeParse(req.body);
    const lecture = mongoose.isValidObjectId(req.params.id) ? await LectureFile.findById(req.params.id) : null;
    if (!lecture) {
      res.status(404).json({ error: "lecture_not_found" });
      return;
    }
    if (!fields.success) {
      res.status(400).json({ error: "invalid_lecture" });
      return;
    }
    if (fields.data.title !== undefined) lecture.title = fields.data.title;
    if (fields.data.lecture_number !== undefined) lecture.lecture_number = fields.data.lecture_number;
    if (fields.data.lecture_date !== undefined) lecture.lecture_date = fields.data.lecture_date ? new Date(fields.data.lecture_date) : null;
    await lecture.save();
    res.json(await lectureView(lecture.toObject()));
  });

  /**
   * DELETE /api/prof/lectures/:id: removes the lecture, its PDF, and its page
   * text, and unlinks it from every assignment that covered it, so no hint
   * can cite a slide that is gone. The page asks the professor to confirm first.
   */
  router.delete("/api/prof/lectures/:id", async (req, res) => {
    const lecture = mongoose.isValidObjectId(req.params.id) ? await LectureFile.findById(req.params.id).lean() : null;
    if (!lecture) {
      res.status(404).json({ error: "lecture_not_found" });
      return;
    }
    await Assignment.updateMany({ lecture_ids: lecture._id }, { $pull: { lecture_ids: lecture._id } });
    await SlidePage.deleteMany({ lecture_file_id: lecture._id });
    await deletePdf(lecture.file_id);
    await LectureFile.deleteOne({ _id: lecture._id });
    res.status(204).end();
  });

  /** GET /api/courses/:id/lectures: the class's lectures in order, for the slide list and the setup form. */
  router.get("/api/courses/:id/lectures", async (req, res) => {
    const course = mongoose.isValidObjectId(req.params.id) ? await Course.findById(req.params.id).select("_id").lean() : null;
    if (!course) {
      res.status(404).json({ error: "course_not_found" });
      return;
    }
    const lectures = await LectureFile.find({ course_id: course._id }).sort({ lecture_number: 1, uploaded_at: 1 }).lean();
    res.json({ lectures: await Promise.all(lectures.map(lectureView)) });
  });

  /**
   * GET /api/courses/:id/lectures/:lid/file: the PDF itself, for the viewer.
   *
   * Served only when the lecture belongs to the class in the URL, so a link
   * cannot be edited into another class's slides. Sent inline as
   * application/pdf with nosniff, so the browser opens its own PDF viewer
   * and never treats the bytes as anything else.
   */
  router.get("/api/courses/:id/lectures/:lid/file", async (req, res) => {
    const ok = mongoose.isValidObjectId(req.params.id) && mongoose.isValidObjectId(req.params.lid);
    const lecture = ok ? await LectureFile.findOne({ _id: req.params.lid, course_id: req.params.id }).lean() : null;
    if (!lecture) {
      res.status(404).json({ error: "lecture_not_found" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="lecture-${lecture.lecture_number}.pdf"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    const stream = openPdf(lecture.file_id);
    stream.on("error", () => {
      if (!res.headersSent) res.status(404).json({ error: "lecture_not_found" });
      else res.end();
    });
    stream.pipe(res);
  });

  /**
   * GET /api/students/:id/courses: My courses and Due soon for one student.
   *
   * Courses are the ones this student joined. Each card has a "due this
   * week" count: assignments in it with a due date in the next seven days
   * that the student has not submitted. Due soon is the next five such
   * assignments across all their courses, nearest first. Overdue work the
   * student has not submitted is included in Due soon, first, so it is not
   * hidden by being in the past.
   */
  router.get("/api/students/:id/courses", async (req, res) => {
    const studentId = req.params.id;
    if (!mongoose.isValidObjectId(studentId) || !(await Student.exists({ _id: studentId }))) {
      res.status(404).json({ error: "student_not_found" });
      return;
    }
    const enrolled = await Enrollment.find({ student_id: studentId }).select("course_id").lean();
    const courses = await Course.find({ _id: { $in: enrolled.map((e) => e.course_id) } }).sort({ name: 1 }).lean();
    const work = await Assignment.find({ course_id: { $in: courses.map((c) => c._id) } }).select(LIST_FIELDS).lean();
    const status = await statusByAssignment(studentId, work.map((a) => a._id));
    const now = Date.now();
    const open = work.filter((a) => a.due_at && (a.kind ?? "code") !== "topic" && status.get(String(a._id)) !== "submitted");
    const thisWeek = (courseId: unknown) => open.filter((a) => String(a.course_id) === String(courseId) && new Date(a.due_at as Date).getTime() - now <= WEEK_MS).length;
    res.json({
      courses: courses.map((c) => ({ ...courseCard(c), due_this_week: thisWeek(c._id) })),
      due_soon: open
        .sort((a, b) => new Date(a.due_at as Date).getTime() - new Date(b.due_at as Date).getTime())
        .slice(0, 5)
        .map((a) => listItem(a, status.get(String(a._id)) ?? "not_started")),
    });
  });

  /**
   * POST /api/courses/:id/join: a student joins a class.
   *
   * The same identity rule as starting a session: a returning student sends
   * their id, a first visit sends the name they typed and the student is
   * created here. Exactly one of the two. This and POST /api/sessions are the
   * only places a student or an enrollment comes from.
   */
  router.post("/api/courses/:id/join", async (req, res) => {
    const body = z
      .object({ student_id: z.string().refine((s) => mongoose.isValidObjectId(s)).optional(), display_name: z.string().trim().min(1).max(80).optional() })
      .refine((b) => (b.student_id === undefined) !== (b.display_name === undefined))
      .safeParse(req.body);
    const course = mongoose.isValidObjectId(req.params.id) ? await Course.findById(req.params.id).select("_id").lean() : null;
    if (!course) {
      res.status(404).json({ error: "course_not_found" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "invalid_join" });
      return;
    }
    let studentId = body.data.student_id;
    if (studentId === undefined) {
      studentId = String((await new Student({ display_name: body.data.display_name }).save())._id);
    } else if (!(await Student.exists({ _id: studentId }))) {
      res.status(404).json({ error: "student_not_found" });
      return;
    }
    await enroll(studentId, course._id);
    res.json({ student_id: studentId, course_id: String(course._id) });
  });

  /**
   * GET /api/prof/courses: the professor's course cards.
   *
   * Each card carries the class's weakest concept from the newest Thursday
   * card on any of its assignments, with that card's percent, exactly as
   * stored (computed in code when the card was generated). A class with no
   * card has null, and the page says there is no Margin data yet. Nothing
   * here asks a model.
   */
  router.get("/api/prof/courses", async (_req, res) => {
    const courses = await Course.find().sort({ name: 1 }).lean();
    const work = await Assignment.find().select("course_id kind title").lean();
    const cards = await ThursdayCard.find({ assignment_id: { $in: work.map((a) => a._id) } }).sort({ generated_at: -1, _id: -1 }).lean();
    res.json({
      courses: courses.map((c) => {
        const mine = work.filter((a) => String(a.course_id) === String(c._id));
        const ids = new Set(mine.map((a) => String(a._id)));
        const card = cards.find((k) => ids.has(String(k.assignment_id)));
        const payload = card?.payload as { concept?: string; percent_struggling?: number } | undefined;
        return {
          ...courseCard(c),
          assignments: mine.filter((a) => (a.kind ?? "code") !== "topic").length,
          lessons: mine.filter((a) => a.kind === "topic").length,
          weakest: payload?.concept ? { concept: payload.concept, percent_struggling: payload.percent_struggling ?? null, assignment_title: mine.find((a) => String(a._id) === String(card!.assignment_id))?.title ?? "" } : null,
        };
      }),
    });
  });

  return router;
}
