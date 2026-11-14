import mongoose from "mongoose";

// Shared database setup for the backend tests. It lives under test/support so
// the `test/*.ts` glob in package.json does not run it as a test file.

/**
 * Points MONGODB_URI at a database used only by one test file.
 *
 * The path of a MongoDB URI is the database name, so replacing it keeps the
 * host, credentials, and options. Each test file passes its own name because
 * node --test runs files in parallel processes, and two files clearing one
 * database would delete each other's documents mid-test. Returns undefined for
 * no URI, or for one the URL parser cannot read (such as a multi-host replica
 * set string), and the file then skips instead of touching the real database.
 */
export function testUri(dbName: string, uri = process.env.MONGODB_URI): string | undefined {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    url.pathname = `/${dbName}`;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Empties every model's collection on the current connection.
 *
 * This is used instead of `dropDatabase`. On Atlas a drop finishes in the
 * background, and a document written right after it can be removed by the
 * tail of the drop, which made the two-boot test fail about one run in three.
 * `deleteMany` completes before it returns, so the next write is safe. It
 * only ever runs on the connection opened with `testUri`, never the real one.
 */
export async function clearCollections(): Promise<void> {
  for (const collection of Object.values(mongoose.connection.collections)) {
    await collection.deleteMany({});
  }
}
