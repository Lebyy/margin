// Which professor is asking, and whether the class a professor route touches is theirs.
//
// Margin has no real login this weekend (project law: "no real auth"). A
// professor is the profile chosen in the header menu, and the professor pages
// send that name in the `x-margin-professor` header on every /api/prof call.
// This file turns that label into a rule: a professor route that names a class
// (by assignment, by class id, by lecture, or by class name in a saved form)
// answers 403 `not_your_class` when the class's professor is someone else, and
// the professor lists only return that professor's classes.
//
// What this is not: security. The header is a label anyone can type, the same
// as the profile menu, which still lets a person switch professors. It keeps
// one professor's dashboard from showing another's class by default and by
// accident. A request with no header is not scoped, which is how the tests and
// the simulation scripts call these routes; the professor pages always send it.

import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { Assignment, Course, LectureFile } from "./models.ts";

export const PROFESSOR_HEADER = "x-margin-professor";

/** The professor name the page sent, or null when the request is unscoped. The page URI-encodes it so any name fits in a header. */
export function professorOf(req: Request): string | null {
  const raw = req.get(PROFESSOR_HEADER);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).trim() || null;
  } catch {
    return null;
  }
}

const isId = (v: unknown): v is string => typeof v === "string" && mongoose.isValidObjectId(v);

/** The class of an assignment, or null for an unknown id. */
async function courseOfAssignment(id: unknown) {
  if (!isId(id)) return null;
  return (await Assignment.findById(id).select("course_id").lean())?.course_id ?? null;
}

/**
 * The class this professor request is about, or undefined when the route does not name one
 * (a new class, a new assignment under a new name, a draft already tied to a class).
 */
async function classOf(req: Request): Promise<unknown> {
  const path = req.path;
  const body = (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {}) as Record<string, unknown>;
  if (req.query.assignment_id !== undefined) return courseOfAssignment(req.query.assignment_id);
  let m = /^\/api\/prof\/assignments\/([^/]+)$/.exec(path);
  if (m) return courseOfAssignment(m[1]);
  m = /^\/api\/prof\/courses\/([^/]+)(?:\/|$)/.exec(path);
  if (m) return isId(m[1]) ? m[1] : null;
  m = /^\/api\/prof\/lectures\/([^/]+)$/.exec(path);
  if (m) return isId(m[1]) ? ((await LectureFile.findById(m[1]).select("course_id").lean())?.course_id ?? null) : null;
  if (path === "/api/prof/courses" && req.method === "POST") {
    if (isId(body.id)) return body.id;
    if (typeof body.name === "string") return (await Course.findOne({ name: body.name.trim() }).select("_id").lean())?._id;
    return undefined;
  }
  if (path === "/api/prof/assignments" && req.method === "POST") {
    if (isId(body.id)) return courseOfAssignment(body.id);
    if (typeof body.course_name === "string") return (await Course.findOne({ name: body.course_name.trim() }).select("_id").lean())?._id;
  }
  return undefined;
}

/**
 * Express middleware for every /api/prof route: refuses a named class that is not this professor's.
 * An unknown class id is left to the route, which answers its own 404, so the two errors stay distinct.
 */
export async function scopeToProfessor(req: Request, res: Response, next: NextFunction): Promise<void> {
  const professor = professorOf(req);
  if (!professor || !req.path.startsWith("/api/prof/")) return next();
  const courseId = await classOf(req);
  if (!courseId) return next();
  const course = await Course.findById(courseId).select("professor").lean();
  if (course && course.professor !== professor) {
    res.status(403).json({ error: "not_your_class" });
    return;
  }
  next();
}
