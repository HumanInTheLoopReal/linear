import type { GraphQLClient } from "../client/graphql-client.js";
import { NON_CLOSED_STATE_TYPES } from "../common/issue-lifecycle.js";
import {
  type CompleteIssueFieldsFragment,
  FilteredSearchIssuesDocument,
  type FilteredSearchIssuesQuery,
  type IssueFilter,
  PaginationOrderBy,
} from "../gql/graphql.js";

export const TODO_LABEL_NAME = "type:task";
export const TODO_LABEL_DESCRIPTION = "Lightweight TODO task issue.";

/**
 * Enumerate issues bearing the `type:task` label. Open-only by default
 * (`triage | backlog | unstarted | started`); pass `{all: true}` to include
 * closed states. Optional teamId narrows the scan. Sorted by priority
 * ascending with `0` (No priority) bumped to the end, identifier as tiebreak.
 */
export async function listTodos(
  client: GraphQLClient,
  options: { all?: boolean; teamId?: string; limit?: number } = {},
): Promise<CompleteIssueFieldsFragment[]> {
  const limit = options.limit ?? 50;
  const filter: IssueFilter = {
    labels: { name: { eq: TODO_LABEL_NAME } },
  };
  if (!options.all) {
    filter.state = { type: { in: [...NON_CLOSED_STATE_TYPES] } };
  }
  if (options.teamId) {
    filter.team = { id: { eq: options.teamId } };
  }

  const out: CompleteIssueFieldsFragment[] = [];
  let after: string | undefined;
  while (out.length < limit) {
    const pageSize = Math.min(limit - out.length, 250);
    const result: FilteredSearchIssuesQuery = await client.request(
      FilteredSearchIssuesDocument,
      {
        filter,
        first: pageSize,
        after,
        orderBy: PaginationOrderBy.UpdatedAt,
      },
    );
    for (const node of result.issues.nodes) {
      out.push(node);
      if (out.length >= limit) break;
    }
    if (!result.issues.pageInfo.hasNextPage) break;
    after = result.issues.pageInfo.endCursor ?? undefined;
    if (!after) break;
  }

  out.sort((a, b) => {
    const pa = a.priority === 0 ? Number.POSITIVE_INFINITY : a.priority;
    const pb = b.priority === 0 ? Number.POSITIVE_INFINITY : b.priority;
    if (pa !== pb) return pa - pb;
    return a.identifier.localeCompare(b.identifier);
  });
  return out;
}
