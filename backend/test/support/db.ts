import { randomBytes } from "node:crypto";
import mongoose from "mongoose";

// Shared database setup for the backend tests. It lives under test/support so
// the `test/*.ts` glob in package.json does not run it as a test file.

/**
 * Points MONGODB_URI at a database used only by this process.
 *
 * The path of a MongoDB URI is the database name, so replacing it keeps the
 * host, credentials, and options. The caller's name separates test files,
 * because node --test runs those files at the same time. The pid and a random
 * suffix separate two processes running the same file: a second `npm test`
 * that clears a shared name deletes this run's assignment while the API is
 * still booting, and the persistence check then looks like the boot wiped it.
 *
 * Atlas refuses a database name over 38 bytes, and the refusal comes from the
 * first write, inside before(). The suite then never reaches after(), the
 * connection stays open, and node --test waits forever instead of failing.
 * The pid's length varies (5 digits one run, 6 the next), so a fixed-length
 * guess passed for days and then hung. The name is therefore cut to fit: the
 * unique suffix is kept whole and the caller's name is shortened if needed.
 *
 * Returns undefined for no URI, or for one the URL parser cannot read (such as
 * a multi-host replica set string). The caller skips instead of touching the
 * real database.
 */
export function testUri(dbName: string, uri = process.env.MONGODB_URI): string | undefined {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    url.pathname = `/${uniqueDbName(dbName)}`;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Atlas's limit on a database name, in bytes. */
export const MAX_DB_NAME = 38;

/**
 * The caller's name plus this process's pid and 4 random bytes, at most
 * MAX_DB_NAME bytes. The pid is written in base 36 to keep the suffix short;
 * the suffix is what keeps two runs apart, so it is never the part cut.
 */
export function uniqueDbName(dbName: string, pid = process.pid): string {
  const suffix = `_${pid.toString(36)}_${randomBytes(4).toString("hex")}`;
  return dbName.slice(0, MAX_DB_NAME - suffix.length) + suffix;
}

/**
 * Empties every model's collection on the current connection.
 *
 * This is used instead of `dropDatabase` before a test writes. On Atlas a drop
 * finishes in the background, and a document written right after it can be
 * removed by the tail of the drop, which made the two-boot test fail about one
 * run in three. `deleteMany` completes before it returns, so the next write is
 * safe. It only ever runs on the connection opened with `testUri`, never the
 * real one.
 */
export async function clearCollections(): Promise<void> {
  for (const collection of Object.values(mongoose.connection.collections)) {
    await collection.deleteMany({});
  }
}

/**
 * Removes this run's database after the last read.
 *
 * The name from `testUri` is unique, so leaving it would keep an empty
 * database on the cluster for every run. The drop is safe here because nothing
 * in the suite writes after it. A drop before the writes is the race
 * `clearCollections` exists to avoid.
 */
export async function dropTestDatabase(): Promise<void> {
  await mongoose.connection.dropDatabase();
}
