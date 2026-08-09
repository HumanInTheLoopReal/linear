#!/usr/bin/env node

import { applyTopLevelAliases } from "./commands/aliases.js";
import { buildProgram } from "./program.js";

// Construct the fully-wired program (src/program.ts) and parse. All command
// wiring lives in `buildProgram` so the command tree can be built in tests
// without argv side effects; this entry is intentionally thin.
buildProgram().parse(applyTopLevelAliases(process.argv));
