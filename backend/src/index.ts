import cors from "cors";
import express from "express";
import { connectDb, dbState } from "./db.ts";

const port = Number(process.env.PORT) || 4000;
const app = express();

// Only the Next.js dev server may call the API from a browser. Widening this
// to "*" would let any page a professor has open read class data.
app.use(cors({ origin: "http://localhost:3000" }));

// `db` lets a teammate tell "no MONGODB_URI in .env" from "Atlas refused the
// connection" without reading the server log. It never includes the URI.
app.get("/health", (_req, res) => {
  res.json({ ok: true, db: dbState() });
});

// The connection is opened before the port is bound so the first request
// already sees a connected (or clearly failed) database. connectDb never wipes
// a collection, so a restart keeps every document from the previous run.
await connectDb();

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
