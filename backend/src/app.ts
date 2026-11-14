import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { dbState } from "./db.ts";
import { createRouter } from "./routes.ts";

/**
 * Builds the Express app without opening a port or a database connection.
 *
 * index.ts connects and listens; tests call this directly and listen on a
 * free port against the `margin_test` database. Keeping the two apart is what
 * lets a route test run the exact middleware the dev server runs.
 */
export function createApp(): express.Express {
  const app = express();

  // Only the Next.js dev server may call the API from a browser. Widening this
  // to "*" would let any page a professor has open read class data.
  app.use(cors({ origin: "http://localhost:3000" }));

  // The setup form posts lecture notes, which can be long. 1 MB is far above a
  // real assignment and still stops an accidental upload of a whole file.
  app.use(express.json({ limit: "1mb" }));

  // `db` lets a teammate tell "no MONGODB_URI in .env" from "Atlas refused the
  // connection" without reading the server log. It never includes the URI.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, db: dbState() });
  });

  app.use(createRouter());

  // Last-resort handler. Express 5 forwards rejected async handlers here. The
  // reply is a fixed string because an error message can quote a request body,
  // and the assignment body carries the answer key.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // body-parser marks malformed JSON with status 400. Answer that as the
    // client's mistake instead of a server failure.
    if ((err as { status?: number }).status === 400) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    console.error("request failed:", (err as Error).name);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
