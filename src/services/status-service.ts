import type { GraphQLClient } from "../client/graphql-client.js";
import {
  ListWorkflowStatesDocument,
  type ListWorkflowStatesQuery,
} from "../gql/graphql.js";

export type StatusCategory = "active" | "wip" | "done";

export interface WorkflowStatus {
  id: string;
  name: string;
  type: string;
  category: StatusCategory;
  color: string;
  description?: string;
  position: number;
  team: { id: string; key: string; name: string };
}

export interface ListStatusesOptions {
  teamId?: string;
}

export interface ListStatusesResult {
  statuses: WorkflowStatus[];
}

const TYPE_TO_CATEGORY: Record<string, StatusCategory> = {
  triage: "active",
  backlog: "active",
  unstarted: "active",
  started: "wip",
  completed: "done",
  canceled: "done",
  duplicate: "done",
};

function mapCategory(stateType: string): StatusCategory {
  return TYPE_TO_CATEGORY[stateType] ?? "active";
}

export async function listStatuses(
  client: GraphQLClient,
  options: ListStatusesOptions = {},
): Promise<ListStatusesResult> {
  const filter = options.teamId
    ? { team: { id: { eq: options.teamId } } }
    : undefined;

  const statuses: WorkflowStatus[] = [];
  let after: string | undefined;
  let hasNextPage = true;

  while (hasNextPage) {
    const result = await client.request<ListWorkflowStatesQuery>(
      ListWorkflowStatesDocument,
      { first: 100, after, filter },
    );
    for (const node of result.workflowStates.nodes) {
      statuses.push({
        id: node.id,
        name: node.name,
        type: node.type,
        category: mapCategory(node.type),
        color: node.color,
        description: node.description ?? undefined,
        position: node.position,
        team: node.team,
      });
    }
    hasNextPage = result.workflowStates.pageInfo.hasNextPage;
    after = result.workflowStates.pageInfo.endCursor ?? undefined;
    if (!after) break;
  }

  statuses.sort((a, b) => {
    if (a.team.key !== b.team.key) return a.team.key.localeCompare(b.team.key);
    return a.position - b.position;
  });

  return { statuses };
}
