import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { Assignment, CANARY, Student, findStudentAssignment } from "../src/models.ts";
import { clearCollections, dropTestDatabase, testUri } from "./support/db.ts";

// D-B1 done-when, checked against a real MongoDB:
//   1. Starting the API twice keeps the documents written before the restarts.
//   2. A student query cannot select answer_key (or the canary).
//
// The suite runs against the server in MONGODB_URI but in a database named for
// this process, so it never reads or deletes the team's real assignments and
// sessions. Without MONGODB_URI the suite is skipped, not passed: a skip in the
// output means nothing was verified.

const uri = testUri("margin_test");
const dbName = uri ? new URL(uri).pathname.slice(1) : "";
const skip = uri ? false : "MONGODB_URI is not set (or not a single-host URI), so nothing was verified";

// Two suite processes that both bind 4100 make one of them fail to listen.
// The pid keeps a second `npm test` off this run's ports.
const portBase = 20000 + (process.pid % 10000);

const backendDir = fileURLToPath(new URL("..", import.meta.url));

/**
 * Boots the real API process once and stops it after it reports listening.
 *
 * This runs `src/index.ts` exactly as `npm run dev` does, so the persistence
 * check covers whatever index.ts and connectDb do at boot. A unit test that
 * only reconnected Mongoose would miss a future wipe added to the boot path.
 * The port is above 20000 and includes the pid, so a dev server on 4000 and a
 * second run of this file do not bind the same port.
 */
function bootApiOnce(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/index.ts"], {
      cwd: backendDir,
      env: { ...process.env, MONGODB_URI: uri, PORT: String(port) },
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`API did not start within 20s. Output:\n${output}`));
    }, 20_000);

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      // A failed connection still lets the API listen, so require both lines.
      // Otherwise a broken database would look like a successful boot.
      if (output.includes("MongoDB connected") && output.includes("API listening")) {
        clearTimeout(timer);
        child.kill();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", () => {
      clearTimeout(timer);
      if (output.includes("MongoDB connected")) resolve(output);
      else reject(new Error(`API booted without a database connection. Output:\n${output}`));
    });
  });
}

describe("Mongoose models (D-B1)", { skip, concurrency: 1 }, () => {
  before(async () => {
    await mongoose.connect(uri!, { serverSelectionTimeoutMS: 10_000 });
    // deleteMany, not dropDatabase. A drop on Atlas can finish after this
    // hook returns and remove the assignment the next test just saved.
    await clearCollections();
  });

  after(async () => {
    await dropTestDatabase();
    await mongoose.disconnect();
  });

  test("documents survive two boots of the API", async () => {
    // The case: a professor saved the sum_list assignment and a student started
    // a session, then the API restarted twice. Both documents must still exist.
    const assignment = await Assignment.create({
      course_name: "Intro CS",
      title: "Write sum_list(xs) recursively",
      prompt: "Write sum_list(xs) recursively. It returns the sum of a list of numbers.",
      answer_key: "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])",
      notes: "Lecture 7, slides 12-16: base cases and recursive calls.",
      concepts: ["base_case", "recursive_call_progress", "return_value_propagation", "call_stack_tracing"],
      hint_ceiling: 3,
    });
    const student = await Student.create({ display_name: "Ada" });

    const firstBoot = await bootApiOnce(portBase);
    const secondBoot = await bootApiOnce(portBase + 1);
    // The child must attach to this run's database. A boot that logged a
    // different name would be a second database, and a missing document would
    // be a misdirected connection rather than a wiped one.
    assert.match(firstBoot, new RegExp(`database "${dbName}"`));
    assert.match(secondBoot, new RegExp(`database "${dbName}"`));

    const reloaded = await Assignment.findById(assignment._id).select("+answer_key +canary").lean();
    assert.ok(reloaded, "the assignment is gone after two boots");
    assert.equal(reloaded.title, "Write sum_list(xs) recursively");
    assert.match(reloaded.answer_key, /return xs\[0\] \+ sum_list\(xs\[1:\]\)/);
    assert.equal(reloaded.canary, CANARY);
    assert.ok(await Student.findById(student._id), "the student is gone after two boots");
  });

  test("a student query cannot select answer_key or the canary", async () => {
    // The case: a student opens the assignment. The response body must not
    // contain the key's field name, the canary, or any line of the solution.
    const key = "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])";
    const created = await Assignment.create({
      course_name: "Intro CS",
      title: "Write sum_list(xs) recursively",
      prompt: "Write sum_list(xs) recursively.",
      answer_key: key,
      concepts: ["base_case"],
    });

    const view = await findStudentAssignment(String(created._id));
    assert.ok(view);
    const body = JSON.stringify(view);
    assert.ok(!body.includes("answer_key"), "student view names answer_key");
    assert.ok(!body.includes(CANARY), "student view contains the canary");
    assert.ok(!body.includes("return xs[0] + sum_list(xs[1:])"), "student view contains the solution");

    // A plain find, the shape a hurried route might use, also omits the key.
    const plain = await Assignment.findById(created._id).lean();
    assert.equal(plain?.answer_key, undefined);
    assert.equal(plain?.canary, undefined);

    // Even a document loaded with the key drops it when serialized, so
    // `res.json(doc)` cannot send it by accident.
    const withKey = await Assignment.findById(created._id).select("+answer_key +canary");
    const serialized = JSON.stringify(withKey);
    assert.ok(!serialized.includes("answer_key"));
    assert.ok(!serialized.includes(CANARY));
  });

  test("a malformed id is not found instead of throwing", async () => {
    // The case: a student URL with a bad id. The route should answer 404.
    assert.equal(await findStudentAssignment("not-an-id"), null);
  });
});
