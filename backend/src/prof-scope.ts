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

/**
 * Who teaches the class a request names, in one round trip: `undefined` when the route names no class,
 * `null` when the named class (or assignment, or lecture) does not exist, else the class's professor label.
 * An assignment or a lecture is joined to its class inside the database ($lookup) rather than read in two
 * queries, because every professor request pays this before its own work and the database is a network hop away.
 */
async function teacherOf(req: Request): Promise<string | null | undefined> {
  const path = req.path;
  const body = (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {}) as Record<string, unknown>;
  const viaClass = async (from: "assignments" | "lecture_files", id: unknown) => {
    if (!isId(id)) return null;
    const model = from === "assignments" ? Assignment : LectureFile;
    const [row] = await model.aggregate<{ classes: number; professor?: string | null }>([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      { $lookup: { from: "courses", localField: "course_id", foreignField: "_id", as: "c" } },
      { $project: { classes: { $size: "$c" }, professor: { $first: "$c.professor" } } },
    ]);
    if (!row) return null;
    // An assignment saved before classes existed has none; nothing to check, as before.
    return row.classes === 0 ? undefined : (row.professor ?? "");
  };
  const byCourse = async (filter: Record<string, unknown>) => {
    const c = await Course.findOne(filter).select("professor").lean();
    return c ? (c.professor ?? "") : null;
  };
  if (req.query.assignment_id !== undefined) return viaClass("assignments", req.query.assignment_id);
  let m = /^\/api\/prof\/assignments\/([^/]+)$/.exec(path);
  if (m) return viaClass("assignments", m[1]);
  m = /^\/api\/prof\/courses\/([^/]+)(?:\/|$)/.exec(path);
  if (m) return isId(m[1]) ? byCourse({ _id: m[1] }) : null;
  m = /^\/api\/prof\/lectures\/([^/]+)$/.exec(path);
  if (m) return viaClass("lecture_files", m[1]);
  if (path === "/api/prof/courses" && req.method === "POST") {
    if (isId(body.id)) return byCourse({ _id: body.id });
    // A new class name is no one's yet; an existing name belongs to its professor.
    if (typeof body.name === "string") return (await byCourse({ name: body.name.trim() })) ?? undefined;
    return undefined;
  }
  if (path === "/api/prof/assignments" && req.method === "POST") {
    if (isId(body.id)) return viaClass("assignments", body.id);
    if (typeof body.course_name === "string") return (await byCourse({ name: body.course_name.trim() })) ?? undefined;
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
  const teacher = await teacherOf(req);
  if (typeof teacher === "string" && teacher !== professor) {
    res.status(403).json({ error: "not_your_class" });
    return;
  }
  next();
}
