import { defineService } from "@chaitin-ai/octobus-sdk";

import { runDws } from "../lib/dws.js";
import { createCalendarHandlers } from "./calendar.js";

export function createCalendarService({ runDwsImpl = runDws } = {}) {
  return defineService({ handlers: createCalendarHandlers({ runDws: runDwsImpl }) });
}

export const service = createCalendarService();
