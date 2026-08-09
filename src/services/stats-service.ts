import type { GraphQLClient } from "../client/graphql-client.js";
import { isDeferred } from "../common/deferred-label.js";
import { CLOSED_STATE_TYPES } from "../common/issue-lifecycle.js";
import {
  GetViewerDocument,
  type GetViewerQuery,
  type IssueFilter,
  type IssueStatsFieldsFragment,
  ListIssuesForStatsDocument,
  type ListIssuesForStatsQuery,
} from "../gql/graphql.js";

export interface StatusSummary {
  total_issues: number;
  open_issues: number;
  in_progress_issues: number;
  blocked_issues: number;
  deferred_issues: number;
  closed_issues: number;
  ready_issues: number;
  pinned_issues: number;
  epics_eligible_for_closure: number;
  average_lead_time: number;
}

export interface StatusOutput {
  summary: StatusSummary;
  recent_activity: null;
}

export interface GetStatusOptions {
  assignedOnly?: boolean;
  today?: string;
}

const STARTED_STATE_TYPE = "started";

async function paginateStats(
  client: GraphQLClient,
  filter: IssueFilter,
): Promise<IssueStatsFieldsFragment[]> {
  const all: IssueStatsFieldsFragment[] = [];
  let after: string | undefined;
  let hasNextPage = true;

  while (hasNextPage) {
    const result = await client.request<ListIssuesForStatsQuery>(
      ListIssuesForStatsDocument,
      { first: 250, after, filter },
    );
    all.push(...result.issues.nodes);
    hasNextPage = result.issues.pageInfo.hasNextPage;
    after = result.issues.pageInfo.endCursor ?? undefined;
    if (!after) break;
  }

  return all;
}

async function paginateIds(
  client: GraphQLClient,
  filter: IssueFilter,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let after: string | undefined;
  let hasNextPage = true;

  while (hasNextPage) {
    const result = await client.request<ListIssuesForStatsQuery>(
      ListIssuesForStatsDocument,
      { first: 250, after, filter },
    );
    for (const node of result.issues.nodes) ids.add(node.id);
    hasNextPage = result.issues.pageInfo.hasNextPage;
    after = result.issues.pageInfo.endCursor ?? undefined;
    if (!after) break;
  }

  return ids;
}

async function resolveViewerId(client: GraphQLClient): Promise<string> {
  const result = await client.request<GetViewerQuery>(GetViewerDocument);
  return result.viewer.id;
}

export async function getStatus(
  client: GraphQLClient,
  options: GetStatusOptions = {},
): Promise<StatusOutput> {
  // Production passes the real instant so a sub-day `deferred-until:` snooze
  // counts as resurfaced at the right minute; tests inject `today`. (lin-b7hb)
  const now = options.today ?? Date.now();
  const baseFragments: IssueFilter[] = [];
  if (options.assignedOnly) {
    const viewerId = await resolveViewerId(client);
    baseFragments.push({ assignee: { id: { eq: viewerId } } });
  }

  const closedFilter: IssueFilter = {
    and: [
      ...baseFragments,
      { state: { type: { in: [...CLOSED_STATE_TYPES] } } },
    ],
  };
  const activeFilter: IssueFilter = {
    and: [
      ...baseFragments,
      { state: { type: { nin: [...CLOSED_STATE_TYPES] } } },
    ],
  };
  const blockedFilter: IssueFilter = {
    and: [
      ...baseFragments,
      { state: { type: { nin: [...CLOSED_STATE_TYPES] } } },
      { hasBlockedByRelations: { eq: true } },
    ],
  };

  const [closedCount, activeIssues, blockedIds] = await Promise.all([
    paginateIds(client, closedFilter).then((s) => s.size),
    paginateStats(client, activeFilter),
    paginateIds(client, blockedFilter),
  ]);

  let open = 0;
  let inProgress = 0;
  let blocked = 0;
  let deferred = 0;

  for (const issue of activeIssues) {
    const isBlocked = blockedIds.has(issue.id);
    const isDef = isDeferred(issue.labels, now);
    if (isDef) {
      deferred += 1;
    } else if (isBlocked) {
      blocked += 1;
    } else if (issue.state.type === STARTED_STATE_TYPE) {
      inProgress += 1;
    } else {
      open += 1;
    }
  }

  const ready = open;
  const total = open + inProgress + blocked + deferred + closedCount;

  return {
    summary: {
      total_issues: total,
      open_issues: open,
      in_progress_issues: inProgress,
      blocked_issues: blocked,
      deferred_issues: deferred,
      closed_issues: closedCount,
      ready_issues: ready,
      pinned_issues: 0,
      epics_eligible_for_closure: 0,
      average_lead_time: 0,
    },
    recent_activity: null,
  };
}
