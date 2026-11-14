import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { dbState } from "./db.ts";
import { createRouter, type RouteDeps } from "./routes.ts";

/**
 * Builds the Express app without opening a port or a database connection.
 *
 * index.ts connects and listens; tests call this directly and listen on a
 * free port against the `margin_test` database. Keeping the two apart is what
 * lets a route test run the exact middleware the dev server runs.
 */
export function createApp(deps: RouteDeps = {}): express.Express {
  const app = express();

  // Only the Next.js dev server may call the API from a browser. Widening this
  // to "*" would let any page a professor has open read class data.
  app.use(cors({ origin: "http://localhost:3000" }));

  // A phone photo sent as base64 for snap-your-work is a few MB. 10 MB fits it
  // and still refuses an accidental upload of something much larger. A body
  // over the limit is a 413 from the handler below, not a crash.
  app.use(express.json({ limit: "10mb" }));

  // `db` lets a teammate tell "no MONGODB_URI in .env" from "Atlas refused the
  // connection" without reading the server log. It never includes the URI.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, db: dbState() });
  });

  // Tests pass model stand-ins here; the dev server passes nothing.
  app.use(createRouter(deps));

  // Last-resort handler. Express 5 forwards rejected async handlers here. The
  // reply is a fixed string because an error message can quote a request body,
  // and the assignment body carries the answer key.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // body-parser marks malformed JSON with status 400 and an oversized body
    // with 413. Answer those as the client's mistake, not a server failure.
    const status = (err as { status?: number }).status;
    if (status === 400) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    if (status === 413) {
      res.status(413).json({ error: "body_too_large" });
      return;
    }
    console.error("request failed:", (err as Error).name);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
