import type { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { getActiveScope } from "../common/scope-filter.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveProjectId } from "../resolvers/project-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import {
  type CheckName,
  DEFAULT_DOCTOR_STALE_DAYS,
  isCheckName,
  listSuppressibleChecks,
  runDoctor,
} from "../services/doctor-service.js";

export const DOCTOR_META: DomainMeta = {
  name: "doctor",
  summary:
    "diagnose Linear workspace + agent-integration health (auth, stale, labels, Claude hooks)",
  context: [
    "Diagnoses two slices. The workspace-shape slice: token validity,",
    "stale work, unowned issues, and label conventions. The",
    "agent-integration slice (lin-i79e): is a linear Claude plugin",
    "present, are the SessionStart/PreCompact `linear prime` hooks wired",
    "into `.claude/settings.json` (project + global), are those settings",
    "files valid JSON, and is the `linear` CLI on PATH so the hooks run.",
    "",
    "Output JSON shape: `{path, checks, overall_ok, cli_version, timestamp,",
    "platform, suppressed_count}`. Each check has `{name, status, message,",
    "detail?, fix?, category}` plus, when `--agent` is set, the richer ZFC",
    "fields `observed_state`, `expected_state`, `explanation`, `commands`,",
    "`severity` — these are always populated by the service; the `--agent`",
    "flag only controls whether they reach the output JSON.",
    "",
    "Doctor is read-only; `--fix` is accepted as a no-op with a note in",
    "the output.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["preflight --check", "auth status", "issues list"],
};

interface DoctorCheckShape {
  name: string;
  status: string;
  message: string;
  detail?: string;
  fix?: string;
  category?: string;
}

interface DoctorReportShape {
  path?: string;
  checks: DoctorCheckShape[];
  overall_ok: boolean;
  cli_version?: string;
  timestamp?: string;
  platform?: { key?: string };
  suppressed_count?: number;
  fix_skipped?: string;
}

function doctorIcon(status: string): string {
  if (status === "ok") return "✓";
  if (status === "warning") return "⚠";
  return "✗";
}

export function formatDoctorReport(report: DoctorReportShape): string {
  const checks = report.checks ?? [];
  const counts = { ok: 0, warning: 0, error: 0 };
  for (const c of checks) {
    if (c.status === "ok") counts.ok += 1;
    else if (c.status === "warning") counts.warning += 1;
    else counts.error += 1;
  }

  const lines: string[] = [];
  if (checks.length === 0) {
    lines.push("✓ No checks ran");
  } else {
    for (const c of checks) {
      lines.push(`${doctorIcon(c.status)} ${c.name}: ${c.message}`);
      if (c.detail) lines.push(`    detail: ${c.detail}`);
      if (c.fix) lines.push(`    fix: ${c.fix}`);
    }
  }

  lines.push("");
  const overall = report.overall_ok ? "✓ healthy" : "✗ issues found";
  const suppressed =
    typeof report.suppressed_count === "number" && report.suppressed_count > 0
      ? ` · suppressed: ${report.suppressed_count}`
      : "";
  lines.push(
    `${overall} · ${checks.length} checks (${counts.ok} ok, ${counts.warning} warning, ${counts.error} error)${suppressed}`,
  );
  if (report.fix_skipped) {
    lines.push(`Note: ${report.fix_skipped}`);
  }
  return lines.join("\n");
}

function stripAgentFields(
  check: Record<string, unknown>,
): Record<string, unknown> {
  const {
    observed_state: _o,
    expected_state: _e,
    explanation: _x,
    commands: _c,
    severity: _s,
    ...rest
  } = check;
  return rest;
}

export function setupDoctorCommands(program: Command): void {
  const doctor = program
    .command("doctor")
    .description("diagnose Linear workspace health")
    .option(
      "--check <name>",
      "run only one check: auth, stale, unassigned, labels, scope_label_exists, scope_drift, scope_coverage, closed_not_archived, broken_parent_edges, stale_by_team_default, claude_plugin, claude_settings, claude_hooks, cli_in_path",
    )
    .option(
      "--stale-days <n>",
      `flag issues not updated in N+ days (default: ${DEFAULT_DOCTOR_STALE_DAYS})`,
      (v) => Number.parseInt(v, 10),
    )
    .option(
      "--required-labels <list>",
      "comma-separated label names the `labels` check should enforce",
    )
    .option(
      "-v, --verbose",
      "include OK checks in the output (default: only warnings/errors)",
    )
    .option(
      "--agent",
      "emit ZFC-compliant agent fields per check (observed_state, expected_state, explanation, commands, severity)",
    )
    .option(
      "--list-suppressible",
      "list every suppressible check slug + its `doctor.suppress.<slug>` config key, then exit",
    )
    .option(
      "--json",
      "no-op accepted for compatibility (output is JSON by default)",
    )
    .option(
      "--fix",
      "no-op accepted for compatibility (linear doctor is read-only advisory)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          {
            check?: string;
            staleDays?: number;
            requiredLabels?: string;
            verbose?: boolean;
            agent?: boolean;
            listSuppressible?: boolean;
            json?: boolean;
            fix?: boolean;
          },
          Command,
        ];

        if (options.listSuppressible) {
          // Pure config listing — no workspace/API access needed.
          outputResult(
            { suppressible: listSuppressibleChecks() },
            (r) =>
              `Suppressible doctor checks (set <key> = "true" to hide the warning):\n${r.suppressible
                .map((s) => `  ${s.name.padEnd(22)} ${s.config_key}`)
                .join("\n")}\n`,
            getRootOpts(command),
          );
          return;
        }

        if (options.check && !isCheckName(options.check)) {
          throw new Error(
            `--check: unknown name '${options.check}' (allowed: auth, stale, unassigned, labels, scope_label_exists, scope_drift, scope_coverage, closed_not_archived, broken_parent_edges, stale_by_team_default, claude_plugin, claude_settings, claude_hooks, cli_in_path)`,
          );
        }
        if (
          options.staleDays !== undefined &&
          (!Number.isFinite(options.staleDays) || options.staleDays < 0)
        ) {
          throw new Error(
            `--stale-days must be a non-negative integer (got ${options.staleDays})`,
          );
        }

        const required = (options.requiredLabels ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        const ctx = createContext(getRootOpts(command));
        const activeScope = getActiveScope();
        const scopeProject = activeScope.project;
        const shouldResolveScopeProject =
          scopeProject !== undefined &&
          (options.check === undefined || options.check === "scope_coverage");
        let scope = activeScope;
        let scopeProjectContext:
          | { name: string; id?: string; resolutionError?: string }
          | undefined;
        if (shouldResolveScopeProject && scopeProject) {
          try {
            const id = await resolveProjectId(ctx.sdk, scopeProject);
            scope = { ...activeScope, project: id };
            scopeProjectContext = { name: scopeProject, id };
          } catch (error) {
            scopeProjectContext = {
              name: scopeProject,
              resolutionError:
                error instanceof Error ? error.message : String(error),
            };
          }
        }

        const defaultTeamName = getDefaultTeam() ?? undefined;
        const shouldResolveDefaultTeam =
          defaultTeamName !== undefined &&
          (options.check === undefined ||
            options.check === "stale_by_team_default");
        let defaultTeam:
          | { name: string; id?: string; resolutionError?: string }
          | undefined;
        if (shouldResolveDefaultTeam) {
          try {
            defaultTeam = {
              name: defaultTeamName,
              id: await resolveTeamId(ctx.sdk, defaultTeamName),
            };
          } catch (error) {
            defaultTeam = {
              name: defaultTeamName,
              resolutionError:
                error instanceof Error ? error.message : String(error),
            };
          }
        }
        const result = await runDoctor({
          client: ctx.gql,
          defaultTeam,
          cliVersion: pkg.version,
          staleDays: options.staleDays,
          requiredLabels: required,
          only: options.check ? (options.check as CheckName) : undefined,
          verbose: options.verbose ?? false,
          scope,
          scopeProject: scopeProjectContext,
        });

        const payload = options.agent
          ? result
          : {
              ...result,
              checks: result.checks.map((c) =>
                stripAgentFields(c as unknown as Record<string, unknown>),
              ),
            };
        if (options.fix) {
          (payload as Record<string, unknown>).fix_skipped =
            "linear doctor is read-only advisory; --fix has no Linear equivalent";
        }
        outputResult(
          payload as unknown as DoctorReportShape,
          formatDoctorReport,
          getRootOpts(command),
        );
        if (!result.overall_ok) process.exitCode = 1;
      }),
    );

  doctor
    .command("usage")
    .description("show detailed usage for doctor")
    .action(() => {
      console.log(formatDomainUsage(doctor, DOCTOR_META));
    });
}
