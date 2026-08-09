import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { isClosedStateType } from "../common/issue-lifecycle.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveStateIdByType } from "../resolvers/status-resolver.js";
import {
  dismissHumanIssue,
  getHumanIssueSnapshot,
  type HumanStatusFilter,
  humanStats,
  isHumanStatusFilter,
  listHumanIssues,
  respondHumanIssue,
} from "../services/human-service.js";

/**
 * Human is a Linear-Hack: any issue carrying the `human` label is in the
 * human-decision queue. Per-entry output block:
 *
 *   list     → `! <id>  <title>` + `Status: <bucket>  [<state>]  · Updated: <ymd>`
 *              per entry, then `Total: N (P pending, R responded, D dismissed)`
 *   respond  → `✓ Responded to <id> → <state>[ (commented)]` + label warning
 *   dismiss  → `· Dismissed <id> → <state>[ (commented)]` + label warning
 *   stats    → aligned summary block
 *
 * `bucket` is the derived terminal classification: completed → responded,
 * other terminal states → dismissed, anything else → pending.
 */
function humanFormatYmd(value: string | null | undefined): string {
  if (!value) return "(unknown)";
  return value.slice(0, 10);
}

function humanBucket(
  statusType: string,
): "pending" | "responded" | "dismissed" {
  if (statusType === "completed") return "responded";
  if (isClosedStateType(statusType)) return "dismissed";
  return "pending";
}

interface HumanIssueRowShape {
  identifier: string;
  title: string;
  status: string;
  status_type: string;
  updated_at: string;
}

export function formatHumanList(issues: HumanIssueRowShape[]): string {
  if (issues.length === 0) return "No human-flagged issues found.\n";
  const lines: string[] = [];
  let pending = 0;
  let responded = 0;
  let dismissed = 0;
  for (const i of issues) {
    const bucket = humanBucket(i.status_type);
    if (bucket === "pending") pending += 1;
    else if (bucket === "responded") responded += 1;
    else dismissed += 1;
    lines.push(`! ${i.identifier}  ${i.title}`);
    lines.push(
      `    Status: ${bucket}  [${i.status}]  · Updated: ${humanFormatYmd(i.updated_at)}`,
    );
  }
  lines.push("");
  lines.push(
    `Total: ${issues.length} (${pending} pending, ${responded} responded, ${dismissed} dismissed)`,
  );
  return `${lines.join("\n")}\n`;
}

interface HumanActionResultShape {
  issue: { identifier: string };
  action: "responded" | "dismissed";
  had_human_label: boolean;
  comment_id: string | null;
  state_name?: string | null;
}

function humanActionLine(result: HumanActionResultShape): string {
  const icon = result.action === "responded" ? "✓" : "·";
  const verb = result.action === "responded" ? "Responded to" : "Dismissed";
  const state = result.state_name ?? "";
  const arrow = state ? ` → ${state}` : "";
  const commented = result.comment_id ? " (commented)" : "";
  const lines: string[] = [
    `${icon} ${verb} ${result.issue.identifier}${arrow}${commented}`,
  ];
  if (!result.had_human_label) {
    lines.push(
      `  ⚠ ${result.issue.identifier} did not carry the 'human' label`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatHumanRespond(result: HumanActionResultShape): string {
  return humanActionLine(result);
}

export function formatHumanDismiss(result: HumanActionResultShape): string {
  return humanActionLine(result);
}

interface HumanStatsShape {
  total: number;
  pending: number;
  responded: number;
  dismissed: number;
}

export function formatHumanStats(stats: HumanStatsShape): string {
  const lines: string[] = [
    "Human queue:",
    `  Total:      ${stats.total}`,
    `  Pending:    ${stats.pending}`,
    `  Responded:  ${stats.responded}`,
    `  Dismissed:  ${stats.dismissed}`,
  ];
  return `${lines.join("\n")}\n`;
}

export const HUMAN_META: DomainMeta = {
  name: "human",
  summary: "manage issues flagged for human intervention (label: human)",
  context: [
    "Linear-Hack: any issue carrying the `human` label is in the",
    "human-decision queue. `linear human list` enumerates the queue; the",
    "label must exist on the workspace (create it via `linear labels",
    "create human` if missing).",
    "",
    "Status uses the shared lifecycle buckets: `open` is triage/backlog/",
    "unstarted, `in_progress` is started, and `closed` is completed/",
    "canceled/duplicate.",
    "Omit `--status` to see everything.",
    "",
    "Subcommands:",
    "  • list                              — enumerate the queue",
    "  • respond <id> --response <text>    — comment + move to completed",
    "  • dismiss <id> [--reason <text>]    — optional comment + move to canceled",
    "  • stats                             — {total, pending, responded, dismissed}",
    "",
    "Linear has no `close reason` field, so the terminal state.type is the",
    "signal — completed ≡ responded; canceled/duplicate ≡ dismissed. The comment",
    "carries the human-readable text.",
    "",
    "This CLI is agent-only, so `linear human` is the human-decision triage",
    "queue rather than a command cheat-sheet. Run `linear --help` for the",
    "full command list.",
  ].join("\n"),
  arguments: {
    id: "Issue identifier (e.g. ENG-42) for respond/dismiss",
  },
  seeAlso: ["labels list", "issues list", "next"],
};

export function setupHumanCommands(program: Command): void {
  const human = program
    .command("human")
    .description(
      "triage the human-decision queue (list/respond/dismiss/stats)",
    );

  // DESIGN (lin-8yl1.7) — this CLI is agent-only (no human ever drives it),
  // so the `human` verb is repurposed for the one human-facing concern that IS
  // agent-relevant: the queue of issues an agent has escalated for a person to
  // decide. Bare `linear human` prints this group's subcommand help (a bare
  // invocation is informational), but the body is triage, not a command menu.
  human.addHelpText(
    "after",
    [
      "",
      "Note — `linear human` is agent-only:",
      "  linear human → triage queue for issues escalated to a human",
      "                 (list/respond/dismiss/stats), not a command cheat-sheet.",
      "  For the full command list, run `linear --help`.",
    ].join("\n"),
  );

  human.action(() => human.help());

  human
    .command("list")
    .description(
      "list workspace issues carrying the `human` label (use --status open|in_progress|closed to filter)",
    )
    .option(
      "-s, --status <status>",
      "filter by status: open, in_progress, or closed",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [{ status?: string }, Command];
        let status: HumanStatusFilter | undefined;
        if (options.status !== undefined) {
          if (!isHumanStatusFilter(options.status)) {
            throw new Error(
              `--status: unknown value '${options.status}' (allowed: open, in_progress, closed)`,
            );
          }
          status = options.status;
        }
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issues = await listHumanIssues({ client: ctx.gql, status });
        outputResult(issues, formatHumanList, rootOpts);
      }),
    );

  human
    .command("respond <id>")
    .description(
      "comment with --response and transition the issue to a 'completed' state",
    )
    .requiredOption(
      "-r, --response <text>",
      "response text (prefixed with `Response: ` on the comment)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [id, options, command] = args as [
          string,
          { response: string },
          Command,
        ];
        const text = options.response?.trim();
        if (!text) {
          throw invalidParameterError("--response", "cannot be empty");
        }
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, id);
        const snap = await getHumanIssueSnapshot(ctx.gql, issueId);
        const stateId = await resolveStateIdByType(
          ctx.sdk,
          snap.team_id,
          "completed",
        );
        const result = await respondHumanIssue({
          client: ctx.gql,
          issueId,
          stateId,
          response: text,
        });
        outputResult(result, formatHumanRespond, rootOpts);
      }),
    );

  human
    .command("dismiss <id>")
    .description(
      "transition the issue to a 'canceled' state (optionally adding a reason comment)",
    )
    .option("--reason <text>", "optional reason (prefixed with `Dismissed: `)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [id, options, command] = args as [
          string,
          { reason?: string },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, id);
        const snap = await getHumanIssueSnapshot(ctx.gql, issueId);
        const stateId = await resolveStateIdByType(
          ctx.sdk,
          snap.team_id,
          "canceled",
        );
        const result = await dismissHumanIssue({
          client: ctx.gql,
          issueId,
          stateId,
          reason: options.reason,
        });
        outputResult(result, formatHumanDismiss, rootOpts);
      }),
    );

  human
    .command("stats")
    .description(
      "count human-labeled issues by terminal state (responded / dismissed / pending)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const stats = await humanStats({ client: ctx.gql });
        outputResult(stats, formatHumanStats, rootOpts);
      }),
    );

  human
    .command("usage")
    .description("show detailed usage for human")
    .action(() => {
      console.log(formatDomainUsage(human, HUMAN_META));
    });
}
