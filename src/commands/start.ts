import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueTeamContext } from "../resolvers/issue-resolver.js";
import {
  resolveStateIdByType,
  resolveStatusId,
} from "../resolvers/status-resolver.js";
import { type StartResult, startIssue } from "../services/start-service.js";

export function formatStartResult(result: StartResult): string {
  const id = result.issue.identifier ?? result.issue.id;
  const stateName = result.issue.state?.name ?? "In Progress";
  return `✓ Started ${id} (assigned to you, state: ${stateName})`;
}

export const START_META: DomainMeta = {
  name: "start",
  summary: "claim an issue and move it to In Progress in one call",
  context: [
    "Single-command claim+start (lin-nzqu). Assigns the issue to the",
    "current authenticated user AND moves it to the team's `started`",
    "state. Claims the issue (assigns it to you and moves it to the",
    "in-progress state).",
    "",
    "Pass `--status <name>` to use a different state (e.g. 'In Review').",
    "",
    "Pairs with `linear switch <new>` (lin-jkzw) — `switch` is the",
    "mid-flight interruption case (revert old in-progress, then start",
    "new); `start` is the no-handoff case.",
  ].join("\n"),
  arguments: {
    id: "issue identifier (UUID or ABC-123) to claim and start",
  },
  seeAlso: ["switch", "assign", "issues update"],
};

interface StartOpts {
  status?: string;
}

export function setupStartCommands(program: Command): void {
  const cmd = program
    .command("start <id>")
    .description("claim an issue and move it to In Progress in one call")
    .option(
      "--status <name>",
      "override the target state (default: team's 'started' state)",
    )
    .addHelpText(
      "after",
      `\nExamples:
  linear start ENG-1                  claim ENG-1 + move to In Progress
  linear start ENG-1 --status Review  claim ENG-1 + move to 'Review'

Notes:
  - The default target is the team's 'started' type state (typically
    "In Progress"). Use --status when your team uses a different
    state name for active work.
  - Use \`linear switch <new>\` instead if you have an in-progress
    issue to revert at the same time.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [id, options, command] = args as [string, StartOpts, Command];
        if (!id) {
          throw invalidParameterError("<id>", "issue identifier is required");
        }
        const ctx = createContext(getRootOpts(command));
        const target = await resolveIssueTeamContext(ctx.sdk, id);
        const stateId = options.status
          ? await resolveStatusId(ctx.sdk, options.status, target.teamId)
          : await resolveStateIdByType(ctx.sdk, target.teamId, "started");
        const result = await startIssue(ctx.gql, {
          issueId: target.issueId,
          stateId,
        });
        outputResult(result, formatStartResult, getRootOpts(command));
      }),
    );

  cmd
    .command("usage")
    .description("show detailed usage for start")
    .action(() => {
      console.log(formatDomainUsage(cmd, START_META));
    });
}
