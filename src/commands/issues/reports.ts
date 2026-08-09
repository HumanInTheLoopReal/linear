import type { Command } from "commander";
import { resolveAgentLimit } from "../../common/agent-mode.js";
import { getDefaultTeam } from "../../common/config-store.js";
import type { CommandContext } from "../../common/context.js";
import { createContext, getRootOpts } from "../../common/context.js";
import {
  DEFERRED_UNTIL_PREFIX,
  matchesDeferWindow,
} from "../../common/deferred-label.js";
import { invalidParameterError } from "../../common/errors.js";
import {
  parseDueDate,
  parseRelativeDuration,
} from "../../common/identifier.js";
import type { RawFilterFlags } from "../../common/issue-filter.js";
import { prepareIssueFilterOptions } from "../../common/issue-filter-orchestration.js";
import {
  CLOSED_STATE_TYPES,
  stateTypesForLogicalStatus,
} from "../../common/issue-lifecycle.js";
import { withListMeta } from "../../common/list-meta.js";
import {
  handleCommand,
  outputResult,
  outputSuccess,
  parseLimit,
  resolveOutputMode,
} from "../../common/output.js";
import {
  applyScopeToFilter,
  resolveScopeOption,
} from "../../common/scope-filter.js";
import type { IssueFilter } from "../../gql/graphql.js";
import { resolveFilterOptions } from "../../resolvers/issue-filter-options-resolver.js";
import { resolveIssueId } from "../../resolvers/issue-resolver.js";
import { resolveTeamId } from "../../resolvers/team-resolver.js";
import {
  type CountResult,
  countMatching,
  countMatchingGrouped,
  type GroupBy,
  type GroupedCountResult,
} from "../../services/count-service.js";
import { buildIssueFilter } from "../../services/issue-filter.js";
import {
  getCommentCountsByIssueIds,
  getIssue,
  listIssues,
  searchIssues,
} from "../../services/issue-service.js";
import { getStatus } from "../../services/stats-service.js";
import { listStatuses } from "../../services/status-service.js";
import { listTypes } from "../../services/types-service.js";
import { statusIcon } from "../_format.js";
import { formatIssueList, type ListIssueShape } from "./list-format.js";

const DEFER_SCAN_CAP = 250;

export interface FilterOptions extends RawFilterFlags {
  limit: string;
  after?: string;
  query?: string;
  deferBefore?: string;
  deferAfter?: string;
  withCommentCounts?: boolean;
}

function parseDeferBound(flag: string, value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    try {
      return parseDueDate(value);
    } catch (error) {
      throw invalidParameterError(flag, (error as Error).message);
    }
  }
  try {
    return parseRelativeDuration(value);
  } catch (error) {
    throw invalidParameterError(
      flag,
      `${(error as Error).message} (use YYYY-MM-DD or a relative offset like 1w/7d)`,
    );
  }
}

export function addFilterOptions(
  cmd: ReturnType<Command["command"]>,
): typeof cmd {
  return cmd
    .option(
      "--team <team>",
      "filter by team (defaults to team.default config / LINEAR_TEAM)",
    )
    .option(
      "--all-teams",
      "ignore team.default and list across the whole workspace",
    )
    .option("--assignee <user>", "filter by assignee")
    .option("--creator <user>", "filter by creator")
    .option("--project <project>", "filter by project")
    .option(
      "--status <statuses>",
      "filter by status (comma-separated). logical aliases (open, closed, in_progress, active, all) work workspace-wide; team-specific state names require --team. by default `list` hides terminal + archived issues; use `--status all` to surface them. run `linear issues statuses --team <team>` to enumerate.",
    )
    .option("--label <labels>", "filter by labels (comma-separated)")
    .option(
      "--label-pattern <glob>",
      "filter by a label-name glob (e.g. 'type:*', '*-debt'); server-side prefix/suffix/contains. Mutually exclusive with --label.",
    )
    .option("--cycle <cycle>", "filter by cycle (requires --team)")
    .option("--parent <issue>", "filter by parent issue")
    .option(
      "--milestone <milestone>",
      "filter by milestone (requires --project)",
    )
    .option("--priority <n>", "filter by priority (0-4)")
    .option("--estimate <n>", "filter by estimate")
    .option("--due-before <date>", "due before date (YYYY-MM-DD)")
    .option("--due-after <date>", "due after date (YYYY-MM-DD)")
    .option("--created-after <date>", "created after date (YYYY-MM-DD)")
    .option("--created-before <date>", "created before date (YYYY-MM-DD)")
    .option("--completed-after <date>", "completed after date (YYYY-MM-DD)")
    .option("--completed-before <date>", "completed before date (YYYY-MM-DD)")
    .option("--updated-after <date>", "updated after date (YYYY-MM-DD)")
    .option("--updated-before <date>", "updated before date (YYYY-MM-DD)")
    .option("--has-blockers", "only issues that are blocked")
    .option("--is-blocking", "only issues that block others")
    .option(
      "--no-scope",
      "ignore the implicit repo scope label for this call (firehose view)",
    )
    .option(
      "--scope <label>",
      "override the implicit scope label for this call (e.g. git:other)",
    );
}

export async function attachCommentCounts<
  R extends { nodes: Array<{ id: string }> },
>(ctx: CommandContext, result: R, enabled: boolean): Promise<R> {
  if (!enabled || result.nodes.length === 0) return result;
  const counts = await getCommentCountsByIssueIds(
    ctx.gql,
    result.nodes.map((node) => node.id),
  );
  return {
    ...result,
    nodes: result.nodes.map((node) => ({
      ...node,
      commentCount: counts.get(node.id) ?? 0,
    })),
  } as R;
}

export function formatIssueTypes(result: {
  core_types: { name: string; description: string }[];
  custom_types: string[];
}): string {
  const lines: string[] = ["Core work types (built-in):"];
  const nameWidth = Math.max(
    ...result.core_types.map((type) => type.name.length),
  );
  for (const type of result.core_types) {
    lines.push(`  ${type.name.padEnd(nameWidth)}  ${type.description}`);
  }
  lines.push("");
  if (result.custom_types.length === 0) {
    lines.push("No custom types configured.");
    lines.push(
      'Configure by creating a workspace label "type:<name>" (Linear-Hack)',
    );
  } else {
    lines.push("Custom types (from workspace 'type:*' labels):");
    for (const name of result.custom_types) lines.push(`  ${name}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatIssueStatuses(result: {
  statuses: Array<{
    name: string;
    type: string;
    category: string;
    description?: string;
    team: { key: string; name: string };
  }>;
}): string {
  const statuses = result.statuses;
  if (statuses.length === 0) return "\nNo workflow states found.\n\n";
  const byTeam = new Map<string, { teamName: string; rows: typeof statuses }>();
  for (const status of statuses) {
    const existing = byTeam.get(status.team.key);
    if (existing) existing.rows.push(status);
    else {
      byTeam.set(status.team.key, {
        teamName: status.team.name,
        rows: [status],
      });
    }
  }

  const teamCount = byTeam.size;
  const lines: string[] = [""];
  lines.push(
    `Workflow states (${statuses.length} across ${teamCount} team${teamCount === 1 ? "" : "s"}):`,
  );
  for (const [teamKey, { teamName, rows }] of byTeam) {
    lines.push("");
    lines.push(`${teamKey} (${teamName}):`);
    const nameWidth = Math.max(...rows.map((row) => row.name.length));
    for (const status of rows) {
      const icon = statusIcon(status.type);
      const description = status.description ? `  ${status.description}` : "";
      lines.push(
        `  ${icon} ${status.name.padEnd(nameWidth)}  [${status.category.padEnd(6)}]${description}`,
      );
    }
  }
  lines.push("");
  lines.push("Categories: active, wip, done");
  return `${lines.join("\n")}\n`;
}

export function formatIssueCount(result: CountResult): string {
  return `${result.count}\n`;
}

export function formatIssueStatus(result: {
  summary: {
    total_issues: number;
    open_issues: number;
    in_progress_issues: number;
    blocked_issues: number;
    deferred_issues: number;
    closed_issues: number;
    ready_issues: number;
  };
}): string {
  const summary = result.summary;
  const rows: Array<[string, number]> = [
    ["Total Issues:", summary.total_issues],
    ["To Do:", summary.open_issues],
    ["In Progress:", summary.in_progress_issues],
    ["Blocked:", summary.blocked_issues],
    ["Deferred:", summary.deferred_issues],
    ["Done:", summary.closed_issues],
    ["Ready to Work:", summary.ready_issues],
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const lines: string[] = ["", "📊 Issue Database Status", "", "Summary:"];
  for (const [label, count] of rows) {
    lines.push(`  ${label.padEnd(labelWidth)}  ${count}`);
  }
  lines.push("");
  lines.push(
    "For more details, use 'linear issues list' to see individual issues.",
  );
  return `${lines.join("\n")}\n`;
}

export function formatIssueCountGrouped(result: GroupedCountResult): string {
  const lines: string[] = [`Total: ${result.total}`, ""];
  for (const group of result.groups)
    lines.push(`${group.group}: ${group.count}`);
  return `${lines.join("\n")}\n`;
}

export function registerIssueReportCommands(issues: Command): void {
  addFilterOptions(
    issues
      .command("list")
      .description("list issues with optional filters")
      .option("--query <query>", "deprecated: use `issues search <query>`")
      .option(
        "--defer-before <date>",
        "only deferred issues resurfacing before this date (YYYY-MM-DD or offset like 1w); filters the `deferred-until:` resurface date client-side",
      )
      .option(
        "--defer-after <date>",
        "only deferred issues resurfacing after this date (YYYY-MM-DD or offset like 1w)",
      )
      .option("-l, --limit <n>", "max results", "50")
      .option("--after <cursor>", "cursor for next page")
      .option(
        "--with-comment-counts",
        "include a per-issue comment count (commentCount) in each row; one batched query for the page (no N+1)",
      ),
  ).action(
    handleCommand(async (...args: unknown[]) => {
      const [options, command] = args as [FilterOptions, Command];
      const rootOpts = getRootOpts(command);
      const ctx = createContext(rootOpts);
      const withCommentCounts = Boolean(options.withCommentCounts);
      const agentMode = Boolean(rootOpts.agentMode);
      const effectiveLimit = resolveAgentLimit(
        parseLimit(options.limit),
        command.getOptionValueSource("limit"),
        agentMode,
      );
      const paginationOptions = {
        limit: effectiveLimit,
        after: options.after,
      };
      const filterOptions = await resolveFilterOptions(
        ctx.sdk,
        prepareIssueFilterOptions(options),
        ctx.gql,
      );
      const includeClosedInText =
        options.status !== undefined || Boolean(filterOptions.includeArchived);
      const baseFilter = buildIssueFilter(filterOptions);
      const scope = resolveScopeOption(options.scope);
      const filter = applyScopeToFilter(baseFilter, scope);
      const metaScope = {
        team:
          options.team ??
          (options.allTeams ? null : (getDefaultTeam() ?? null)),
        project: options.project ?? null,
      };

      if (options.deferBefore || options.deferAfter) {
        const after = options.deferAfter
          ? parseDeferBound("--defer-after", options.deferAfter)
          : undefined;
        const before = options.deferBefore
          ? parseDeferBound("--defer-before", options.deferBefore)
          : undefined;
        if (after && before && after >= before) {
          throw invalidParameterError(
            "--defer-after / --defer-before",
            `empty window: --defer-after ${after} is not before --defer-before ${before}`,
          );
        }
        const deferNarrow: IssueFilter = {
          labels: { some: { name: { startsWith: DEFERRED_UNTIL_PREFIX } } },
        };
        const deferFilter: IssueFilter = filter
          ? { and: [filter, deferNarrow] }
          : deferNarrow;
        const scanned = await listIssues(
          ctx.gql,
          { limit: DEFER_SCAN_CAP },
          deferFilter,
          { includeArchived: filterOptions.includeArchived },
        );
        const matched = scanned.nodes.filter((node) =>
          matchesDeferWindow(node.labels, after, before),
        );
        const page = matched.slice(0, effectiveLimit);
        const result = await attachCommentCounts(
          ctx,
          {
            nodes: page,
            pageInfo: {
              ...scanned.pageInfo,
              hasNextPage:
                matched.length > effectiveLimit || scanned.pageInfo.hasNextPage,
            },
          },
          withCommentCounts,
        );
        outputResult(
          withListMeta(result, {
            limit: effectiveLimit,
            scope: metaScope,
            agentMode,
          }),
          (data) =>
            formatIssueList(data, {
              includeClosed: includeClosedInText,
            }),
          rootOpts,
        );
        return;
      }

      if (options.query) {
        const openFilter: IssueFilter = {
          state: { type: { nin: [...CLOSED_STATE_TYPES] } },
        };
        const hasExplicitStateFilter = Boolean(
          filterOptions.stateIds?.length ||
            filterOptions.stateTypes?.length ||
            filterOptions.stateTypesExclude?.length,
        );
        const shouldApplyDefaultOpenFilter =
          !filterOptions.includeArchived && !hasExplicitStateFilter;
        const searchFilter = shouldApplyDefaultOpenFilter
          ? filter
            ? { and: [openFilter, filter] }
            : openFilter
          : filter;
        const result = await attachCommentCounts(
          ctx,
          await searchIssues(
            ctx.gql,
            options.query,
            paginationOptions,
            searchFilter,
          ),
          withCommentCounts,
        );
        outputResult(
          withListMeta(result, {
            limit: paginationOptions.limit,
            scope: metaScope,
            agentMode,
          }),
          (data) =>
            formatIssueList(data, { includeClosed: includeClosedInText }),
          rootOpts,
        );
        return;
      }

      const result = await attachCommentCounts(
        ctx,
        await listIssues(ctx.gql, paginationOptions, filter, {
          includeArchived: filterOptions.includeArchived,
        }),
        withCommentCounts,
      );
      outputResult(
        withListMeta(result, {
          limit: paginationOptions.limit,
          scope: metaScope,
          agentMode,
        }),
        (data) =>
          formatIssueList(data, {
            includeClosed: includeClosedInText,
          }),
        rootOpts,
      );
    }),
  );

  issues
    .command("children <parent>")
    .description("list all child issues of a parent (all statuses)")
    .option("-l, --limit <n>", "max results", "50")
    .option("--after <cursor>", "cursor for next page")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are supported.

In text mode (default), the parent itself is the tree root and all
descendants (children, grandchildren, …) are walked depth-first. In
--json mode, the stable shape is a PaginatedResult of direct children
only.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [parent, options, command] = args as [
          string,
          { limit: string; after?: string },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const parentId = await resolveIssueId(ctx.sdk, parent);
        const agentMode = Boolean(rootOpts.agentMode);
        const jsonMode = resolveOutputMode(rootOpts);
        if (jsonMode) {
          const filter = buildIssueFilter({ parentId });
          const childLimit = resolveAgentLimit(
            parseLimit(options.limit),
            command.getOptionValueSource("limit"),
            agentMode,
          );
          const result = await listIssues(
            ctx.gql,
            { limit: childLimit, after: options.after },
            filter,
            { includeClosed: true },
          );
          outputSuccess(
            withListMeta(result, { limit: childLimit, agentMode }),
            jsonMode,
            rootOpts.fields,
          );
          return;
        }

        const parentDetail = await getIssue(ctx.gql, parentId);
        const collected: ListIssueShape[] = [
          parentDetail as unknown as ListIssueShape,
        ];
        const seen = new Set<string>([parentId]);
        const queue: string[] = [parentId];
        const maxFetch = parseLimit(options.limit);
        while (queue.length > 0 && collected.length < maxFetch) {
          const next = queue.shift();
          if (next === undefined) break;
          const filter = buildIssueFilter({ parentId: next });
          const page = await listIssues(ctx.gql, { limit: 250 }, filter, {
            includeClosed: true,
          });
          for (const child of page.nodes) {
            if (seen.has(child.id)) continue;
            seen.add(child.id);
            collected.push(child as unknown as ListIssueShape);
            queue.push(child.id);
            if (collected.length >= maxFetch) break;
          }
        }
        outputResult(
          { nodes: collected },
          (data) => formatIssueList(data, { includeClosed: true }),
          rootOpts,
        );
      }),
    );

  issues
    .command("stale")
    .description("list issues not updated within --days (default 30)")
    .option("-d, --days <n>", "days since last update", "30")
    .option("-s, --status <status>", "filter by status: open | in_progress")
    .option("-n, --limit <n>", "max results", "50")
    .option(
      "--team <team>",
      "scope to a single team (key, name, or UUID; defaults to team.default config / LINEAR_TEAM)",
    )
    .option(
      "--all-teams",
      "ignore team.default and scan the whole workspace (lin-zp6j: opt-in for cross-team queries)",
    )
    .addHelpText(
      "after",
      `\nUses Linear's real \`updatedAt\` timestamp, so results reflect actual
activity.\n\nTeam scope: results are restricted to team.default (or LINEAR_TEAM) by
default — a hygiene command leaking into other teams is unsafe. Pass
--team <key> to override, or --all-teams to scan the whole workspace
explicitly.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          {
            days: string;
            status?: string;
            limit: string;
            team?: string;
            allTeams?: boolean;
          },
          Command,
        ];
        const days = Number.parseInt(options.days, 10);
        if (!Number.isFinite(days) || days < 1) {
          throw invalidParameterError("--days", "must be at least 1");
        }
        const stateTypes: string[] | undefined = (() => {
          if (options.status === undefined) return undefined;
          if (options.status !== "open" && options.status !== "in_progress") {
            throw invalidParameterError(
              "--status",
              "must be 'open' or 'in_progress' (Linear has no native 'blocked' or 'deferred' state types)",
            );
          }
          const mapped = stateTypesForLogicalStatus(options.status);
          return mapped ? [...mapped] : undefined;
        })();
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const effectiveTeam =
          options.team ??
          (options.allTeams ? undefined : (getDefaultTeam() ?? undefined));
        const teamId = effectiveTeam
          ? await resolveTeamId(ctx.sdk, effectiveTeam)
          : undefined;
        const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
        const filter = buildIssueFilter({
          teamId,
          updatedBefore: cutoff,
          stateTypes,
          stateTypesExclude: stateTypes ? undefined : [...CLOSED_STATE_TYPES],
        });
        const result = await listIssues(
          ctx.gql,
          { limit: parseLimit(options.limit) },
          filter,
        );
        outputResult(result, formatIssueList, rootOpts);
      }),
    );

  issues
    .command("types")
    .description(
      "list valid issue types (core built-ins + workspace 'type:*' labels)",
    )
    .addHelpText(
      "after",
      `\nCore types are hardcoded (task, bug, feature, chore, epic, decision,
spike, story, milestone). Custom types are discovered from workspace
labels whose name starts with 'type:' (Linear-Hack — Linear has no
first-class issue-type field). To add a custom type, create a
workspace-wide label such as 'type:research'.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        outputResult(await listTypes(ctx.gql), formatIssueTypes, rootOpts);
      }),
    );

  issues
    .command("statuses")
    .description("list Linear workflow states with their category mapping")
    .option(
      "--team <team>",
      "filter to a single team (key, name, or UUID); default: all teams",
    )
    .addHelpText(
      "after",
      `\nLinear workflow states are per-team and fully user-configurable —
there is no built-in/custom distinction. Each state has a Linear 'type'
(triage, backlog, unstarted, started, completed, canceled, duplicate)
plus a 'category' mapping from those types onto a compact vocabulary
(active, wip, done) for familiarity.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [{ team?: string }, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;
        outputResult(
          await listStatuses(ctx.gql, { teamId }),
          formatIssueStatuses,
          rootOpts,
        );
      }),
    );

  issues
    .command("status")
    .alias("stats")
    .description(
      "issue-database health snapshot (counts by bucket; analogue of `git status`)",
    )
    .option("--all", "kept for CLI familiarity; behavior is the default", false)
    .option(
      "--assigned",
      "scope counts to issues assigned to the current viewer",
      false,
    )
    .option(
      "--no-activity",
      "skip the recent-activity section (always null in linear)",
      false,
    )
    .addHelpText(
      "after",
      `\nLinear has no count-only API; this command paginates through all
non-closed issues plus a count of closed issues. For large workspaces
expect a few hundred ms. \`pinned_issues\`, \`epics_eligible_for_closure\`,
and \`average_lead_time\` have no Linear equivalent and are always 0.
\`recent_activity\` is always null (no git-activity scan in linear).`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          { all: boolean; assigned: boolean; activity: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        outputResult(
          await getStatus(ctx.gql, { assignedOnly: options.assigned }),
          formatIssueStatus,
          rootOpts,
        );
      }),
    );

  addFilterOptions(
    issues
      .command("count")
      .description(
        "count issues matching --<filter> flags, optionally grouped by status/priority/type/assignee/label",
      )
      .option("--by-status", "group counts by derived status bucket", false)
      .option("--by-priority", "group counts by priority (P0..P4)", false)
      .option(
        "--by-type",
        "group counts by 'type:*' label (Linear-Hack convention)",
        false,
      )
      .option("--by-assignee", "group counts by assignee name", false)
      .option("--by-label", "group counts by label name", false),
  )
    .addHelpText(
      "after",
      `\nLinear has no count-only API; this command paginates through the
filtered set and tallies client-side. --by-* flags are mutually
exclusive. --by-type derives from 'type:*' labels (Linear-Hack —
Linear has no first-class issue-type field). --by-status maps state
type → status bucket (open/in_progress/closed).`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          FilterOptions & {
            byStatus: boolean;
            byPriority: boolean;
            byType: boolean;
            byAssignee: boolean;
            byLabel: boolean;
          },
          Command,
        ];
        const groupingFlags: Array<[GroupBy, boolean]> = [
          ["status", options.byStatus],
          ["priority", options.byPriority],
          ["type", options.byType],
          ["assignee", options.byAssignee],
          ["label", options.byLabel],
        ];
        const selected = groupingFlags.filter(([, enabled]) => enabled);
        if (selected.length > 1) {
          throw invalidParameterError(
            "--by-*",
            "only one --by-* flag may be set",
          );
        }
        const groupBy = selected[0]?.[0];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const filterOptions = await resolveFilterOptions(
          ctx.sdk,
          prepareIssueFilterOptions(options),
          ctx.gql,
        );
        const baseFilter = buildIssueFilter(filterOptions);
        const scope = resolveScopeOption(options.scope);
        const filter = applyScopeToFilter(baseFilter, scope);
        if (groupBy) {
          outputResult(
            await countMatchingGrouped(ctx.gql, filter, groupBy),
            formatIssueCountGrouped,
            rootOpts,
          );
          return;
        }
        outputResult(
          await countMatching(ctx.gql, filter),
          formatIssueCount,
          rootOpts,
        );
      }),
    );
}
