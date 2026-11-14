import { createApp } from "./app.ts";
import { connectDb } from "./db.ts";

const port = Number(process.env.PORT) || 4000;

// The connection is opened before the port is bound so the first request
// already sees a connected (or clearly failed) database. connectDb never wipes
// a collection, so a restart keeps every document from the previous run.
await connectDb();

createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
