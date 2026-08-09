import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import {
  DEFAULT_STALE_DAYS,
  formatChecklist,
  resolveSkipName,
  runPreflightChecks,
} from "../services/preflight-service.js";

interface PreflightCheckShape {
  name: string;
  passed: boolean;
  skipped?: boolean;
  warning?: boolean;
  output?: string;
  command: string;
}

interface PreflightReportShape {
  checks: PreflightCheckShape[];
  passed: boolean;
  summary: string;
}

function preflightIcon(check: PreflightCheckShape): string {
  if (check.skipped) return "⚠";
  if (check.passed) return "✓";
  if (check.warning) return "⚠";
  return "✗";
}

export function formatPreflightReport(report: PreflightReportShape): string {
  const lines: string[] = [];
  for (const check of report.checks ?? []) {
    const suffix = check.skipped ? " (skipped)" : "";
    lines.push(`${preflightIcon(check)} ${check.name}${suffix}`);
    lines.push(`  Command: ${check.command}`);
    if (check.output) {
      lines.push("  Output:");
      for (const line of check.output.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
    lines.push("");
  }
  lines.push(report.summary);
  return lines.join("\n");
}

export const PREFLIGHT_META: DomainMeta = {
  name: "preflight",
  summary: "show or run Linear workspace pre-PR readiness checks",
  context: [
    "Quick pre-push readiness probe for the configured Linear workspace.",
    "Default mode (no `--check`) prints a human-readable checklist as a",
    "self-reminder for what to verify by hand. `--check` actually runs the",
    "checks against the Linear API and emits results.",
    "",
    "Checks: `auth` (viewer resolves), `stale` (count of non-terminal",
    "issues with updatedAt > N days), `triage` (count of issues sitting",
    "in any `triage`-type state). Stale and triage report as warnings, not",
    "hard failures — a backlog is a smell, not a blocker.",
    "",
    "JSON output is a stable structured envelope so agents and scripts",
    "can parse results without changing their parsers.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["auth status", "blocked", "issues list"],
};

export function setupPreflightCommands(program: Command): void {
  const preflight = program
    .command("preflight")
    .description("show or run Linear workspace pre-PR readiness checks")
    .option("--check", "run checks against the workspace (default: just list)")
    .option(
      "--skip <names>",
      "comma-separated list of checks to skip (e.g. `stale,triage`)",
    )
    .option(
      "--skip-api",
      "shortcut to skip every API-dependent check (offline mode)",
    )
    .option(
      "--stale-days <n>",
      `flag issues not updated in N+ days (default: ${DEFAULT_STALE_DAYS})`,
      (v) => Number.parseInt(v, 10),
    )
    .option(
      "--json",
      "no-op accepted for compatibility (output is JSON by default)",
    )
    .option(
      "--fix",
      "no-op accepted for compatibility (--fix is not implemented)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          {
            check?: boolean;
            skip?: string;
            skipApi?: boolean;
            staleDays?: number;
            json?: boolean;
            fix?: boolean;
          },
          Command,
        ];
        if (!options.check) {
          process.stdout.write(`${formatChecklist()}\n`);
          return;
        }

        if (
          options.staleDays !== undefined &&
          (!Number.isFinite(options.staleDays) || options.staleDays < 0)
        ) {
          throw new Error(
            `--stale-days must be a non-negative integer (got ${options.staleDays})`,
          );
        }

        const skipNames = new Set<string>();
        if (options.skip) {
          for (const raw of options.skip.split(",")) {
            const trimmed = raw.trim();
            if (!trimmed) continue;
            const canonical = resolveSkipName(trimmed);
            if (canonical === null) {
              throw new Error(
                `--skip: unknown check name '${trimmed}' (try one of: auth, stale, triage, closed_not_archived, broken_parent_edges)`,
              );
            }
            skipNames.add(canonical);
          }
        }
        if (options.skipApi) {
          // Every linear preflight check currently uses the Linear API,
          // so --skip-api just marks them all skipped. Kept as a separate
          // flag because it stays meaningful if future ports add a local
          // check (e.g. config-file validation). lin-hqiz added the
          // closed_not_archived + broken_parent_edges hygiene checks.
          for (const slug of [
            "auth",
            "stale",
            "triage",
            "closed_not_archived",
            "broken_parent_edges",
          ]) {
            const canonical = resolveSkipName(slug);
            if (canonical) skipNames.add(canonical);
          }
        }

        const ctx = createContext(getRootOpts(command));
        const result = await runPreflightChecks({
          client: ctx.gql,
          staleDays: options.staleDays,
          skip: skipNames,
        });
        outputResult(result, formatPreflightReport, getRootOpts(command));
        if (!result.passed) process.exitCode = 1;
      }),
    );

  preflight
    .command("usage")
    .description("show detailed usage for preflight")
    .action(() => {
      console.log(formatDomainUsage(preflight, PREFLIGHT_META));
    });
}
