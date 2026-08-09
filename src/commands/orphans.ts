import type { Command } from "commander";
import { confirmGuard, proceedConfirmed } from "../common/confirm.js";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult, parseLimit } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveLabelIds } from "../resolvers/label-resolver.js";
import { resolveStateIdByType } from "../resolvers/status-resolver.js";
import {
  closeOrphan,
  findOrphanedIssues,
  type OrphanIssue,
} from "../services/orphans-service.js";

export const ORPHANS_META: DomainMeta = {
  name: "orphans",
  summary:
    "list issues referenced in git commits that are still open — work shipped but never closed",
  context: [
    "orphans scans `git log --oneline --all` for Linear issue identifiers",
    "(e.g. `ENG-123`) and intersects them against the workspace's open",
    "issues. an orphan is anything mentioned in a commit but whose",
    "workflow state has not yet transitioned to a terminal state.",
    "",
    "Run with `--fix` to close the orphans by setting each issue's state",
    "to its team's `completed` type. A human on a TTY is asked Y/n first;",
    "agents in a non-interactive context (non-TTY, CI,",
    "LINEAR_NON_INTERACTIVE, --quiet) proceed automatically — `--fix` is",
    "treated as consent, never blocked on a prompt. Pass `--force`/`--yes`",
    "to skip the Y/n prompt on a TTY too. (Plain `orphans`, with no",
    "`--fix`, already lists what would be closed — that is the preview.)",
  ].join("\n"),
  arguments: {},
  seeAlso: ["issues list", "blocked", "next"],
};

export function formatOrphans(orphans: OrphanIssue[]): string {
  if (!orphans || orphans.length === 0) {
    return "✓ No orphaned issues found";
  }
  const lines: string[] = [];
  lines.push(`Found ${orphans.length} orphaned issue(s):`);
  lines.push("");
  orphans.forEach((o, i) => {
    lines.push(`${i + 1}. [${o.status}] ${o.identifier}: ${o.title}`);
    if (o.latest_commit) {
      const msg = o.latest_commit_message ?? "";
      lines.push(`   commit: ${o.latest_commit} ${msg}`.trimEnd());
    }
  });
  return lines.join("\n");
}

export interface OrphanFixFailure {
  issue: OrphanIssue;
  error: string;
}

export interface OrphanFixResult {
  closed: OrphanIssue[];
  failed: OrphanFixFailure[];
}

export function formatOrphanFixResult(result: OrphanFixResult): string {
  const lines: string[] = [];
  if (result.closed.length > 0) {
    lines.push(`Closed ${result.closed.length} orphaned issue(s):`);
    for (const issue of result.closed) {
      lines.push(`  ✓ ${issue.identifier}: ${issue.title}`);
    }
  }
  if (result.failed.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`Failed to close ${result.failed.length} orphaned issue(s):`);
    for (const failure of result.failed) {
      lines.push(
        `  ✗ ${failure.issue.identifier}: ${failure.issue.title} — ${failure.error}`,
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") : "✓ No orphaned issues found";
}

interface OrphansOptions {
  repo?: string;
  limit?: string;
  label?: string;
  labelAny?: string;
  details?: boolean;
  fix?: boolean;
  force?: boolean;
  yes?: boolean;
}

function splitLabels(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

export function setupOrphansCommands(program: Command): void {
  const orphans = program
    .command("orphans")
    .description(
      "list open issues referenced in git commits (potentially shipped but not closed)",
    )
    .option(
      "--repo <path>",
      "git repository path to scan (default: current directory)",
    )
    .option("-n, --limit <n>", "max open issues to inspect (default: 250)")
    .option(
      "-l, --label <labels>",
      "filter to issues having ALL listed labels (comma-separated)",
    )
    .option(
      "--label-any <labels>",
      "filter to issues having AT LEAST ONE listed label (comma-separated)",
    )
    .option(
      "--details",
      "include the latest matching commit hash + message per orphan",
      false,
    )
    .option(
      "--fix",
      "close each orphan by moving it to its team's `completed` state",
      false,
    )
    .option(
      "--force",
      "with --fix, skip the Y/n confirmation prompt on a TTY",
      false,
    )
    .option(
      "-y, --yes",
      "alias for --force: skip the --fix confirmation prompt",
      false,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [OrphansOptions, Command];

        const skipGuard = options.force === true || options.yes === true;
        if (skipGuard && !options.fix) {
          throw invalidParameterError(
            "--force/--yes",
            "only meaningful in combination with --fix",
          );
        }

        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const labelNames = splitLabels(options.label);
        const labelAnyNames = splitLabels(options.labelAny);
        const labelIds = labelNames
          ? await resolveLabelIds(ctx.sdk, labelNames)
          : undefined;
        const labelIdsAny = labelAnyNames
          ? await resolveLabelIds(ctx.sdk, labelAnyNames)
          : undefined;

        const found = await findOrphanedIssues(ctx.gql, {
          repoPath: options.repo,
          limit: options.limit ? parseLimit(options.limit) : undefined,
          labelIds,
          labelIdsAny,
        });

        const projected = options.details
          ? found
          : found.map((o) => stripDetails(o));

        if (!options.fix) {
          outputResult(projected, formatOrphans, rootOpts);
          return;
        }

        if (found.length === 0) {
          outputResult(
            { closed: [], failed: [] } satisfies OrphanFixResult,
            formatOrphanFixResult,
            rootOpts,
          );
          return;
        }

        // Agent-safe guard: --force/--yes skips it, a TTY human gets a Y/n
        // prompt, and a non-interactive (agent) run proceeds by default —
        // never blocked on a prompt it cannot answer (lin-iowg).
        const decision = await confirmGuard(
          `Close ${found.length} orphaned issue(s)?`,
          { force: skipGuard },
        );
        if (!proceedConfirmed(decision)) {
          outputResult(
            { closed: [], failed: [] } satisfies OrphanFixResult,
            formatOrphanFixResult,
            rootOpts,
          );
          return;
        }

        const teamStateCache = new Map<string, string>();
        const closed: OrphanIssue[] = [];
        const failed: OrphanFixFailure[] = [];
        for (const orphan of found) {
          try {
            let completedStateId = teamStateCache.get(orphan.team_id);
            if (!completedStateId) {
              completedStateId = await resolveStateIdByType(
                ctx.sdk,
                orphan.team_id,
                "completed",
              );
              teamStateCache.set(orphan.team_id, completedStateId);
            }
            await closeOrphan(ctx.gql, orphan, completedStateId);
            closed.push(orphan);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failed.push({ issue: orphan, error: msg });
          }
        }
        const result: OrphanFixResult = {
          closed: options.details ? closed : closed.map((o) => stripDetails(o)),
          failed: failed.map((failure) => ({
            issue: options.details
              ? failure.issue
              : stripDetails(failure.issue),
            error: failure.error,
          })),
        };
        outputResult(result, formatOrphanFixResult, rootOpts);
        if (failed.length > 0) process.exitCode = 1;
      }),
    );

  orphans
    .command("usage")
    .description("show detailed usage for orphans")
    .action(() => {
      console.log(formatDomainUsage(orphans, ORPHANS_META));
    });
}

function stripDetails(o: OrphanIssue): OrphanIssue {
  return {
    issue_id: o.issue_id,
    identifier: o.identifier,
    title: o.title,
    status: o.status,
    team_id: o.team_id,
  };
}
