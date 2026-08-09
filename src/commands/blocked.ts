import type { Command } from "commander";
import { AGENT_LIST_LIMIT } from "../common/agent-mode.js";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import { resolveScopeOption } from "../common/scope-filter.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import {
  type BlockedIssue,
  listBlockedIssues,
} from "../services/blocked-service.js";
import {
  detectCyclesWithIssues,
  loadAllOpenSubgraphs,
} from "../services/dependency-graph-service.js";
import {
  type BlockedExplainItem,
  buildExplainResult,
  type ExplainResult,
} from "../services/explain-service.js";
import { priorityCol } from "./_format.js";

export const BLOCKED_META: DomainMeta = {
  name: "blocked",
  summary: "list every open issue with at least one open `blocks` predecessor",
  context: [
    "the `blocked` view answers 'what work cannot start right now because",
    "something else is in flight?' it walks each open issue's inverse",
    "`blocks` relations and keeps the ones whose blocker is itself still",
    "non-terminal (triage/backlog/unstarted/started). closed blockers don't count.",
    "",
    "results sort urgent → low priority, with identifier as tiebreak. each",
    "row carries `blocked_by` (open blocker identifiers, sorted) and",
    "`blocked_by_count`. always emits an array, even when empty, so callers",
    "can pipe into jq without branching on shape.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["depends graph", "issues epic-status"],
};

/**
 * Render the `blocked` view. Output shape:
 *
 *     \n
 *     🚫 Blocked issues (N):\n
 *     \n
 *     [● P<n>] <id>: <title>\n
 *       Blocked by N open dependencies: [<dep-id-1>, <dep-id-2>]\n
 *
 * Empty case prints a celebratory line so a clean board reads naturally.
 */
export function formatBlocked(issues: BlockedIssue[]): string {
  if (issues.length === 0) {
    return "\n✨ No blocked issues\n\n";
  }
  const lines: string[] = [""];
  lines.push(`🚫 Blocked issues (${issues.length}):`);
  lines.push("");
  for (const issue of issues) {
    const pri = priorityCol(issue.priority);
    // Brackets are `[● P<n>]` for priorities 1-4; when priority is 0
    // we drop the `P<n>` token but keep the `●`.
    const bracket = pri ? `[● ${pri}]` : "[●]";
    lines.push(`${bracket} ${issue.identifier}: ${issue.title}`);
    lines.push(
      `  Blocked by ${issue.blocked_by_count} open dependencies: [${issue.blocked_by.join(", ")}]`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Render `blocked --explain`. For each blocked issue, list the remaining OPEN
 * blockers (identifier + title + status) as a tree under the issue, then
 * report any dependency cycles.
 *
 *     \n
 *     📊 Blocked work explanation\n
 *     \n
 *     ● Blocked (N issues):\n
 *     \n
 *       <id> [P<n>] <title>\n
 *         ← blocked by <blocker-id>: <blocker-title> [<status>]\n
 *     \n
 *     ⚠ Cycles detected (M):\n
 *       <id> → <id> → <id>\n
 *     \n
 *
 * Empty + cycle-free board prints a celebratory line so a clean graph reads
 * naturally.
 */
export function formatBlockedExplain(result: ExplainResult): string {
  const { blocked, cycles } = result;
  if (blocked.length === 0 && cycles.length === 0) {
    return "\n✨ No blocked issues\n\n";
  }

  const lines: string[] = [""];
  lines.push("📊 Blocked work explanation");
  lines.push("");

  if (blocked.length > 0) {
    lines.push(`● Blocked (${blocked.length} issues):`);
    lines.push("");
    for (const item of blocked) {
      renderBlockedExplainItem(lines, item);
      lines.push("");
    }
  }

  if (cycles.length > 0) {
    lines.push(`⚠ Cycles detected (${cycles.length}):`);
    for (const cycle of cycles) {
      if (cycle.length === 0) continue;
      // Close the loop visually by repeating the first identifier.
      lines.push(`  ${[...cycle, cycle[0]].join(" → ")}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function renderBlockedExplainItem(
  lines: string[],
  item: BlockedExplainItem,
): void {
  const pri = priorityCol(item.priority);
  const priTag = pri ? ` [${pri}]` : "";
  lines.push(`  ${item.identifier}${priTag} ${item.title}`);
  for (const blocker of item.blocked_by) {
    lines.push(
      `    ← blocked by ${blocker.identifier}: ${blocker.title} [${blocker.status}]`,
    );
  }
}

/**
 * Resolve the blocked-list cap (lin-g1hy). An explicit `--limit` wins
 * (`0` means "all"); otherwise agent mode caps to {@link AGENT_LIST_LIMIT}
 * and a human sees everything (`undefined`).
 */
export function resolveBlockedCap(
  rawLimit: string | undefined,
  source: string | undefined,
  agentMode: boolean,
): number | undefined {
  const userSet = source === "cli" || source === "env";
  if (userSet && rawLimit !== undefined) {
    const n = Number.parseInt(rawLimit, 10);
    if (Number.isNaN(n) || n < 0) {
      throw invalidParameterError(
        "--limit",
        "must be a non-negative integer (0 = all)",
      );
    }
    return n === 0 ? undefined : n;
  }
  return agentMode ? AGENT_LIST_LIMIT : undefined;
}

export function setupBlockedCommands(program: Command): void {
  const blocked = program
    .command("blocked")
    .description("list open issues with at least one open `blocks` predecessor")
    .option(
      "--parent <issue>",
      "filter to direct children of this epic (identifier or UUID)",
    )
    .option(
      "--team <team>",
      "scope to one team (key, name, or UUID); without this, scans the whole workspace",
    )
    .option("--no-scope", "ignore the implicit repo scope label for this call")
    .option(
      "--scope <label>",
      "override the implicit scope label for this call",
    )
    .option(
      "--explain",
      "explain WHY each issue is blocked: remaining open blockers + dependency cycles",
    )
    .option(
      "-n, --limit <n>",
      "max blocked issues to list (default: all; agent mode caps to 20; 0 = all)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          {
            parent?: string;
            team?: string;
            scope?: string | boolean;
            explain?: boolean;
            limit?: string;
          },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const parentId = options.parent
          ? await resolveIssueId(ctx.sdk, options.parent)
          : undefined;
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;
        const scope = resolveScopeOption(options.scope);
        const issues = await listBlockedIssues(ctx.gql, {
          parentId,
          teamId,
          scope,
        });
        if (options.explain) {
          // Per-issue open-blocker reasoning + dependency cycles. Cycles reuse
          // the same open-graph detector as `linear depends cycles`. The
          // explain deep-dive is never auto-trimmed — it's an explicit ask.
          const subgraphs = await loadAllOpenSubgraphs(ctx.gql, { teamId });
          const cycles = detectCyclesWithIssues(subgraphs).map((cycle) =>
            cycle.map((issue) => issue.identifier),
          );
          const envelope = buildExplainResult([], issues, cycles);
          outputResult(envelope, formatBlockedExplain, rootOpts);
          return;
        }

        // Token-economy trim (lin-g1hy): blocked is a raw array with no
        // pageInfo, so the "agent_mode" tell goes to stderr. An explicit
        // --limit wins (0 = all); otherwise humans see everything and an
        // agent caller caps to AGENT_LIST_LIMIT.
        const cap = resolveBlockedCap(
          options.limit,
          command.getOptionValueSource("limit"),
          Boolean(rootOpts.agentMode),
        );
        const shown =
          cap !== undefined && issues.length > cap
            ? issues.slice(0, cap)
            : issues;
        if (shown.length < issues.length) {
          console.error(
            `Showing ${shown.length} of ${issues.length} blocked issues (agent_mode trim; pass --limit 0 for all).`,
          );
        }
        outputResult(shown, formatBlocked, rootOpts);
      }),
    );

  blocked
    .command("usage")
    .description("show detailed usage for blocked")
    .action(() => {
      console.log(formatDomainUsage(blocked, BLOCKED_META));
    });
}
