import type { Command } from "commander";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { isClosedStateType } from "../common/issue-lifecycle.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveStateIdByType } from "../resolvers/status-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import {
  fetchGateForResolve,
  listGates,
  resolveGate,
  runGateCheck,
} from "../services/gate-service.js";

/**
 * Gates is a Linear-Hack: gate issues are normal Linear issues tagged with
 * the gate label. Output format:
 *
 *   list   → `<icon> <id>  <await-type>  →  <await-id>  [state]` per gate
 *   check  → header summary + per-gate outcome lines
 *   resolve → `✓ Resolved gate <id> → <state>[ (commented)]`
 *
 * Icons: ○ open  ◐ in_progress  ● blocked  ✓ closed.
 * `status` is Linear's state.type (triage/backlog/unstarted/started/
 * completed/canceled/duplicate).
 */
function gateIcon(status: string | null | undefined): string {
  if (status && isClosedStateType(status)) return "✓";
  switch (status) {
    case "started":
      return "◐";
    default:
      return "○";
  }
}

interface GateRowShape {
  id: string;
  identifier: string;
  title: string;
  status: string;
  state_name: string;
  await_type: string | null;
  await_id: string | null;
  timeout?: string | null;
  waiters?: string[];
}

export function formatGateList(gates: GateRowShape[]): string {
  if (gates.length === 0) return "No gates found.\n";
  const idWidth = Math.max(...gates.map((g) => g.identifier.length));
  const lines: string[] = [];
  for (const g of gates) {
    const icon = gateIcon(g.status);
    const id = g.identifier.padEnd(idWidth);
    const awaitType = g.await_type ?? "(no type)";
    const awaitId = g.await_id ? `  →  ${g.await_id}` : "";
    const state = g.state_name || g.status;
    lines.push(`${icon} ${id}  ${awaitType}${awaitId}  [${state}]`);
  }
  lines.push("");
  lines.push(`Total: ${gates.length} gates`);
  return `${lines.join("\n")}\n`;
}

interface GateCheckResultShape {
  identifier: string;
  await_type: string | null;
  outcome: "resolved" | "escalated" | "pending" | "skipped";
  reason: string;
  closed: boolean;
  error?: string | null;
}

interface GateCheckSummaryShape {
  checked: number;
  resolved: number;
  escalated: number;
  pending: number;
  skipped: number;
  errors: number;
  dry_run: boolean;
  results: GateCheckResultShape[];
}

function outcomeIcon(outcome: GateCheckResultShape["outcome"]): string {
  switch (outcome) {
    case "resolved":
      return "✓";
    case "escalated":
      return "⚠";
    case "pending":
      return "◐";
    default:
      return "·";
  }
}

export function formatGateCheck(summary: GateCheckSummaryShape): string {
  const dry = summary.dry_run ? " (dry-run)" : "";
  const lines: string[] = [
    `Gate check: ${summary.checked} checked, ${summary.resolved} resolved, ${summary.escalated} escalated, ${summary.pending} pending, ${summary.skipped} skipped${dry}`,
  ];
  if (summary.errors > 0) {
    lines.push(`  (${summary.errors} errors)`);
  }
  if (summary.results.length > 0) {
    lines.push("");
    for (const r of summary.results) {
      const icon = outcomeIcon(r.outcome);
      const closed = r.closed ? "" : " (not closed)";
      lines.push(
        `${icon} ${r.identifier}  [${r.outcome}]  ${r.reason}${closed}`,
      );
      if (r.error) lines.push(`  ⚠ ${r.error}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

interface GateResolveResultShape {
  identifier: string;
  state_name: string;
  comment_id?: string | null;
  reason?: string | null;
}

export function formatGateResolve(result: GateResolveResultShape): string {
  const commented = result.comment_id ? " (commented)" : "";
  return `✓ Resolved gate ${result.identifier} → ${result.state_name}${commented}\n`;
}

export const GATE_META: DomainMeta = {
  name: "gate",
  summary:
    "list async wait conditions ('gates') that block dependent work until an external signal resolves them",
  context: [
    "Linear-Hack: a gate is a regular Linear issue with the gate label and",
    "a structured key:value description block. supported keys (all optional):",
    "  await_type: gh:run | gh:pr | timer | human | issue",
    "  await_id:   the external identifier (run id, PR url, etc.)",
    "  timeout:    duration string ('30m', '6h') for timer-type gates",
    "  waiters:    comma-separated agent addresses awaiting resolution",
    "",
    "Subcommands: `list`, `resolve`, `check`. `show` is intentionally",
    "omitted since `linear issues read <gate-id>` already shows the",
    "description. Failed gates are reported with outcome='escalated' so",
    "callers can react.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["issues read", "blocked"],
};

export function setupGateCommands(program: Command): void {
  const gate = program
    .command("gate")
    .description(
      "manage async wait conditions ('gates') represented as Linear issues",
    );

  gate.action(() => gate.help());

  gate
    .command("list")
    .description(
      "list gate issues (open by default; pass --all to include closed)",
    )
    .option("-a, --all", "include closed gates in the output", false)
    .option("-n, --limit <n>", "max gates to return", (v) =>
      Number.parseInt(v, 10),
    )
    .option(
      "--team <team>",
      "scope to one team (key, name, or UUID); without this, scans the whole workspace",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          { all: boolean; limit?: number; team?: string },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;
        const gates = await listGates(ctx.gql, {
          all: options.all,
          teamId,
          limit: options.limit ?? 50,
        });
        outputResult(gates, formatGateList, rootOpts);
      }),
    );

  gate
    .command("check")
    .description(
      "evaluate open gates and auto-close any that have resolved (gh:run/gh:pr via gh CLI, timer via clock)",
    )
    .option(
      "-t, --type <type>",
      "limit to a single gate type: gh, gh:run, gh:pr, timer (default: all)",
    )
    .option("--dry-run", "report outcomes without closing any gates", false)
    .option("-l, --limit <n>", "max gates to evaluate", (v) =>
      Number.parseInt(v, 10),
    )
    .option(
      "--team <team>",
      "scope to one team (key, name, or UUID); without this, scans the whole workspace",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          {
            type?: string;
            dryRun: boolean;
            limit?: number;
            team?: string;
          },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;
        const gates = await listGates(ctx.gql, {
          teamId,
          limit: options.limit ?? 100,
        });
        const completedStateByTeam = new Map<
          string,
          { stateId?: string; error?: string }
        >();
        if (!options.dryRun) {
          for (const gate of gates) {
            if (completedStateByTeam.has(gate.team.id)) continue;
            try {
              completedStateByTeam.set(gate.team.id, {
                stateId: await resolveStateIdByType(
                  ctx.sdk,
                  gate.team.id,
                  "completed",
                ),
              });
            } catch (error) {
              completedStateByTeam.set(gate.team.id, {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
        const summary = await runGateCheck(ctx.gql, {
          typeFilter: options.type,
          dryRun: options.dryRun,
          limit: options.limit,
          teamId,
          gates,
          completedStateByTeam,
        });
        outputResult(summary, formatGateCheck, rootOpts);
      }),
    );

  gate
    .command("resolve <gate-id>")
    .description(
      "manually close a gate by moving it to a 'completed' state; optional --reason posts a comment",
    )
    .option(
      "-r, --reason <text>",
      "free-text reason for resolving the gate (recorded as a Linear comment on the gate issue)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [gateId, options, command] = args as [
          string,
          { reason?: string },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, gateId);
        const gateCtx = await fetchGateForResolve(ctx.gql, issueId);
        const stateId = await resolveStateIdByType(
          ctx.sdk,
          gateCtx.team_id,
          "completed",
        );
        const result = await resolveGate(ctx.gql, {
          issueId,
          stateId,
          reason: options.reason,
        });
        outputResult(result, formatGateResolve, rootOpts);
      }),
    );

  gate
    .command("usage")
    .description("show detailed usage for gate")
    .action(() => {
      console.log(formatDomainUsage(gate, GATE_META));
    });
}
