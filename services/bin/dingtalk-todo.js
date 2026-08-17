#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../dingtalk__todo/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../dingtalk__todo/bin/dingtalk-todo.js", import.meta.url)),
});
