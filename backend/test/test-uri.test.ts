import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_DB_NAME, testUri, uniqueDbName } from "./support/db.ts";

// The test databases' names. Atlas refuses a name over 38 bytes, and a
// refusal inside before() leaves the connection open, which hung `npm test`
// instead of failing it once the pid reached 6 digits. No database is opened.

describe("uniqueDbName", () => {
  it("stays within Atlas's limit for the longest test name and the largest pid", () => {
    // Case: the longest name a test file passes, with a 7-digit pid (Linux
    // allows pids up to 4194304). Before the fix this was 40 bytes.
    const name = uniqueDbName("margin_test_assignments", 4194304);
    assert.ok(Buffer.byteLength(name) <= MAX_DB_NAME, `${name} is ${name.length} bytes`);
    assert.ok(name.startsWith("margin_test_"));
  });

  it("gives two runs of the same file different names", () => {
    assert.notEqual(uniqueDbName("margin_test_vision", 107915), uniqueDbName("margin_test_vision", 107915));
  });

  it("keeps the host and credentials and only replaces the database", () => {
    const uri = testUri("margin_test_models", "mongodb+srv://u:p@cluster0.example.net/margin?retryWrites=true");
    const url = new URL(uri as string);
    assert.equal(url.host, "cluster0.example.net");
    assert.equal(url.username, "u");
    assert.equal(url.search, "?retryWrites=true");
    assert.ok(url.pathname.slice(1).length <= MAX_DB_NAME);
  });
});
