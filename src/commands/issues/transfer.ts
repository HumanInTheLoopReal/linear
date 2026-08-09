import fs from "node:fs";
import type { Command } from "commander";
import { getDefaultTeam } from "../../common/config-store.js";
import { createContext, getRootOpts } from "../../common/context.js";
import { invalidParameterError } from "../../common/errors.js";
import { writeJsonlToFile, writeJsonlToStdout } from "../../common/jsonl.js";
import { handleCommand, outputResult } from "../../common/output.js";
import { resolveIssueId } from "../../resolvers/issue-resolver.js";
import { resolveTeamId } from "../../resolvers/team-resolver.js";
import {
  exportIssues,
  summarizeExport,
} from "../../services/issue-export-service.js";
import { importIssues } from "../../services/issue-import-service.js";
import {
  archiveIssue,
  deleteIssue,
  unarchiveIssue,
} from "../../services/issue-service.js";
import { formatIssueImport } from "../_issue-import-format.js";

export interface IssueEchoShape {
  identifier: string;
  title: string;
}

export interface IssueExportEchoShape {
  output: string;
  issue_count: number;
  filter_applied: boolean;
  include_archived: boolean;
}

export function formatIssueArchive(
  input: IssueEchoShape | IssueEchoShape[],
): string {
  const rows = Array.isArray(input) ? input : [input];
  return `${rows.map((row) => `Archived ${row.identifier}: ${row.title}`).join("\n")}\n`;
}

export function formatIssueUnarchive(
  input: IssueEchoShape | IssueEchoShape[],
): string {
  const rows = Array.isArray(input) ? input : [input];
  return `${rows.map((row) => `Unarchived ${row.identifier}: ${row.title}`).join("\n")}\n`;
}

export function formatIssueDelete(result: IssueEchoShape): string {
  return `Deleted ${result.identifier}: ${result.title}\n`;
}

export function formatIssueExport(result: IssueExportEchoShape): string {
  const tags: string[] = [];
  if (result.filter_applied) tags.push("filter applied");
  if (result.include_archived) tags.push("includes archived");
  const suffix = tags.length > 0 ? ` (${tags.join("; ")})` : "";
  return `Exported ${result.issue_count} issues to ${result.output}${suffix}\n`;
}

export function registerIssueTransferCommands(issues: Command): void {
  issues
    .command("archive [issues...]")
    .description(
      "archive one or more issues — hides from default views without changing state (archive ≠ close)",
    )
    .addHelpText(
      "after",
      `\nArchive is a Linear visibility flag: archived issues are hidden from
default lists/searches but keep their current workflow state. Use
\`linear issues close\` to mark work completed; reach for archive when
you want to declutter the board (e.g. obsolete or duplicate work that
should stay in the audit trail). Pass multiple identifiers to archive
in bulk — \`linear issues archive ENG-1 ENG-2 ENG-3\`.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issueIds, , command] = args as [string[], unknown, Command];
        if (issueIds.length === 0) {
          throw invalidParameterError(
            "<issues>",
            "at least one issue ID is required",
          );
        }
        const ctx = createContext(getRootOpts(command));
        const results = await Promise.all(
          issueIds.map(async (raw) => {
            const id = await resolveIssueId(ctx.sdk, raw);
            return archiveIssue(ctx.gql, id);
          }),
        );
        outputResult(results, formatIssueArchive, getRootOpts(command));
      }),
    );

  issues
    .command("unarchive [issues...]")
    .description(
      "unarchive one or more issues — restore them to default views (state unchanged)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issueIds, , command] = args as [string[], unknown, Command];
        if (issueIds.length === 0) {
          throw invalidParameterError(
            "<issues>",
            "at least one issue ID is required",
          );
        }
        const ctx = createContext(getRootOpts(command));
        const results = await Promise.all(
          issueIds.map(async (raw) => {
            const id = await resolveIssueId(ctx.sdk, raw);
            return unarchiveIssue(ctx.gql, id);
          }),
        );
        outputResult(results, formatIssueUnarchive, getRootOpts(command));
      }),
    );

  issues
    .command("export")
    .description(
      "export issues to JSONL (stdout or -o <file>); one issue per line",
    )
    .option(
      "-o, --output <file>",
      "write JSONL to <file> atomically instead of stdout",
    )
    .option(
      "--all",
      "include archived issues (Linear: includeArchived=true)",
      false,
    )
    .option(
      "-t, --team <key>",
      "filter to a single team (key or UUID); omit to export all teams",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          { output?: string; all?: boolean; team?: string },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        let filter: { team: { id: { eq: string } } } | undefined;
        let filterApplied = false;
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        if (teamKey) {
          const teamId = await resolveTeamId(ctx.sdk, teamKey);
          filter = { team: { id: { eq: teamId } } };
          filterApplied = true;
        }

        const lines = await exportIssues({
          client: ctx.gql,
          filter,
          includeArchived: options.all ?? false,
        });

        if (options.output) {
          writeJsonlToFile(options.output, lines);
          const summary = summarizeExport(lines, {
            filterApplied,
            includeArchived: options.all ?? false,
          });
          outputResult(
            { action: "exported", output: options.output, ...summary },
            formatIssueExport,
            rootOpts,
          );
        } else {
          writeJsonlToStdout(lines);
        }
      }),
    );

  issues
    .command("delete <issue>")
    .description("delete an issue")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, , command] = args as [string, unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await deleteIssue(ctx.gql, issueId);
        outputResult(result, formatIssueDelete, rootOpts);
      }),
    );

  issues
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
          for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
          }
          jsonl = Buffer.concat(chunks).toString("utf8");
          source = "<stdin>";
        } else {
          jsonl = fs.readFileSync(fileArg, "utf8");
          source = fileArg;
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
}
