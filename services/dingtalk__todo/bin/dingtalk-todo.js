#!/usr/bin/env node
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { createTodoService } from "../src/service.js";


runServiceMain(createTodoService());
