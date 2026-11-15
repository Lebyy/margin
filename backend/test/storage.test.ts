// Cases for the blob store. Files are written to a temporary folder that is removed afterwards; no database, no network.
// The rules under test: what is written is what is read back, and no key can reach outside the storage folder.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { checkKey, GcsStore, LocalStore } from "../src/storage.ts";

const root = await mkdtemp(path.join(tmpdir(), "margin-storage-"));
after(() => rm(root, { recursive: true, force: true }));

describe("the local blob store", () => {
  // Case: a file and its type go in and come back the same.
  it("reads back what it wrote, with its type", async () => {
    const store = new LocalStore(root);
    await store.put("attachments/s1/f1", Buffer.from("hello"), "text/plain; charset=utf-8");
    const got = await store.get("attachments/s1/f1");
    assert.equal(got?.bytes.toString(), "hello");
    assert.equal(got?.contentType, "text/plain; charset=utf-8");
  });

  // Case: a key nobody wrote reads as missing, not as an error.
  it("answers null for a key it does not have", async () => {
    assert.equal(await new LocalStore(root).get("attachments/none/none"), null);
  });

  // Case: keys that try to climb out of the folder, start at the root, or carry odd characters are refused before any disk access.
  it("refuses keys that could leave the storage folder", () => {
    for (const bad of ["../etc/passwd", "a/../../b", "/abs/path", "a//b", "a/./b", "a\\b", "a b", ""]) {
      assert.throws(() => checkKey(bad), /invalid storage key/, bad);
    }
    assert.equal(checkKey("canvas/abc/123"), "canvas/abc/123");
  });

  // Case: the cloud driver is not configured yet, and says so instead of dropping the file.
  it("does not pretend to save to Google Cloud before it is set up", async () => {
    await assert.rejects(new GcsStore("").put(), /not set up yet/);
  });
});
