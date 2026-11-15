import mongoose from "mongoose";

// Every Askretes record (assignments, students, turns, labels, cards) lives in
// the MongoDB database named by MONGODB_URI. The string comes only from the
// environment so the credentials never land in the repo; `.env.example` holds
// an empty placeholder and `.env` is gitignored.

// Mongoose queues queries while it is disconnected and waits for a connection
// that may never come. With buffering off, a route that touches the database
// before the connection exists fails at once with an error instead of hanging
// the request until the client gives up. Turning this back on would make a
// missing MONGODB_URI look like a slow API rather than a broken one.
mongoose.set("bufferCommands", false);

// Strict query mode drops filter keys that are not in the schema. Without it a
// typo such as `{ assignmentId: x }` would be sent as-is and silently match
// nothing, which on the dashboard reads as "nobody has studied yet".
mongoose.set("strictQuery", true);

/** What `/health` reports about the database, so a teammate can tell a missing URI from a bad one. */
export type DbState = "not_configured" | "connecting" | "connected" | "error";

let state: DbState = "not_configured";

/** The database state for `/health`. It never includes the URI, which can carry a password. */
export function dbState(): DbState {
  return state;
}

/**
 * Opens the one shared Mongoose connection.
 *
 * Boot never drops, truncates, or resets a collection. That is what makes a
 * second start of the API see the documents written during the first one, and
 * it is the D-B1 done-when check. Index creation from the schemas only adds
 * indexes; it never deletes documents. Do not add `dropDatabase`,
 * `deleteMany({})`, or `syncIndexes()` here: `syncIndexes` drops indexes that
 * are not in the schema, and the others erase every real session.
 *
 * An empty MONGODB_URI is not fatal. The API still starts so `/health` and the
 * frontend run for a teammate who has not set the database up yet. Any route
 * that needs data then fails fast because buffering is off (see above).
 */
export async function connectDb(uri = process.env.MONGODB_URI): Promise<void> {
  if (!uri) {
    state = "not_configured";
    console.warn("MONGODB_URI is empty. The API is running without a database.");
    return;
  }

  state = "connecting";
  try {
    // A short server-selection timeout keeps a wrong host or a blocked Atlas IP
    // from stalling boot for the 30-second default.
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    state = "connected";
    // Log the database name only. The URI itself can contain the password.
    console.log(`MongoDB connected to database "${mongoose.connection.name}".`);
  } catch (err) {
    state = "error";
    // The driver's message names the host problem without echoing the password.
    console.error(`MongoDB connection failed: ${(err as Error).message}`);
  }
}

/** Closes the connection so tests and a clean shutdown do not leave sockets open. */
export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  state = "not_configured";
}
