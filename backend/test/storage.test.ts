// Cases for the blob store. Files are written to a temporary folder that is removed afterwards; no database, no network.
// The rules under test: what is written is what is read back, and no key can reach outside the storage folder.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { checkKey, gcsCredentials, GcsStore, LocalStore, type GcsClient } from "../src/storage.ts";

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

});

/** An in-memory stand-in for the Google client: objects in a Map, a 404-coded error for a missing one, and a log of what was asked. */
function fakeGcs() {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const calls: string[] = [];
  const missing = () => Object.assign(new Error("No such object"), { code: 404 });
  const client: GcsClient = {
    bucket: (name) => ({
      file: (key) => ({
        save: async (data, options) => {
          calls.push(`save ${name}/${key} resumable=${options.resumable}`);
          objects.set(`${name}/${key}`, { bytes: Buffer.from(data), contentType: options.metadata.contentType });
        },
        download: async () => {
          const o = objects.get(`${name}/${key}`);
          if (!o) throw missing();
          return [o.bytes];
        },
        getMetadata: async () => {
          const o = objects.get(`${name}/${key}`);
          if (!o) throw missing();
          return [{ contentType: o.contentType }];
        },
      }),
    }),
  };
  return { client, calls };
}

describe("the Google Cloud Storage blob store", () => {
  // Case: a file and its type go into the named bucket under the same key and come back the same, in one simple upload.
  it("reads back what it wrote, with its type, from the configured bucket", async () => {
    const { client, calls } = fakeGcs();
    const store = new GcsStore("askretes-test-bucket", client);
    await store.put("attachments/s1/f1", Buffer.from("hello"), "image/png");
    const got = await store.get("attachments/s1/f1");
    assert.equal(got?.bytes.toString(), "hello");
    assert.equal(got?.contentType, "image/png");
    assert.deepEqual(calls, ["save askretes-test-bucket/attachments/s1/f1 resumable=false"]);
  });

  // Case: a missing object reads as null, like the local store; any other failure (here, a refused permission) is thrown, not hidden as "missing".
  it("answers null for a missing object and throws a real failure", async () => {
    const { client } = fakeGcs();
    assert.equal(await new GcsStore("b", client).get("attachments/none/none"), null);
    const denied: GcsClient = {
      bucket: () => ({
        file: () => ({
          save: async () => undefined,
          download: async () => {
            throw Object.assign(new Error("permission denied"), { code: 403 });
          },
          getMetadata: async () => [{}],
        }),
      }),
    };
    await assert.rejects(new GcsStore("b", denied).get("a/b"), /permission denied/);
  });

  // Case: keys are checked before the bucket is asked, and an unset bucket is a plain setup error, not a Google 404.
  it("refuses bad keys and an unset bucket before any request", async () => {
    const { client, calls } = fakeGcs();
    await assert.rejects(new GcsStore("b", client).put("../escape", Buffer.from("x"), "text/plain"), /invalid storage key/);
    await assert.rejects(new GcsStore("", client).put("a/b", Buffer.from("x"), "text/plain"), /needs GCS_BUCKET/);
    assert.deepEqual(calls, []);
  });
});

describe("the Google Cloud key from .env", () => {
  // Case: the key file, base64 on one line, becomes the client's credentials and project. The private key used here
  // is a made-up string; nothing is signed and nothing is sent.
  it("decodes a base64 service account key", () => {
    const file = { type: "service_account", project_id: "p-1", client_email: "svc@p-1.iam.gserviceaccount.com", private_key: "made-up-private-key-for-tests" };
    const got = gcsCredentials(Buffer.from(JSON.stringify(file)).toString("base64"));
    assert.deepEqual(got, { credentials: { client_email: file.client_email, private_key: file.private_key }, projectId: "p-1" });
  });

  // Case: unset means "let the library find GOOGLE_APPLICATION_CREDENTIALS"; garbage or a non-key is a setup error
  // whose message carries none of the value.
  it("falls back when unset and refuses anything that is not a key, without echoing it", () => {
    // An empty value, not `undefined`: undefined would mean "read GCS_KEY_BASE64 from the environment", and npm test loads .env.
    assert.deepEqual(gcsCredentials(""), {});
    assert.deepEqual(gcsCredentials("  "), {});
    for (const bad of ["not-base64-secret!!", Buffer.from('{"type":"authorized_user","secret":"s3cr3t"}').toString("base64")]) {
      assert.throws(
        () => gcsCredentials(bad),
        (e: Error) => /not a base64 service account key/.test(e.message) && !e.message.includes("s3cr3t") && !e.message.includes(bad),
      );
    }
  });
});
