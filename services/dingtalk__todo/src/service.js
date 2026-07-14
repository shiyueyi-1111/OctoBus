import { defineService } from "@chaitin-ai/octobus-sdk";

import { runDws } from "../lib/dws.js";
import { createTodoHandlers } from "./todo.js";


export function createTodoService({ runDwsImpl = runDws } = {}) {
  return defineService({ handlers: createTodoHandlers({ runDws: runDwsImpl }) });
}
