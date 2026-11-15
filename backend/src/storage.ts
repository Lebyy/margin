// Where Askretes keeps the files students give it: attached files, the canvas
// picture sent with a turn, and the pictures on a canvas.
//
// One small interface, two places it can point. `local` writes under a folder
// on this machine (STORAGE_DIR, by default `storage/` at the repo root, which
// is git-ignored). `gcs` is Google Cloud Storage, for when the project has a
// bucket and keys; until then it refuses to start rather than pretend to save.
// The rest of the server only ever calls `blobs().put` and `blobs().get`, so
// moving to the bucket is one environment variable, not a code change.
//
// Keys are built by the server from ids it made (a session id, a random
// attachment id), never from text a client sent, and are checked again here:
// letters, digits, and `._-/` only, no `..`, no leading slash. A key can
// therefore never name a file outside the storage folder.
//
// What is stored is the student's own material, for their class. The answer
// key is not here: it stays a field of the assignment, read only by the guard.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Stored = { bytes: Buffer; contentType: string };

export interface BlobStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Stored | null>;
}

/** The checks every key passes before it touches a disk or a bucket. */
export function checkKey(key: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,400}$/.test(key) || key.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error("invalid storage key");
  }
  return key;
}

/**
 * Files on this machine. Each object is two files: the bytes, and a small
 * `.meta.json` beside them with the content type, so a read returns what was
 * written without guessing from a name.
 */
export class LocalStore implements BlobStore {
  root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private file(key: string): string {
    const full = path.resolve(this.root, checkKey(key));
    // The key check already rules this out; this is the second fence.
    if (!full.startsWith(this.root + path.sep)) throw new Error("invalid storage key");
    return full;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const full = this.file(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    await writeFile(`${full}.meta.json`, JSON.stringify({ contentType }));
  }

  async get(key: string): Promise<Stored | null> {
    const full = this.file(key);
    try {
      const [bytes, meta] = await Promise.all([readFile(full), readFile(`${full}.meta.json`, "utf8").catch(() => "{}")]);
      const contentType = (JSON.parse(meta) as { contentType?: string }).contentType ?? "application/octet-stream";
      return { bytes, contentType };
    } catch {
      return null;
    }
  }
}

/**
 * Google Cloud Storage, once the project has a bucket. Not wired yet: the keys
 * are not in this environment. Choosing it now fails at the first write with a
 * clear error, so nothing is silently dropped.
 */
export class GcsStore implements BlobStore {
  bucket: string;
  constructor(bucket: string) {
    this.bucket = bucket;
  }
  async put(): Promise<void> {
    throw new Error(`STORAGE_DRIVER=gcs is not set up yet (bucket ${this.bucket || "unset"}). Use STORAGE_DRIVER=local until the service account key is added.`);
  }
  async get(): Promise<Stored | null> {
    throw new Error("STORAGE_DRIVER=gcs is not set up yet.");
  }
}

let current: BlobStore | null = null;

/** The configured store, made on first use. Tests replace it with `useBlobStore`. */
export function blobs(): BlobStore {
  if (!current) {
    const driver = process.env.STORAGE_DRIVER ?? "local";
    current =
      driver === "gcs"
        ? new GcsStore(process.env.GCS_BUCKET ?? "")
        : new LocalStore(process.env.STORAGE_DIR ?? path.resolve(import.meta.dirname, "../../storage"));
  }
  return current;
}

export function useBlobStore(store: BlobStore): void {
  current = store;
}
