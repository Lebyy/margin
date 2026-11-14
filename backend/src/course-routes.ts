// The course-portal routes: My courses, joining a class, the assignment list
// with due dates and status, and the professor's course cards.
//
// None of these call a model. Every number here (due this week, status) is
// counted from rows people created: an enrollment exists because a student
// joined, a status because a session was started or submitted. Assignment
// rows are read with an explicit field list that never includes the key, the
// question keys, or the canary, so no response built here can carry them.

import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { accentFor, Assignment, Course, Enrollment, Session, Student, ThursdayCard } from "./models.ts";

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

export function createCourseRouter(): Router {
  const router = Router();

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
