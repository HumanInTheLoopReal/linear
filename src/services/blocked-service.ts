import type { GraphQLClient } from "../client/graphql-client.js";
import {
  isNonClosedStateType,
  NON_CLOSED_STATE_TYPES,
} from "../common/issue-lifecycle.js";
import {
  type ActiveScope,
  applyScopeToFilter,
} from "../common/scope-filter.js";
import {
  type BlockedIssueFieldsFragment,
  GetIssuesForBlockedReportDocument,
  type GetIssuesForBlockedReportQuery,
  type IssueFilter,
} from "../gql/graphql.js";

/**
 * One open blocker, enriched with the fields `blocked --explain` surfaces
 * (identifier/title/status) without re-fetching. `blocked_by` keeps just the
 * identifiers for the non-explain JSON envelope; `blocked_by_details` carries
 * the same blockers in the same order with their detail.
 */
export interface BlockerDetail {
  identifier: string;
  title: string;
  status: string; // state.type (e.g. "started", "backlog")
}

export interface BlockedIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  status: string;
  state_name: string;
  blocked_by: string[]; // identifiers of the OPEN blockers
  blocked_by_details: BlockerDetail[]; // same blockers, with title/status
  blocked_by_count: number;
  team: { id: string; key: string; name: string };
}

/**
 * Walk an issue's inverseRelations of type `blocks` and pick out the blockers
 * that are still in an open state. Linear stores the forward `blocks` edge on
 * the BLOCKER, so the blocked issue sees the blocker via inverseRelations.
 * Returns full detail (identifier/title/status), identifier-sorted so re-runs
 * produce identical output; callers that only need identifiers map over it.
 */
function openBlockersOf(issue: BlockedIssueFieldsFragment): BlockerDetail[] {
  const blockers: BlockerDetail[] = [];
  for (const r of issue.inverseRelations.nodes) {
    if (r.type !== "blocks" || !r.issue) continue;
    if (isNonClosedStateType(r.issue.state.type)) {
      blockers.push({
        identifier: r.issue.identifier,
        title: r.issue.title,
        status: r.issue.state.type,
      });
    }
  }
  return blockers.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/**
 * Enumerate issues with at least one open `blocks` predecessor. Scoped to
 * non-terminal issues so terminal work is never reported as "blocked".
 * Optional parentId narrows to direct children of a given epic; deeper
 * descendant traversal is intentionally not implemented — parent-child is
 * a flat relation here.
 */
export async function listBlockedIssues(
  client: GraphQLClient,
  options: {
    parentId?: string;
    teamId?: string;
    scope?: ActiveScope;
  } = {},
): Promise<BlockedIssue[]> {
  const baseFilter: IssueFilter = {
    state: { type: { in: [...NON_CLOSED_STATE_TYPES] } },
  };
  if (options.parentId) {
    baseFilter.parent = { id: { eq: options.parentId } };
  }
  if (options.teamId) {
    baseFilter.team = { id: { eq: options.teamId } };
  }
  const filter = applyScopeToFilter(baseFilter, options.scope);

  const result: BlockedIssue[] = [];
  let after: string | undefined;
  do {
    const page: GetIssuesForBlockedReportQuery = await client.request(
      GetIssuesForBlockedReportDocument,
      { filter, first: 250, after },
    );
    for (const issue of page.issues.nodes) {
      const blockers = openBlockersOf(issue);
      if (blockers.length === 0) continue;
      result.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        priority: issue.priority,
        status: issue.state.type,
        state_name: issue.state.name,
        blocked_by: blockers.map((b) => b.identifier),
        blocked_by_details: blockers,
        blocked_by_count: blockers.length,
        team: issue.team,
      });
    }
    after = page.issues.pageInfo.hasNextPage
      ? (page.issues.pageInfo.endCursor ?? undefined)
      : undefined;
  } while (after);

  // Sort by priority asc (Linear: 0=No priority, 1=Urgent, ..., 4=Low; lower
  // numbers other than 0 are more urgent). Urgent-first intent: map 0
  // (No priority) to the end, then ascending. Identifier breaks ties.
  result.sort((a, b) => {
    const pa = a.priority === 0 ? Number.POSITIVE_INFINITY : a.priority;
    const pb = b.priority === 0 ? Number.POSITIVE_INFINITY : b.priority;
    if (pa !== pb) return pa - pb;
    return a.identifier.localeCompare(b.identifier);
  });
  return result;
}
