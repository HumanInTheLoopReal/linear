import type { GraphQLClient } from "../client/graphql-client.js";
import { isDeferred } from "../common/deferred-label.js";
import { OPEN_STATE_TYPES } from "../common/issue-lifecycle.js";
import {
  type ActiveScope,
  buildScopeFragments,
} from "../common/scope-filter.js";
import {
  type CompleteIssueFieldsFragment,
  FilteredSearchIssuesDocument,
  type FilteredSearchIssuesQuery,
  GetViewerDocument,
  type GetViewerQuery,
  type IssueFilter,
} from "../gql/graphql.js";
import { labelFilterFragments } from "./issue-filter.js";
import { updateIssue } from "./issue-service.js";

export interface ListNextOptions {
  teamId?: string;
  assigneeId?: string;
  unassigned?: boolean;
  priority?: number;
  /** Label names or UUIDs; an issue must carry every one. */
  labels?: string[];
  /**
   * Label ids to exclude. Issues carrying ANY of these labels are dropped
   * server-side via `labels.every.id.nin`. Empty/undefined → no exclusion.
   * Resolved permissively at the command layer so unknown names skip
   * silently. (lin-ufud)
   */
  excludeLabelIds?: string[];
  /**
   * Pre-built label-name glob fragment (lin-ym1m) from `next --label-pattern`,
   * a complete `{ labels: {...} }` IssueFilter from `globToLabelFilter`. ANDed
   * into the ready filter server-side.
   */
  labelPatternFilter?: IssueFilter;
  typeLabel?: string;
  /**
   * Direct-children filter: keep only issues whose parent is this issue id.
   * Filters to parent-child edges, one level, so `next --parent
   * <epic>` scopes ready work to an epic's children (lin-igmg).
   */
  parentId?: string;
  /**
   * Ready-ordering policy (lin-pazf): `priority` (default, urgent-first),
   * `oldest` (FIFO drain by creation), or `hybrid` (recent issues ordered by
   * priority, older ones drained oldest-first).
   */
  sort?: ReadySortPolicy;
  limit?: number;
  includeDeferred?: boolean;
  today?: string;
  /**
   * Injectable "now" (ISO) for the `hybrid` 48h recency cutoff — defaults to
   * the wall clock; tests pass a fixed value for determinism.
   */
  now?: string;
  /**
   * Implicit per-repo scope to AND into the filter (`labels.some.name == scope.label`,
   * etc.). Pass `undefined` (or omit) to skip — matches the command-layer `--no-scope` flag.
   */
  scope?: ActiveScope;
}

/**
 * List "ready" issues: open, no active blockers, optionally filtered by team /
 * assignee / labels / priority / type. Runs on the Linear-Composite tier
 * (server-side `hasBlockedByRelations: { eq: false }` plus client-side
 * `deferred` label filtering).
 *
 * Sort order: urgent-first — Linear priority ascending with 0
 * ("No priority") moved to the end, identifier as tiebreak.
 */
export async function listNextIssues(
  client: GraphQLClient,
  options: ListNextOptions = {},
): Promise<CompleteIssueFieldsFragment[]> {
  const fragments: IssueFilter[] = [
    { state: { type: { in: [...OPEN_STATE_TYPES] } } },
    { hasBlockedByRelations: { eq: false } },
  ];
  if (options.teamId) {
    fragments.push({ team: { id: { eq: options.teamId } } });
  }
  if (options.assigneeId) {
    fragments.push({ assignee: { id: { eq: options.assigneeId } } });
  }
  if (options.unassigned) {
    fragments.push({ assignee: { null: true } });
  }
  if (options.priority !== undefined) {
    fragments.push({ priority: { eq: options.priority } });
  }
  fragments.push(...labelFilterFragments(options.labels ?? []));
  if (options.excludeLabelIds && options.excludeLabelIds.length > 0) {
    // `every.id.nin` reads as "all of this issue's labels have an id not in
    // the excluded set", which is equivalent to "no label on the issue is in
    // the excluded set". An issue with zero labels passes (every-of-empty is
    // vacuously true), which is the desired behavior. (lin-ufud)
    fragments.push({
      labels: { every: { id: { nin: options.excludeLabelIds } } },
    });
  }
  if (options.typeLabel) {
    fragments.push({
      labels: { some: { name: { eq: options.typeLabel } } },
    });
  }
  if (options.labelPatternFilter) {
    fragments.push(options.labelPatternFilter);
  }
  if (options.parentId) {
    fragments.push({ parent: { id: { eq: options.parentId } } });
  }
  if (options.scope) {
    fragments.push(...buildScopeFragments(options.scope));
  }

  const limit = options.limit ?? 100;
  const result = await client.request<FilteredSearchIssuesQuery>(
    FilteredSearchIssuesDocument,
    { first: limit, filter: { and: fragments } },
  );

  let issues: CompleteIssueFieldsFragment[] = result.issues.nodes;

  if (!options.includeDeferred) {
    // Production passes the real instant so a sub-day `deferred-until:` snooze
    // resurfaces at the right minute; tests inject `today` (start-of-day). (lin-b7hb)
    const now = options.today ?? Date.now();
    issues = issues.filter((issue) => !isDeferred(issue.labels, now));
  }

  return sortReadyIssues(issues, options.sort ?? "priority", options.now);
}

export type ReadySortPolicy = "priority" | "oldest" | "hybrid";

export const READY_SORT_POLICIES: ReadySortPolicy[] = [
  "priority",
  "oldest",
  "hybrid",
];

/** Linear sinks 0 ("No priority") to the end; 1 (urgent) … 4 (low) ascend. */
function readyPriorityRank(priority: number): number {
  return priority === 0 ? Number.POSITIVE_INFINITY : priority;
}

const HYBRID_RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Order ready candidates per the chosen policy (lin-pazf):
 *   - `priority` (default): urgent-first (priority asc, 0 sunk), id tiebreak.
 *   - `oldest`: FIFO drain — oldest `createdAt` first, id tiebreak.
 *   - `hybrid`: issues created within the last 48h are ordered by priority and
 *     floated above everything else; older issues drain oldest-first below.
 */
export function sortReadyIssues<
  T extends {
    priority: number;
    identifier: string;
    createdAt?: string | null;
  },
>(issues: T[], policy: ReadySortPolicy, nowIso?: string): T[] {
  const arr = issues.slice();
  const byCreatedThenId = (a: T, b: T) =>
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
    a.identifier.localeCompare(b.identifier);

  if (policy === "oldest") {
    return arr.sort(byCreatedThenId);
  }

  if (policy === "hybrid") {
    const now = nowIso ? new Date(nowIso).getTime() : Date.now();
    const cutoff = now - HYBRID_RECENT_WINDOW_MS;
    const isRecent = (c?: string | null) =>
      c ? new Date(c).getTime() >= cutoff : false;
    return arr.sort((a, b) => {
      const ra = isRecent(a.createdAt) ? 0 : 1;
      const rb = isRecent(b.createdAt) ? 0 : 1;
      if (ra !== rb) return ra - rb; // recent bucket floats up
      // Recent issues sort by priority; older issues are priority-equalized so
      // they fall through to the oldest-first drain.
      const pa =
        ra === 0 ? readyPriorityRank(a.priority) : Number.POSITIVE_INFINITY;
      const pb =
        rb === 0 ? readyPriorityRank(b.priority) : Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return byCreatedThenId(a, b);
    });
  }

  // priority (default)
  return arr.sort((a, b) => {
    const pa = readyPriorityRank(a.priority);
    const pb = readyPriorityRank(b.priority);
    if (pa !== pb) return pa - pb;
    return a.identifier.localeCompare(b.identifier);
  });
}

export interface ClaimResult {
  id: string;
  identifier: string;
  assignee_id: string;
  state_id: string;
}

/**
 * Best-effort claim of a single ready issue. Linear's `issueUpdate` is not
 * truly atomic against concurrent writers — two callers could each claim the
 * same row if they fire simultaneously. For agent workflows this race is
 * acceptable; the next `claim` call will return a different issue.
 */
export async function claimReadyIssue(
  client: GraphQLClient,
  candidate: CompleteIssueFieldsFragment,
  startedStateId: string,
): Promise<ClaimResult> {
  const viewer = await client.request<GetViewerQuery>(GetViewerDocument);
  const viewerId = viewer.viewer.id;
  await updateIssue(client, candidate.id, {
    stateId: startedStateId,
    assigneeId: viewerId,
  });
  return {
    id: candidate.id,
    identifier: candidate.identifier,
    assignee_id: viewerId,
    state_id: startedStateId,
  };
}
