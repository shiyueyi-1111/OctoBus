#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../dingtalk__calendar/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../dingtalk__calendar/bin/dingtalk-calendar.js", import.meta.url)),
});
