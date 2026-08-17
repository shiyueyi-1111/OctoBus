import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runDws } from "../lib/dws.js";

test("runDws uses configured dwsPath and passes arguments without shell wrapping", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dingtalk-todo-dws-"));
  const logPath = join(dir, "args.json");
  const fakeDws = join(dir, "fake-dws.js");

  await writeFile(
    fakeDws,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)));`,
      "process.stdout.write(JSON.stringify({ success: true, result: { todoList: [] } }));",
    ].join("\n"),
  );
  await chmod(fakeDws, 0o755);

  const result = await runDws(
    { config: { dwsPath: fakeDws, timeoutMs: 5000 } },
    ["todo", "task", "list", "--size", "3"],
  );

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(await readFile(logPath, "utf8")), [
    "todo",
    "task",
    "list",
    "--size",
    "3",
    "--yes",
    "--format",
    "json",
  ]);
});

test("runDws reports a timed-out write as uncertain without replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dingtalk-todo-dws-timeout-"));
  const countPath = join(dir, "count.txt");
  const fakeDws = join(dir, "fake-dws.js");
  await writeFile(
    fakeDws,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(countPath)}, "1");`,
      "setTimeout(() => {}, 10000);",
    ].join("\n"),
  );
  await chmod(fakeDws, 0o755);

  const result = await runDws(
    { config: { dwsPath: fakeDws, timeoutMs: 2000 } },
    ["todo", "task", "delete", "--task-id", "todo-17"],
    { write: true },
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "DWS_TIMEOUT");
  assert.equal(result.outcomeUncertain, true);
  assert.equal(await readFile(countPath, "utf8"), "1");
});

test("runDws classifies the current dws error envelope as a business failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dingtalk-todo-dws-business-error-"));
  const fakeDws = join(dir, "fake-dws.js");
  await writeFile(
    fakeDws,
    [
      "#!/usr/bin/env node",
      "process.stdout.write(JSON.stringify({",
      "  error: { reason: 'business_error', code: 1, server_error_code: '500' },",
      "}));",
      "process.exitCode = 1;",
    ].join("\n"),
  );
  await chmod(fakeDws, 0o755);

  const result = await runDws(
    { config: { dwsPath: fakeDws, timeoutMs: 5000 } },
    ["todo", "task", "get", "--task-id", "missing"],
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "DWS_BUSINESS_ERROR");
  assert.equal(result.outcomeUncertain, false);
});
