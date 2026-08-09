import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { auditDeferral, deferInstant } from "../common/deferred-label.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import { parseSnoozeFor, parseSnoozeUntil } from "../common/snooze-input.js";
import type { UpdatedIssue } from "../common/types.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import {
  listDeferredIssues,
  snoozeIssue,
} from "../services/deferred-service.js";

export function formatSnoozed(
  issues: UpdatedIssue[],
  until: string | undefined,
): string {
  if (!issues || issues.length === 0) {
    return "✓ No issues snoozed";
  }
  const suffix = until ? ` until ${until}` : "";
  return issues
    .map((i) => `✓ Deferred ${i.identifier ?? i.id}${suffix}`)
    .join("\n");
}

export interface SnoozeVerifyIssue {
  identifier: string;
  title: string;
  team: string;
  problems: { kind: string; detail: string }[];
}

export interface SnoozeVerifyResult {
  scanned: number;
  drifted: number;
  truncated: boolean;
  issues: SnoozeVerifyIssue[];
}

const PROBLEM_LABEL: Record<string, string> = {
  "malformed-date": "malformed date",
  "multiple-dates": "multiple resurface dates",
  "orphaned-until": "orphaned deferred-until",
  stale: "stale (already resurfaced)",
};

export function formatSnoozeVerify(result: SnoozeVerifyResult): string {
  if (result.drifted === 0) {
    const note = result.truncated
      ? " (scan capped at 250; re-run with --team to narrow)"
      : "";
    return `✓ No snooze drift found (${result.scanned} deferred issue(s) scanned)${note}`;
  }

  const lines: string[] = [];
  for (const issue of result.issues) {
    lines.push(`✗ ${issue.identifier}  ${issue.title}`);
    for (const p of issue.problems) {
      const label = PROBLEM_LABEL[p.kind] ?? p.kind;
      lines.push(`    ${label}: ${p.detail}`);
    }
  }
  lines.push("");
  lines.push(
    `${result.drifted} of ${result.scanned} deferred issue(s) have snooze drift.`,
  );
  if (result.truncated) {
    lines.push("Scan capped at 250 issues; re-run with --team to narrow.");
  }
  return lines.join("\n");
}

export const SNOOZE_META: DomainMeta = {
  name: "snooze",
  summary:
    "hide issues from `next` by applying the Linear-Hack `deferred` label",
  context: [
    "snooze applies the `deferred` workspace label to one or more issues",
    "so `linear next` filters them out. when --until / --for / --days is",
    "provided it also applies a `deferred-until:<YYYY-MM-DD>` label (or a",
    "`deferred-until:<YYYY-MM-DDTHHMM>` UTC timestamp for sub-day snoozes);",
    "`next` re-surfaces the issue automatically once the current time passes",
    "the encoded instant.",
    "",
    "resurface sources (mutually exclusive):",
    "  --until YYYY-MM-DD       absolute date",
    "  --until <ISO datetime>   sub-day instant (naive = UTC), e.g.",
    "                           2026-06-01T14:30",
    "  --until <anchor>         today | tomorrow | next week | next month |",
    "                           <weekday> | next <weekday>",
    "  --for 6h / 7d / 1w / 1mo relative offset (units: h, d, w, mo, y)",
    "  --days <n>               shorthand for --for <n>d",
    "",
    "the workflow state is intentionally NOT changed — labels alone signal",
    "deferral. re-snoozing strips any pre-existing `deferred-until:*` label",
    "so at most one resurface date is ever attached.",
    "",
    "use `linear wake <issue>` to remove the labels and restore",
    "visibility immediately.",
    "",
    "`linear snooze verify` scans the workspace for snooze-label drift —",
    "malformed dates, a `deferred-until:` orphaned from `deferred`, or a",
    "stale past date that should have been woken — and exits non-zero in",
    "text mode when any is found (preflight/CI friendly).",
  ].join("\n"),
  arguments: {
    issue: "issue identifier (UUID or ABC-123)",
  },
  seeAlso: ["snooze verify", "wake", "next", "next --include-deferred"],
};

interface SnoozeOptions {
  until?: string;
  for?: string;
  days?: string;
}

export function setupSnoozeCommands(program: Command): void {
  const snooze = program
    .command("snooze <issues...>")
    .description("defer one or more issues from `next` visibility")
    .option(
      "--until <when>",
      "auto-resurface point: YYYY-MM-DD, an ISO datetime (YYYY-MM-DDTHH:MM, naive=UTC), or a natural-language anchor (today/tomorrow/next week/next month/<weekday>); past values warn to stderr",
    )
    .option(
      "--for <duration>",
      "relative offset (`<n><unit>` where unit is h/d/w/mo/y, e.g. `6h`, `1w`, `7d`, `1mo`)",
    )
    .option("--days <n>", "shorthand for --for <n>d (positive integer)")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are
supported. Linear has no native deferral; this is a Linear-Hack that
relies on \`linear next\` reading the labels client-side. Sub-day snoozes
(\`--until <ISO datetime>\`, \`--for 6h\`) encode a \`deferred-until:\`
timestamp and resurface at the right minute; \`next\` compares it against
the current time.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issueIds, options, command] = args as [
          string[],
          SnoozeOptions,
          Command,
        ];

        if (!issueIds || issueIds.length === 0) {
          throw invalidParameterError(
            "<issues>",
            "at least one issue ID is required",
          );
        }

        // --until / --for / --days all target the same resurface date and
        // are mutually exclusive — combining them would force us to pick a
        // winner silently. (lin-j56l)
        const dateSourcesProvided = [
          options.until,
          options.for,
          options.days,
        ].filter((v) => v !== undefined && v !== "").length;
        if (dateSourcesProvided > 1) {
          throw invalidParameterError(
            "--until / --for / --days",
            "are mutually exclusive; use only one",
          );
        }

        const now = new Date();
        let until: string | undefined;
        if (options.until) {
          until = parseSnoozeUntil(options.until, now);
        } else if (options.for) {
          until = parseSnoozeFor(options.for, now);
        } else if (options.days) {
          if (!/^\d+$/.test(options.days)) {
            throw invalidParameterError(
              "--days",
              "must be a positive integer (e.g. `--days 7`)",
            );
          }
          until = parseSnoozeFor(`${options.days}d`, now);
        }
        if (until) {
          // Compare resurface instant vs the real clock so a sub-day datetime
          // is judged at minute precision (lin-b7hb).
          const untilMs = deferInstant(until);
          if (untilMs !== null && untilMs <= now.getTime()) {
            console.error(
              `Warning: resurface date ${until} is in the past; issue will reappear in 'next' immediately.`,
            );
          }
        }

        const ctx = createContext(getRootOpts(command));

        const results = [];
        for (const id of issueIds) {
          const issueId = await resolveIssueId(ctx.sdk, id);
          results.push(await snoozeIssue(ctx.gql, issueId, until));
        }

        outputResult(
          results,
          (data) => formatSnoozed(data, until),
          getRootOpts(command),
        );
      }),
    );

  snooze
    .command("verify")
    .description(
      "scan deferred issues for snooze-label drift (malformed/orphaned/stale dates)",
    )
    .option("--team <team>", "limit the scan to one team (key, name, or UUID)")
    .addHelpText(
      "after",
      `\nLinear has no native deferral, so snooze state lives in mutable
\`deferred\` / \`deferred-until:<date>\` workspace labels that can drift
(hand-edited bad dates, a \`deferred-until:\` orphaned from \`deferred\`,
or a past date never cleaned up). 'verify' is read-only and reports four
kinds of drift; in text mode it exits 1 when any is found (0 when clean)
so it slots into preflight/CI. Pass --json for the structured envelope
(always exit 0). Run 'linear wake <id>' to clear stale labels.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [{ team?: string }, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const teamId = options.team
          ? await resolveTeamId(ctx.sdk, options.team)
          : undefined;
        const issues = await listDeferredIssues(ctx.gql, teamId);
        const nowMs = Date.now();

        const drifted: SnoozeVerifyIssue[] = [];
        for (const issue of issues) {
          const { problems } = auditDeferral(issue.labels, nowMs);
          if (problems.length > 0) {
            drifted.push({
              identifier: issue.identifier,
              title: issue.title,
              team: issue.team.key,
              problems,
            });
          }
        }

        const result: SnoozeVerifyResult = {
          scanned: issues.length,
          drifted: drifted.length,
          truncated: issues.length >= 250,
          issues: drifted,
        };

        outputResult(result, formatSnoozeVerify, rootOpts);
        // Text-mode gating: exit 1 when drift exists so 'snooze verify' can
        // gate a preflight/CI check. --json always exits 0 (the envelope
        // carries .drifted for agents to branch on). Mirrors 'issues lint'.
        if (!rootOpts.json && result.drifted > 0) {
          process.exit(1);
        }
      }),
    );

  snooze
    .command("usage")
    .description("show detailed usage for snooze")
    .action(() => {
      console.log(formatDomainUsage(snooze, SNOOZE_META));
    });
}
