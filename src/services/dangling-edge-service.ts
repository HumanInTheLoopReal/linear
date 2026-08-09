import type { GraphQLClient } from "../client/graphql-client.js";
import { NON_CLOSED_STATE_TYPES } from "../common/issue-lifecycle.js";
import {
  GetOpenIssuesForGraphDocument,
  type GetOpenIssuesForGraphQuery,
  type GraphNodeFieldsFragment,
  type IssueFilter,
} from "../gql/graphql.js";

export interface DanglingEdge {
  source_id: string;
  source_identifier: string;
  source_title: string;
  relation_id: string;
  relation_type: string;
  direction: "forward" | "inverse";
}

/**
 * Scan open issues for relations whose target side is null. Linear cascade-
 * deletes parent/child relationships when an issue is hard-deleted, but
 * IssueRelation rows (`blocks`, `related`, `duplicate`, `similar`) can be
 * left dangling — the relation node persists with `relatedIssue` (or
 * `issue` for the inverse side) set to null. `linear depends cycles` /
 * `linear orphans` don't surface these. (lin-wb60)
 *
 * `direction` distinguishes which end of the IssueRelation we observed
 * dangling from: "forward" means we walked `source.relations.nodes` and
 * the related (downstream) side was missing; "inverse" means we walked
 * `source.inverseRelations.nodes` and the originating (upstream) side
 * was missing. The same underlying broken edge will only ever be visible
 * from one direction because Linear stores it on a single side.
 */
export async function findDanglingEdges(
  client: GraphQLClient,
  options: { teamId?: string } = {},
): Promise<DanglingEdge[]> {
  const filter: IssueFilter = {
    state: { type: { in: [...NON_CLOSED_STATE_TYPES] } },
  };
  if (options.teamId) {
    filter.team = { id: { eq: options.teamId } };
  }

  const all: GraphNodeFieldsFragment[] = [];
  let after: string | undefined;
  do {
    const result: GetOpenIssuesForGraphQuery = await client.request(
      GetOpenIssuesForGraphDocument,
      { filter, first: 250, after },
    );
    all.push(...result.issues.nodes);
    after = result.issues.pageInfo.hasNextPage
      ? (result.issues.pageInfo.endCursor ?? undefined)
      : undefined;
  } while (after);

  const out: DanglingEdge[] = [];
  for (const issue of all) {
    for (const rel of issue.relations.nodes) {
      if (rel.relatedIssue) continue;
      out.push({
        source_id: issue.id,
        source_identifier: issue.identifier,
        source_title: issue.title,
        relation_id: rel.id,
        relation_type: rel.type,
        direction: "forward",
      });
    }
    for (const rel of issue.inverseRelations.nodes) {
      if (rel.issue) continue;
      out.push({
        source_id: issue.id,
        source_identifier: issue.identifier,
        source_title: issue.title,
        relation_id: rel.id,
        relation_type: rel.type,
        direction: "inverse",
      });
    }
  }
  out.sort((a, b) => {
    if (a.source_identifier !== b.source_identifier)
      return a.source_identifier.localeCompare(b.source_identifier);
    return a.relation_id.localeCompare(b.relation_id);
  });
  return out;
}
