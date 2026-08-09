/**
 * Issue history service for `linear issues history`.
 *
 * Linear stores history as event-centric `IssueHistory` nodes (one
 * entry per field change). We paginate and shape each event into a flat
 * record that callers can either consume as-is (JSON output) or fold
 * into a timeline.
 *
 * `--limit N` maps to a soft cap on the returned events — we page
 * through Linear results until we have N. Linear's connection sorts
 * newest-first; the limit truncates the head of that sequence.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import {
  GetIssueHistoryDocument,
  type GetIssueHistoryQuery,
  type IssueHistoryEventFieldsFragment,
} from "../gql/graphql.js";

export interface HistoryEvent {
  id: string;
  createdAt: string;
  actor: {
    id: string;
    name: string;
    displayName: string;
    email: string;
  } | null;
  fromState: { id: string; name: string; type: string } | null;
  toState: { id: string; name: string; type: string } | null;
  fromPriority: number | null;
  toPriority: number | null;
  fromTitle: string | null;
  toTitle: string | null;
  fromAssignee: { id: string; name: string; displayName: string } | null;
  toAssignee: { id: string; name: string; displayName: string } | null;
  fromParent: { id: string; identifier: string; title: string } | null;
  toParent: { id: string; identifier: string; title: string } | null;
  addedLabels: Array<{ id: string; name: string }>;
  removedLabels: Array<{ id: string; name: string }>;
  updatedDescription: boolean;
  /**
   * Dependency/relationship changes (lin-8yl1.8). Linear records `depends
   * add/remove` here, not as from/to scalars — without surfacing it those
   * events render as "no field deltas".
   */
  relationChanges: Array<{ identifier: string; type: string }>;
  archived: boolean | null;
  fromEstimate: number | null;
  toEstimate: number | null;
  fromDueDate: string | null;
  toDueDate: string | null;
  fromCycle: { id: string; name: string | null; number: number } | null;
  toCycle: { id: string; name: string | null; number: number } | null;
  fromProject: { id: string; name: string } | null;
  toProject: { id: string; name: string } | null;
}

export interface IssueHistoryResult {
  issue: {
    id: string;
    identifier: string;
    title: string;
  };
  events: HistoryEvent[];
  total: number;
}

function mapEvent(node: IssueHistoryEventFieldsFragment): HistoryEvent {
  return {
    id: node.id,
    createdAt: node.createdAt,
    actor: node.actor ?? null,
    fromState: node.fromState ?? null,
    toState: node.toState ?? null,
    fromPriority: node.fromPriority ?? null,
    toPriority: node.toPriority ?? null,
    fromTitle: node.fromTitle ?? null,
    toTitle: node.toTitle ?? null,
    fromAssignee: node.fromAssignee ?? null,
    toAssignee: node.toAssignee ?? null,
    fromParent: node.fromParent ?? null,
    toParent: node.toParent ?? null,
    addedLabels: node.addedLabels ?? [],
    removedLabels: node.removedLabels ?? [],
    updatedDescription: node.updatedDescription ?? false,
    relationChanges: node.relationChanges ?? [],
    archived: node.archived ?? null,
    fromEstimate: node.fromEstimate ?? null,
    toEstimate: node.toEstimate ?? null,
    fromDueDate: node.fromDueDate ?? null,
    toDueDate: node.toDueDate ?? null,
    fromCycle: node.fromCycle
      ? {
          id: node.fromCycle.id,
          name: node.fromCycle.name ?? null,
          number: node.fromCycle.number,
        }
      : null,
    toCycle: node.toCycle
      ? {
          id: node.toCycle.id,
          name: node.toCycle.name ?? null,
          number: node.toCycle.number,
        }
      : null,
    fromProject: node.fromProject ?? null,
    toProject: node.toProject ?? null,
  };
}

export async function getIssueHistory(
  client: GraphQLClient,
  issueId: string,
  limit = 0,
): Promise<IssueHistoryResult> {
  const events: HistoryEvent[] = [];
  let after: string | undefined;
  let issueMeta: IssueHistoryResult["issue"] | null = null;

  while (true) {
    const pageSize = limit > 0 ? Math.min(100, limit - events.length) : 100;
    if (pageSize <= 0) break;

    const res = await client.request<GetIssueHistoryQuery>(
      GetIssueHistoryDocument,
      { id: issueId, first: pageSize, after },
    );

    if (!issueMeta) {
      issueMeta = {
        id: res.issue.id,
        identifier: res.issue.identifier,
        title: res.issue.title,
      };
    }

    for (const node of res.issue.history.nodes) {
      events.push(mapEvent(node));
      if (limit > 0 && events.length >= limit) break;
    }

    if (limit > 0 && events.length >= limit) break;
    if (!res.issue.history.pageInfo.hasNextPage) break;
    after = res.issue.history.pageInfo.endCursor ?? undefined;
    if (!after) break;
  }

  return {
    issue: issueMeta ?? { id: issueId, identifier: "", title: "" },
    events,
    total: events.length,
  };
}
