import assert from "node:assert/strict";
import { test } from "node:test";
import { parseH3KeyImport } from "./h3KeyImport.ts";

const row = (email, key, credits = "999", password = "account-password", emailPassword = "mail-password") =>
  `${email}----${password}----${credits}----${key}----${emailPassword}`;

test("parses BOM, CRLF, blank lines; strips all source fields except consumer key and anonymous group", async () => {
  const key = "0123456789abcdef0123456789abcdef";
  const source = `\uFEFF${row("Person@example.com", key)}\r\n\r\n`;
  const preview = await parseH3KeyImport(source);
  assert.equal(preview.entries.length, 1);
  assert.equal(preview.entries[0].apiKey, key);
  assert.match(preview.entries[0].accountGroup, /^acct_[a-f0-9]{24}$/);
  assert.deepEqual(Object.keys(preview.entries[0]).sort(), ["accountGroup", "apiKey", "line"]);
  const serialized = JSON.stringify(preview);
  for (const value of ["Person@example.com", "account-password", "999", "mail-password"])
    assert.equal(serialized.includes(value), false);
});

test("reports malformed rows without echoing their contents and counts duplicates/conflicts", async () => {
  const key = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const preview = await parseH3KeyImport([
    row("same@example.com", key),
    row("same@example.com", key.toUpperCase()),
    row("other@example.com", key),
    "malformed-secret-content",
    row("not-an-email", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    row("valid@example.com", "bad-key", "old credits"),
  ].join("\n"));
  assert.equal(preview.entries.length, 1);
  assert.equal(preview.duplicateCount, 1);
  assert.equal(preview.failures.length, 4);
  assert.deepEqual(preview.failures.map(({ line }) => line), [3, 4, 5, 6]);
  assert.equal(JSON.stringify(preview).includes("malformed-secret-content"), false);
});

test("rejects files over 1 MB and caps accepted rows at 100 keys", async () => {
  await assert.rejects(parseH3KeyImport("x".repeat(1024 * 1024 + 1)), /超过 1 MB/);
  const rows = Array.from({ length: 101 }, (_, i) => row(`user${i}@example.com`, i.toString(16).padStart(32, "0"))).join("\n");
  const preview = await parseH3KeyImport(rows);
  assert.equal(preview.entries.length, 100);
  assert.equal(preview.failures.length, 1);
  assert.equal(preview.failures[0].line, 101);
});
