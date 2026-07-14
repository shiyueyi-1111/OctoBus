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
