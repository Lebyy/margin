// Copies the files a machine kept in the local blob store (`storage/`) into the Google Cloud Storage bucket.
//
// Before the bucket existed, every attachment and canvas picture was written under `storage/` on whichever
// laptop ran the API (STORAGE_DRIVER=local). Messages in the shared `margin` database name those files by key,
// so a teammate who switches to the bucket needs them there too, or those pictures and files stop opening.
// This uploads each file under the same key, with the content type its `.meta.json` recorded, through the
// same GcsStore (and key checks) the server uses. Running it twice is safe: an object is simply written
// again with the same bytes. It reads files and writes objects only; it never touches the database.
//
// Usage, from backend/, with STORAGE_DRIVER=gcs, GCS_BUCKET and GCS_KEY_BASE64 in ../.env:
//   npm run storage:upload-local              upload everything under ../storage
//   npm run storage:upload-local -- --dry-run  list what would be uploaded, upload nothing
// LOCAL_STORAGE_DIR overrides the folder (default: STORAGE_DIR, else storage/ at the repo root).

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { checkKey, GcsStore } from "../src/storage.ts";

const dryRun = process.argv.includes("--dry-run");
const root = path.resolve(process.env.LOCAL_STORAGE_DIR ?? process.env.STORAGE_DIR ?? path.resolve(import.meta.dirname, "../../storage"));
const bucket = process.env.GCS_BUCKET ?? "";
if (!bucket) throw new Error("Set GCS_BUCKET in .env first (the bucket's name).");

/** Every stored object under the folder: the data files, not their `.meta.json` companions. */
async function* objects(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* objects(full);
    else if (e.isFile() && !e.name.endsWith(".meta.json")) yield full;
  }
}

const store = new GcsStore(bucket);
let uploaded = 0;
let skipped = 0;
for await (const file of objects(root)) {
  // The key is the path under the folder with forward slashes, exactly as LocalStore wrote it.
  const key = path.relative(root, file).split(path.sep).join("/");
  try {
    checkKey(key);
  } catch {
    console.log(`skip (not a storage key): ${key}`);
    skipped += 1;
    continue;
  }
  const meta = await readFile(`${file}.meta.json`, "utf8").catch(() => "{}");
  const contentType = (JSON.parse(meta) as { contentType?: string }).contentType ?? "application/octet-stream";
  if (dryRun) {
    console.log(`would upload ${key} (${contentType})`);
  } else {
    await store.put(key, await readFile(file), contentType);
    console.log(`uploaded ${key}`);
  }
  uploaded += 1;
}
console.log(`${dryRun ? "Would upload" : "Uploaded"} ${uploaded} file(s) from ${root} to gs://${bucket}${skipped ? `, skipped ${skipped}` : ""}.`);
