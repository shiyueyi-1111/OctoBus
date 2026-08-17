import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runDws } from "../lib/dws.js";

async function fakeDws(lines) {
  const dir = await mkdtemp(join(tmpdir(), "dingtalk-calendar-dws-"));
  const path = join(dir, "fake-dws.js");
  await writeFile(path, ["#!/usr/bin/env node", ...lines].join("\n"));
  await chmod(path, 0o755);
  return { dir, path };
}

test("runDws uses execFile, appends JSON flags, and executes once", async () => {
  const { dir, path } = await fakeDws([
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify("ARGS_PATH")}, JSON.stringify(process.argv.slice(2)));`,
    "process.stdout.write(JSON.stringify({ success: true, result: { id: 'evt' } }));",
  ]);
  const argsPath = join(dir, "args.json");
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replace("ARGS_PATH", argsPath));

  const result = await runDws(
    { config: { dwsPath: path, timeoutMs: 5000 } },
    ["calendar", "event", "get", "--id", "evt"],
    { write: false },
  );

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
    "calendar", "event", "get", "--id", "evt", "--yes", "--format", "json",
  ]);
});

test("runDws classifies business failures without exposing upstream details", async () => {
  const { path } = await fakeDws([
    "process.stdout.write(JSON.stringify({ success: false, message: 'token=secret upstream=10.0.0.1' }));",
  ]);

  const result = await runDws(
    { config: { dwsPath: path, timeoutMs: 5000 } },
    ["calendar", "event", "update"],
    { write: true },
  );

  assert.deepEqual(result, {
    success: false,
    data: null,
    error: "DingTalk calendar operation failed",
    errorCode: "DWS_BUSINESS_ERROR",
    outcomeUncertain: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|10\.0\.0\.1/);
});

test("runDws classifies the current dws error envelope as a business failure", async () => {
  const { path } = await fakeDws([
    "process.stdout.write(JSON.stringify({ error: { reason: 'business_error', code: 1, server_error_code: '500' } }));",
    "process.exitCode = 1;",
  ]);

  const result = await runDws(
    { config: { dwsPath: path, timeoutMs: 5000 } },
    ["calendar", "room", "add", "--event", "event-17", "--rooms", "room-17"],
    { write: true },
  );

  assert.deepEqual(result, {
    success: false,
    data: null,
    error: "DingTalk calendar operation failed",
    errorCode: "DWS_BUSINESS_ERROR",
    outcomeUncertain: false,
  });
});

test("runDws preserves only an allowlisted stable not-found code", async () => {
  const { path } = await fakeDws([
    "process.stdout.write(JSON.stringify({ success: false, code: 'NOT_FOUND', message: 'token=secret upstream=10.0.0.1' }));",
  ]);

  const result = await runDws(
    { config: { dwsPath: path, timeoutMs: 5000 } },
    ["calendar", "event", "get", "--id", "missing"],
    { write: false },
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "NOT_FOUND");
  assert.equal(result.outcomeUncertain, false);
  assert.doesNotMatch(JSON.stringify(result), /secret|10\.0\.0\.1/);
});

test("runDws times out a write once and reports an uncertain safe failure", async () => {
  const { dir, path } = await fakeDws([
    "const fs = require('node:fs');",
    `fs.appendFileSync(${JSON.stringify("COUNT_PATH")}, '1');`,
    "setTimeout(() => {}, 10000);",
  ]);
  const countPath = join(dir, "count.txt");
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replace("COUNT_PATH", countPath));

  const result = await runDws(
    { config: { dwsPath: path, timeoutMs: 2000 } },
    ["calendar", "event", "delete", "--id", "evt"],
    { write: true },
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "DWS_TIMEOUT");
  assert.equal(result.outcomeUncertain, true);
  assert.equal(result.error, "DingTalk calendar write result is uncertain");
  assert.equal(await readFile(countPath, "utf8"), "1");
});

test("runDws treats process disconnect after a write as uncertain and does not leak stderr", async () => {
  const { path } = await fakeDws([
    "process.stderr.write('token=secret internal=127.0.0.1');",
    "process.exit(1);",
  ]);

  const result = await runDws(
    { config: { dwsPath: path, timeoutMs: 5000 } },
    ["calendar", "event", "update", "--id", "evt"],
    { write: true },
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "DWS_TRANSPORT_ERROR");
  assert.equal(result.outcomeUncertain, true);
  assert.equal(result.error, "DingTalk calendar write result is uncertain");
  assert.doesNotMatch(JSON.stringify(result), /secret|127\.0\.0\.1/);
});
