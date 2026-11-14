// Shared done-state for the Margin board.
//
// docs/BOARD.md and docs/index.html stay the brief. They do not record which
// tasks are finished. This function does. The page and both agents call it, so
// a check made on one laptop is the check the other laptop loads.
//
// The map is one private blob, board/tasks.json, in the store connected to the
// margin-board project. Private means the blob URL is not a second public copy
// of the checklist. The function is the only reader and writer. Auth is the
// OIDC token Vercel injects into this function, plus BLOB_STORE_ID from the
// store connection. There is no read-write token in the repo, and this file
// must not grow one.
//
// A write is compare-and-swap on the blob etag. Two people can finish two
// different tasks at the same moment. Without the etag, the second write would
// save a map that never saw the first task. ifMatch makes that second write
// fail, and the retry reads the map that already has both.

import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  put,
} from "@vercel/blob";

const PATH = "board/tasks.json";

// Board ids are L-B1, D-F3, and the same shape. The POST is public, because a
// secret would have to live in the rule file and the rule file is in the repo.
// The pattern is what stops a request from storing an arbitrary key.
const TASK_ID = /^[LD]-[A-Z]\d+$/;

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { tasks } = await readMap();
      send(res, 200, { tasks });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "GET, POST");
      send(res, 405, { error: "use GET or POST" });
      return;
    }

    const body = readBody(req);
    const id = body.id;
    const done = body.done;
    if (typeof id !== "string" || !TASK_ID.test(id) || typeof done !== "boolean") {
      send(res, 400, { error: "id must be a board task id and done must be a boolean" });
      return;
    }

    const tasks = await save(id, done);
    send(res, 200, { tasks });
  } catch (error) {
    console.error("board store failed", error instanceof Error ? error.name : "error");
    send(res, 500, { error: "the board store did not answer" });
  }
}

function send(res, status, body) {
  // A cached GET would show a check the other person already removed.
  res.setHeader("cache-control", "no-store");
  res.status(status).json(body);
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Write one task and return the whole map.
 * Four attempts cover two overlapping writes. A fifth would mean the store is
 * failing, not that two people clicked at once, so the last error is returned.
 */
async function save(id, done) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readMap();
    const tasks = {
      ...current.tasks,
      [id]: { done, at: new Date().toISOString() },
    };
    try {
      await writeMap(tasks, current.etag);
      return tasks;
    } catch (error) {
      lastError = error;
      if (!isConflict(error)) throw error;
    }
  }
  throw lastError;
}

function isConflict(error) {
  if (error instanceof BlobPreconditionFailedError) return true;
  const message = String(error && error.message ? error.message : "");
  return message.includes("already exists") || message.toLowerCase().includes("precondition");
}

/**
 * Read the map. A missing blob is an empty board, which is how the store
 * starts. A blob that is not a task map throws, so a later POST cannot replace
 * it with a one-key file.
 */
async function readMap() {
  let result;
  try {
    result = await get(PATH, { access: "private", useCache: false });
  } catch (error) {
    if (error instanceof BlobNotFoundError) return { tasks: {}, etag: null };
    throw error;
  }
  // get() returns null when the pathname has never been written. That is the
  // empty board, not a failed read. Reading .statusCode off null is what made
  // the first GET a 500.
  if (!result) return { tasks: {}, etag: null };
  if (result.statusCode !== 200 || !result.stream) {
    throw new Error("board store returned no body");
  }
  const text = await new Response(result.stream).text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.tasks || typeof parsed.tasks !== "object" || Array.isArray(parsed.tasks)) {
    throw new Error("board store payload is not a task map");
  }
  return { tasks: onlyTasks(parsed.tasks), etag: result.blob.etag };
}

function onlyTasks(tasks) {
  const kept = {};
  for (const [id, row] of Object.entries(tasks)) {
    if (!TASK_ID.test(id) || !row || typeof row.done !== "boolean") continue;
    kept[id] = { done: row.done, at: typeof row.at === "string" ? row.at : "" };
  }
  return kept;
}

/**
 * First write creates the blob. Later writes send the etag from the read.
 * ifMatch is the condition: the store rejects the put when the etag is stale.
 */
async function writeMap(tasks, etag) {
  const options = {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    allowOverwrite: Boolean(etag),
  };
  if (etag) options.ifMatch = etag;
  await put(PATH, JSON.stringify({ tasks }), options);
}
