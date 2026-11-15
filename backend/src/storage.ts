// Where Askretes keeps the files students give it: attached files, the canvas
// picture sent with a turn, and the pictures on a canvas.
//
// One small interface, two places it can point. `local` writes under a folder
// on this machine (STORAGE_DIR, by default `storage/` at the repo root, which
// is git-ignored). `gcs` is Google Cloud Storage: the GCS_BUCKET bucket,
// reached as the bucket-only `askretes-storage` service account.
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
 * The slice of the Google Cloud Storage client this file uses. The real client
 * (`@google-cloud/storage`) satisfies it; tests pass an in-memory stand-in, so
 * the suite never reaches Google.
 */
export type GcsClient = {
  bucket(name: string): {
    file(key: string): {
      save(data: Buffer, options: { contentType: string; resumable: boolean; metadata: { contentType: string } }): Promise<unknown>;
      download(): Promise<[Buffer]>;
      getMetadata(): Promise<[{ contentType?: string }]>;
    };
  };
};

/**
 * Google Cloud Storage: the bucket named by GCS_BUCKET, in the project's
 * us-east1 region, with public access prevented, so no object in it can be
 * made public. The server signs in as the `askretes-storage` service account,
 * which can read and write objects in this bucket and nothing else. Its key
 * comes from GCS_KEY_BASE64 in `.env` (the key file, base64 on one line, so a
 * teammate pastes one value; see `gcsCredentials`), or, if that is unset, from
 * the file named by GOOGLE_APPLICATION_CREDENTIALS, which the library reads.
 *
 * The content type is stored as the object's own metadata, so a read returns
 * what was written, as the local store's `.meta.json` does. Keys pass the same
 * `checkKey` as on disk. The client library is loaded only when this driver is
 * chosen, so a local setup and the tests never load it.
 */
export class GcsStore implements BlobStore {
  bucket: string;
  private client: Promise<GcsClient> | null;
  constructor(bucket: string, client?: GcsClient) {
    this.bucket = bucket.trim();
    this.client = client ? Promise.resolve(client) : null;
  }

  private file(key: string) {
    // An unset bucket is a setup mistake, said plainly at the first use rather than as Google's 404.
    if (!this.bucket) throw new Error("STORAGE_DRIVER=gcs needs GCS_BUCKET, the bucket's name.");
    const checked = checkKey(key);
    this.client ??= makeGcsClient();
    return this.client.then((c) => c.bucket(this.bucket).file(checked));
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    // resumable: false is one request; these files are small (attachments and canvas pictures), and a resumable upload costs an extra round trip.
    await (await this.file(key)).save(bytes, { contentType, resumable: false, metadata: { contentType } });
  }

  async get(key: string): Promise<Stored | null> {
    const file = await this.file(key);
    try {
      const [[bytes], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
      return { bytes, contentType: meta.contentType ?? "application/octet-stream" };
    } catch (error) {
      // A key nobody wrote reads as missing, as on disk. Anything else (no permission, no network) is a real failure and is thrown.
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }
}

/**
 * The service account key from GCS_KEY_BASE64, as the options the Google client takes, or `{}` when it is unset
 * (the library then finds GOOGLE_APPLICATION_CREDENTIALS itself).
 *
 * The value is the downloaded key file, base64-encoded on one line: a JSON value would break `.env` on its quotes
 * and newlines. A value that does not decode to a service account key is a setup error, reported without any of
 * the value, because the value is a private key and an error message can end up in a log.
 */
export function gcsCredentials(raw = process.env.GCS_KEY_BASE64): { credentials?: { client_email: string; private_key: string }; projectId?: string } {
  if (!raw?.trim()) return {};
  let key: { type?: string; client_email?: string; private_key?: string; project_id?: string };
  try {
    key = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch {
    throw new Error("GCS_KEY_BASE64 is not a base64 service account key file.");
  }
  if (key.type !== "service_account" || !key.client_email || !key.private_key) {
    throw new Error("GCS_KEY_BASE64 is not a base64 service account key file.");
  }
  return { credentials: { client_email: key.client_email, private_key: key.private_key }, projectId: key.project_id };
}

/**
 * The real Google client. With GCS_KEY_BASE64 set it signs in as that service account through a JWT client handed
 * over as `authClient` (passing the key as the `credentials` option works too, but the library now prints a
 * deprecation warning for it on every start). The scope is read and write on objects, which is all the account's
 * bucket role allows anyway. Unset, the library finds GOOGLE_APPLICATION_CREDENTIALS or the machine's login.
 */
async function makeGcsClient(): Promise<GcsClient> {
  const [{ Storage }, { JWT }] = await Promise.all([import("@google-cloud/storage"), import("google-auth-library")]);
  const { credentials, projectId } = gcsCredentials();
  if (!credentials) return new Storage() as unknown as GcsClient;
  const authClient = new JWT({ email: credentials.client_email, key: credentials.private_key, scopes: ["https://www.googleapis.com/auth/devstorage.read_write"] });
  return new Storage({ projectId, authClient }) as unknown as GcsClient;
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
