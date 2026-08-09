import fs from "node:fs";
import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { importIssues } from "../services/issue-import-service.js";
import { formatIssueImport } from "./_issue-import-format.js";

/**
 * Top-level `linear import` — bulk-create Linear issues from a JSONL file
 * (or stdin via `-`). A thin wrapper over `linear issues import` exposed
 * at the top level so the `/linear:import` slash-command doc has a stable
 * verb to invoke.
 */

export const IMPORT_META: DomainMeta = {
  name: "import",
  summary:
    "bulk-create Linear issues from a JSONL file or stdin (one-shot migration utility)",
  context: [
    "Reads newline-delimited JSON, one issue per line. Required field:",
    "`title`. Recognized optional fields: `description`, `priority`,",
    "`team.key` (Linear team key like ENG), `labels` (string array),",
    "`identifier` (used to wire intra-batch dependencies), and",
    "`dependencies[]` with `depends_on_identifier`.",
    "",
    "Behavior:",
    '  - parses every line first; rows with `_type: "memory"` are dropped',
    "    (no Linear analog for an external memory store) and counted separately.",
    "  - phase A: create issues. Missing labels are auto-created in the",
    "    active workspace.",
    '  - phase B: wire dependencies. A "X depends on Y" row maps to a Linear',
    "    `Blocks` relation (Y → X).",
    "",
    "Flags:",
    "  --dry-run        parse + plan only, no Linear writes.",
    "  --dedup          skip rows whose title matches an open Linear issue.",
    "",
    "Comments and parent/child sub-issues are intentionally out of scope",
    "for the initial implementation.",
  ].join("\n"),
  arguments: {
    "[file]": "path to a .jsonl file, or `-` to read from stdin",
  },
  seeAlso: ["issues create", "issues export", "decision record"],
};

export function setupImportCommands(program: Command): void {
  const importCmd = program
    .command("import [file]")
    .description(
      "create Linear issues from a JSONL stream (pass '-' to read stdin); one-shot migration utility",
    )
    .option("--dry-run", "parse + plan only, no Linear mutations", false)
    .option(
      "--dedup",
      "skip lines whose title matches an open Linear issue (case-insensitive)",
      false,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [fileArg, options, command] = args as [
          string | undefined,
          { dryRun?: boolean; dedup?: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        let jsonl: string;
        let source: string;
        if (!fileArg || fileArg === "-") {
          if (process.stdin.isTTY) {
            throw invalidParameterError(
              "[file]",
              "no input — pass a path or pipe JSONL to stdin",
            );
          }
          const chunks: Buffer[] = [];
          for await (const c of process.stdin) {
            chunks.push(c as Buffer);
          }
          jsonl = Buffer.concat(chunks).toString("utf8");
          source = "<stdin>";
        } else {
          jsonl = fs.readFileSync(fileArg, "utf8");
          source = fileArg;
        }

        if (jsonl.trim().length === 0) {
          throw invalidParameterError(
            "[file]",
            `empty input — ${source} contained no JSONL records`,
          );
        }

        const result = await importIssues({
          client: ctx.gql,
          jsonl,
          source,
          dryRun: options.dryRun ?? false,
          dedup: options.dedup ?? false,
        });
        outputResult(result, formatIssueImport, rootOpts);
      }),
    );

  importCmd
    .command("usage")
    .description("show detailed usage for import")
    .action(() => {
      console.log(formatDomainUsage(importCmd, IMPORT_META));
    });
}
