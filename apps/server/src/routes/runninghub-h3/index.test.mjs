import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import router from "./index.ts";

const nativeFetch = globalThis.fetch;
const serviceToken = "a".repeat(64);
const fakeKey = {
  keyId: "rhkey_00000000-0000-4000-8000-000000000001",
  accountGroup: "acct_abcdef0123456789abcdef01",
  enabled: false,
  consumerStatus: "consumer",
  accountStatus: { remainCoins: 321, remainMoney: null, currency: null, currentTaskCount: 0 },
  checkedAt: "2026-10-11T00:00:00.000Z",
  fingerprint: "NEVER_RETURN_THIS_FINGERPRINT",
  secret: "NEVER_RETURN_THIS_SECRET",
};
let tempHome;
let server;
let base;
let serviceCalls = [];
let postedKeys = [];

before(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "toonflow-h3-route-test-"));
  await writeFile(join(tempHome, "service.token"), serviceToken, "utf8");
  process.env.RH_H3_HOME = tempHome;
  process.env.RH_H3_BASE = "http://127.0.0.1:4317";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("http://127.0.0.1:4317/")) return nativeFetch(input, init);
    const path = new URL(url).pathname;
    const method = init?.method ?? "GET";
    serviceCalls.push({ path, method, authorization: new Headers(init?.headers).get("authorization") });
    if (path === "/api/health") return Response.json({ ok: true, service: "runninghub-minimax-h3-independent", executor: "online", activeTasks: 0 });
    if (path === "/api/executor") return Response.json({ paused: false, reason: null, storageBlocked: false, settings: { maxConcurrent: 3, minCredits: 5, hiddenSecret: "DO_NOT_FORWARD" } });
    if (path === "/api/keys" && method === "GET") return Response.json({ keys: [fakeKey] });
    if (path === "/api/keys" && method === "POST") {
      postedKeys.push(JSON.parse(String(init?.body)));
      return Response.json({ key: { ...fakeKey, secret: "NEVER_RETURN_THIS_SECRET" } });
    }
    if (path === "/api/jobs") return Response.json({ jobs: [{
      id: "job-1", status: "succeeded", taskId: "remote-task-1", keyId: fakeKey.keyId,
      accountGroup: fakeKey.accountGroup,
      parameters: { durationSeconds: 10, aspectRatio: "16:9", megapixels: 0.6 },
      usage: { rhCoins: null, walletAmount: null, thirdPartyAmount: null, currency: null },
      outputs: [{ url: "https://example.invalid/video?token=SIGNED_URL_SECRET" }],
      error: "ERROR_TEXT_SHOULD_NOT_BE_RETURNED", createdAt: "2026-10-11T00:00:00.000Z",
    }] });
    throw new Error(`Unexpected mocked service request: ${method} ${path}`);
  };
});

after(async () => {
  globalThis.fetch = nativeFetch;
  delete process.env.RH_H3_HOME;
  delete process.env.RH_H3_BASE;
  if (server) await new Promise(resolve => server.close(resolve));
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
});

async function startApp(desktop) {
  const app = express();
  app.locals.desktop = desktop;
  app.use(express.json());
  app.use("/api/runninghub-h3", router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ message: err.message }));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${address.port}`;
}

test("rejects non-desktop requests before contacting the H3 service", async () => {
  await startApp(false);
  const beforeCalls = serviceCalls.length;
  const response = await nativeFetch(`${base}/api/runninghub-h3/overview`, {
    headers: { Origin: base, "x-toonflow-desktop": "1" },
  });
  assert.equal(response.status, 403);
  assert.equal(serviceCalls.length, beforeCalls);
});

test("desktop overview allowlists fields, hides secrets/output URLs and disables caching", async () => {
  await new Promise(resolve => server.close(resolve));
  server = undefined;
  await startApp(true);
  serviceCalls = [];
  const response = await nativeFetch(`${base}/api/runninghub-h3/overview`, {
    headers: { Origin: base, "x-toonflow-desktop": "1" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  for (const forbidden of [serviceToken, "NEVER_RETURN_THIS_SECRET", "NEVER_RETURN_THIS_FINGERPRINT", "SIGNED_URL_SECRET", "ERROR_TEXT_SHOULD_NOT_BE_RETURNED", "DO_NOT_FORWARD"])
    assert.equal(text.includes(forbidden), false);
  assert.match(text, /"remainCoins":321/);
  assert.match(text, /"rhCoins":null/);
  assert.ok(serviceCalls.length >= 4);
  assert.ok(serviceCalls.every(call => call.authorization === `Bearer ${serviceToken}`));
});

test("TXT import proxy sends only API key and anonymous account group, without creating jobs", async () => {
  await new Promise(resolve => server.close(resolve));
  server = undefined;
  await startApp(true);
  serviceCalls = [];
  postedKeys = [];
  const response = await nativeFetch(`${base}/api/runninghub-h3/keys/import`, {
    method: "POST",
    headers: { Origin: base, "x-toonflow-desktop": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ apiKey: "0123456789abcdef0123456789abcdef", accountGroup: "acct_abcdef0123456789abcdef01" }] }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(postedKeys, [{ apiKey: "0123456789abcdef0123456789abcdef", accountGroup: "acct_abcdef0123456789abcdef01" }]);
  assert.equal(serviceCalls.some(call => call.path === "/api/jobs" || call.path === "/api/h3/prepare"), false);
  const body = await response.json();
  assert.deepEqual(body.data, { added: 1, existing: 0, failed: [] });
  assert.equal(JSON.stringify(body).includes("NEVER_RETURN_THIS_SECRET"), false);
});
