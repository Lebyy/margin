import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { dbState } from "./db.ts";
import { Assignment, CANARY } from "./models.ts";

// The HTTP routes David owns (board contract: routes.ts). Every record the
// product shows exists because a request here created it. There is no seed
// route and no script that fills the database, so an empty dashboard is the
// honest state before anyone uses the app.

/**
 * Refuses data routes while MongoDB is not connected.
 *
 * Buffering is off (see db.ts), so a query without a connection throws. This
 * turns that into a clear 503 instead of a generic 500, and it runs before the
 * body is validated so a teammate without MONGODB_URI sees the real cause
 * first. `/health` is registered outside this router and keeps working.
 */
function requireDb(_req: Request, res: Response, next: NextFunction): void {
  if (dbState() !== "connected") {
    res.status(503).json({ error: "database_unavailable" });
    return;
  }
  next();
}

/**
 * What a professor submits from the setup form.
 *
 * The canary is not in this schema. The server always stores `CANARY`, so a
 * client cannot set a different value that the guard does not know to look
 * for. Unknown keys are stripped by zod, which also means a request cannot
 * slip in a field such as `is_synthetic`.
 */
const assignmentInput = z.object({
  course_name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  answer_key: z.string().trim().min(1),
  notes: z.string().default(""),
  // The scribe may only label turns with these, and the heatmap gets one row
  // per concept. Duplicates would give the professor two rows for one idea.
  concepts: z
    .array(z.string().trim().min(1))
    .min(1)
    .refine((list) => new Set(list).size === list.length, "concepts must not repeat"),
  hint_ceiling: z.number().int().min(1).max(3).default(3),
});

export function createRouter(): Router {
  const router = Router();
  router.use(requireDb);

  /**
   * POST /api/prof/assignments: a professor saves an assignment.
   *
   * This is the only way an assignment enters the database (D-B2). The
   * response is the saved document passed through the model's toJSON, which
   * drops `answer_key` and the canary, so even the professor's own reply does
   * not carry the key back over the wire. Update by id is D-B3.
   */
  router.post("/api/prof/assignments", async (req, res) => {
    const parsed = assignmentInput.safeParse(req.body);
    if (!parsed.success) {
      // Field paths and messages only. zod issues never echo the key's text
      // back, so a rejected request cannot leak the submitted solution in a log.
      res.status(400).json({
        error: "invalid_assignment",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }

    // `new` + `save` rather than `Assignment.create`: Mongoose 9's typings for
    // `create` reject a string array field, while the constructor accepts it.
    const saved = await new Assignment({ ...parsed.data, canary: CANARY }).save();
    res.status(201).json(saved.toJSON());
  });

  return router;
}
