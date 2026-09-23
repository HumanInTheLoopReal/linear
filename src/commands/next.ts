import type { Command } from "commander";
import { resolveAgentLimit } from "../common/agent-mode.js";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { globToLabelFilter, LabelGlobError } from "../common/label-glob.js";
import { parsePriorityOption } from "../common/number-options.js";
import { handleCommand, outputResult, parseLimit } from "../common/output.js";
import { resolveScopeOption } from "../common/scope-filter.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import type { IssueFilter } from "../gql/graphql.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import {
  findMissingLabelNames,
  resolveLabelIdsPermissive,
} from "../resolvers/label-resolver.js";
import { resolveStateIdByType } from "../resolvers/status-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import { resolveUserId } from "../resolvers/user-resolver.js";
import {
  buildExplainResult,
  type ReadyExplainItem,
} from "../services/explain-service.js";
import {
  claimReadyIssue,
  listNextIssues,
  READY_SORT_POLICIES,
  type ReadySortPolicy,
} from "../services/next-service.js";
import {
  priorityCol,
  SEPARATOR,
  STATUS_LEGEND,
  statusIcon,
  typeLabel,
} from "./_format.js";
import { warnMissingLabels } from "./issues/reports.js";

export const NEXT_META: DomainMeta = {
  name: "next",
  summary:
    "list ready work — open issues with no active blockers, sorted urgent → low",
  context: [
    "the `next` view answers 'what can i actually start right now?' it",
    "filters to open issues (state types: triage, backlog, unstarted)",
    "whose `hasBlockedByRelations` flag is false, then drops anything",
    "carrying the Linear-Hack `deferred` or `deferred-until:<future-date>`",
    "labels (unless --include-deferred is set).",
    "",
    "sort order is 'urgent first': priority asc with Linear's 0",
    "(No priority) sunk to the end, then identifier as tiebreak.",
    "`--sort` switches the policy: `oldest` drains FIFO by creation date;",
    "`hybrid` floats issues created in the last 48h (ordered by priority)",
    "above everything else and drains the rest oldest-first.",
    "",
    "`--parent <id>` scopes the view to the direct children of an issue or",
    "epic — useful for 'what's ready under this epic right now?'.",
    "",
    "`--exclude-label foo,bar` drops issues carrying any listed label.",
    "convention: label noise as `example`, `seed`, `smoke-test` and run",
    "`linear next --exclude-label example,seed,smoke-test` to hide them.",
    "unknown names skip silently so the flag is safe to keep in muscle",
    "memory even before the labels exist.",
    "",
    "`--claim` greedily claims the first match — sets state to the team's",
    "`started` type and assigns it to the viewer. Linear has no atomic",
    "compare-and-swap so concurrent claims can race; the second caller",
    "would just get the next ready issue on a re-run.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["blocked", "issues list", "issues stale"],
};

interface NextOptions {
  team?: string;
  limit: string;
  priority?: string;
  assignee?: string;
  unassigned?: boolean;
  label?: string[];
  excludeLabel?: string;
  labelPattern?: string;
  type?: string;
  parent?: string;
  sort?: string;
  includeDeferred?: boolean;
  claim?: boolean;
  explain?: boolean;
  scope?: string | boolean;
}

/**
 * Minimal structural shape `formatNext` reads from a `next` candidate. Mirrors
 * the relevant subset of `CompleteIssueFieldsFragment` so unit tests can use
 * inline fixtures without populating every codegen field.
 */
interface NextIssueShape {
  identifier: string;
  title: string;
  priority: number;
  state: { type: string };
  labels?: { nodes: { name: string }[] } | null;
  parent?: {
    title: string;
    labels?: { nodes: { name: string }[] } | null;
  } | null;
}

function nextHasDeferredLabel(issue: NextIssueShape): boolean {
  const nodes = issue.labels?.nodes ?? [];
  for (const l of nodes) {
    if (l.name === "deferred" || l.name.startsWith("deferred-until:")) {
      return true;
    }
  }
  return false;
}

function parentIsEpic(
  labels: { nodes: { name: string }[] } | null | undefined,
): boolean {
  for (const l of labels?.nodes ?? []) {
    if (l.name === "type:epic") return true;
  }
  return false;
}

/**
 * Render the `ready` view: flat list (no tree), with `← <parent-title>`
 * appended whenever the issue's parent is an epic. Footer says
 * `Ready: N issues with no active blockers`.
 *
 * The candidates array is already sorted by `listNextIssues` (priority asc
 * with 0 sunk, identifier tiebreak) — no re-sort here.
 */
export function formatNext(candidates: NextIssueShape[]): string {
  if (candidates.length === 0) {
    // Empty-state line is a single celebratory message with blank lines
    // above and below — no separator, no footer, no legend.
    return "\n✨ No ready work found (all issues have blocking dependencies)\n\n";
  }

  const rows: string[] = [];
  for (const issue of candidates) {
    const deferred = nextHasDeferredLabel(issue);
    const icon = statusIcon(issue.state.type, { deferred });
    const pri = priorityCol(issue.priority);
    const type = typeLabel(issue.labels ?? undefined);
    const baseParts = [icon, issue.identifier, "●", pri, type, issue.title]
      .filter((p) => p !== "")
      .join(" ");
    const suffix =
      issue.parent && parentIsEpic(issue.parent.labels ?? undefined)
        ? ` ← ${issue.parent.title}`
        : "";
    rows.push(`${baseParts}${suffix}`);
  }

  rows.push("");
  rows.push(SEPARATOR);
  rows.push(`Ready: ${candidates.length} issues with no active blockers`);
  rows.push("");
  rows.push(STATUS_LEGEND);
  rows.push("");
  return rows.join("\n");
}

/**
 * Text formatter for `next --claim`. The JSON envelope is an array
 * (`[]` empty, `[ClaimResult]` claimed) so the formatter receives an
 * array too; the second arg carries the candidate title which the
 * `ClaimResult` payload itself doesn't include.
 */
export function formatNextClaim(
  results: { identifier: string }[],
  title?: string,
): string {
  if (results.length === 0) return "No issues ready to claim.\n";
  const r = results[0];
  return `✓ Claimed ${r.identifier}: ${title ?? ""} (now in_progress, assigned to you)\n`;
}

/**
 * Render `next --explain`: for each ready issue, explain WHY it is ready —
 * a bullet/tree view listing any blockers it previously carried that are now
 * closed (resolved-blocker reasoning) plus an unblock note when it gates
 * downstream work.
 *
 *     \n
 *     📊 Ready work explanation\n
 *     \n
 *     ● Ready (N issues):\n
 *     \n
 *       <id> [P<n>] <title>\n
 *         Reason: <reason>\n
 *         Resolved blockers: <id>, <id>\n
 *         Unblocks: M issue(s)\n
 *     \n
 */
export function formatNextExplain(items: ReadyExplainItem[]): string {
  if (items.length === 0) {
    return "\n✨ No ready work found (all issues have blocking dependencies)\n\n";
  }
  const lines: string[] = [""];
  lines.push("📊 Ready work explanation");
  lines.push("");
  lines.push(`● Ready (${items.length} issues):`);
  lines.push("");
  for (const item of items) {
    const pri = priorityCol(item.priority);
    const priTag = pri ? ` [${pri}]` : "";
    lines.push(`  ${item.identifier}${priTag} ${item.title}`);
    lines.push(`    Reason: ${item.reason}`);
    if (item.resolved_blockers.length > 0) {
      lines.push(`    Resolved blockers: ${item.resolved_blockers.join(", ")}`);
    }
    if (item.unblocks_count > 0) {
      lines.push(`    Unblocks: ${item.unblocks_count} issue(s)`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function setupNextCommands(program: Command): void {
  const next = program
    .command("next")
    .description("show ready work (open, no active blockers)")
    .option("--team <team>", "scope to one team (key, name, or UUID)")
    .option("-n, --limit <n>", "max results", "100")
    .option("-p, --priority <n>", "filter by priority (1-4 or P1-P4)")
    .option(
      "-a, --assignee <user>",
      "filter by assignee (email or display name)",
    )
    .option("-u, --unassigned", "only unassigned issues", false)
    .option(
      "-l, --label <labels>",
      "only issues carrying every listed label (comma-separated, repeatable). a label that does not exist matches nothing and is noted on stderr",
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .option(
      "-x, --exclude-label <labels>",
      "drop issues carrying any of these labels (comma-separated; unknown names skip silently — useful for hiding example/seed/smoke-test noise)",
    )
    .option(
      "--label-pattern <glob>",
      "filter by a label-name glob (e.g. 'type:*', '*-debt'); server-side prefix/suffix/contains. Mutually exclusive with --label.",
    )
    .option(
      "-t, --type <type>",
      "filter by Linear-Hack 'type:<value>' label (e.g. 'task', 'bug')",
    )
    .option(
      "--parent <issue>",
      "scope ready work to the direct children of this issue/epic (id or key)",
    )
    .option(
      "-s, --sort <policy>",
      "ready ordering: priority (default, urgent-first), oldest (FIFO drain), hybrid (recent by priority, older oldest-first)",
      "priority",
    )
    .option(
      "--include-deferred",
      "include issues with deferred / deferred-until:<future> labels",
      false,
    )
    .option(
      "--claim",
      "claim the first match (sets started + assignee = viewer; one selector must own concurrent queue selection)",
      false,
    )
    .option(
      "--explain",
      "explain WHY each issue is ready: resolved (now-closed) blockers + unblock note",
      false,
    )
    .option(
      "--no-scope",
      "ignore the implicit repo scope label for this call (firehose view)",
    )
    .option(
      "--scope <label>",
      "override the implicit scope label for this call (e.g. git:other)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [NextOptions, Command];

        if (options.claim && options.assignee) {
          throw invalidParameterError(
            "--claim",
            "cannot be combined with --assignee (claiming always assigns to viewer)",
          );
        }
        if (options.claim && options.unassigned) {
          throw invalidParameterError(
            "--claim",
            "cannot be combined with --unassigned",
          );
        }
        if (options.claim && options.explain) {
          throw invalidParameterError(
            "--claim",
            "cannot be combined with --explain",
          );
        }

        const sortPolicy = (options.sort ?? "priority") as ReadySortPolicy;
        if (!READY_SORT_POLICIES.includes(sortPolicy)) {
          throw invalidParameterError(
            "--sort",
            `invalid sort policy '${options.sort}'. valid values: ${READY_SORT_POLICIES.join(", ")}`,
          );
        }

        const ctx = createContext(getRootOpts(command));

        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;
        const assigneeId = options.assignee
          ? await resolveUserId(ctx.sdk, options.assignee)
          : undefined;
        const priority = options.priority
          ? parsePriorityOption(options.priority)
          : undefined;
        const labelNames = (options.label ?? []).flatMap((value) =>
          value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        const labels = labelNames.length > 0 ? labelNames : undefined;
        if (labels) {
          warnMissingLabels(await findMissingLabelNames(ctx.sdk, labels));
        }
        const excludeLabelIds = options.excludeLabel
          ? await resolveLabelIdsPermissive(
              ctx.sdk,
              options.excludeLabel
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          : undefined;
        const typeLabel = options.type ? `type:${options.type}` : undefined;

        // --label-pattern: server-side label-name glob (lin-ym1m). Mutually
        // exclusive with exact --label.
        if (options.labelPattern && labels) {
          throw invalidParameterError(
            "--label-pattern",
            "cannot be combined with --label (use one label filter at a time)",
          );
        }
        let labelPatternFilter: IssueFilter | undefined;
        if (options.labelPattern) {
          try {
            labelPatternFilter = globToLabelFilter(options.labelPattern);
          } catch (err) {
            if (err instanceof LabelGlobError) {
              throw invalidParameterError("--label-pattern", err.message);
            }
            throw err;
          }
        }

        const parentId = options.parent
          ? await resolveIssueId(ctx.sdk, options.parent)
          : undefined;

        const scope = resolveScopeOption(options.scope);

        const rootOpts = getRootOpts(command);
        // Agent mode trims the default page size (100 → 20); an explicit
        // --limit still wins (lin-g1hy).
        const effectiveLimit = resolveAgentLimit(
          parseLimit(options.limit),
          command.getOptionValueSource("limit"),
          Boolean(rootOpts.agentMode),
        );

        const candidates = await listNextIssues(ctx.gql, {
          teamId,
          assigneeId,
          unassigned: options.unassigned,
          priority,
          labels,
          excludeLabelIds,
          labelPatternFilter,
          typeLabel,
          parentId,
          sort: sortPolicy,
          limit: effectiveLimit,
          includeDeferred: options.includeDeferred,
          scope,
        });

        if (options.explain) {
          // Ready-only reasoning: the blocked/cycle sections belong to
          // `blocked --explain`. JSON emits the full envelope (ready items +
          // empty blocked/cycles + summary) for a stable shape; text renders
          // just the ready bullets via formatNextExplain.
          const envelope = buildExplainResult(candidates, [], []);
          outputResult(envelope, (e) => formatNextExplain(e.ready), rootOpts);
          return;
        }

        if (!options.claim) {
          outputResult(candidates, formatNext, rootOpts);
          return;
        }

        if (candidates.length === 0) {
          outputResult([], formatNextClaim, rootOpts);
          return;
        }

        const target = candidates[0];
        const startedStateId = await resolveStateIdByType(
          ctx.sdk,
          target.team.id,
          "started",
        );
        const result = await claimReadyIssue(ctx.gql, target, startedStateId);
        outputResult(
          [result],
          (arr) => formatNextClaim(arr, target.title),
          rootOpts,
        );
      }),
    );

  next
    .command("usage")
    .description("show detailed usage for next")
    .action(() => {
      console.log(formatDomainUsage(next, NEXT_META));
    });
}
