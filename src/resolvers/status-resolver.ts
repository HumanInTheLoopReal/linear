import type { LinearDocument } from "@linear/sdk";
import type { LinearSdkClient } from "../client/linear-client.js";
import { notFoundError } from "../common/errors.js";
import { isUuid } from "../common/identifier.js";

export async function resolveStatusId(
  client: LinearSdkClient,
  nameOrId: string,
  teamId?: string,
): Promise<string> {
  if (isUuid(nameOrId)) return nameOrId;

  const filter: LinearDocument.WorkflowStateFilter = {
    name: { eqIgnoreCase: nameOrId },
  };

  if (teamId) {
    filter.team = { id: { eq: teamId } };
  }

  const result = await client.sdk.workflowStates({
    filter,
    first: 1,
  });

  if (result.nodes.length === 0) {
    // lin-zst6: point users at the discovery command so they don't have
    // to guess team-specific names. Logical aliases (open, closed,
    // in_progress, …) are handled upstream in resolveSearchFilterIds
    // and don't reach here.
    const context = teamId ? `for team ${teamId}` : undefined;
    const base = notFoundError("Status", nameOrId, context);
    const hint = teamId
      ? " — run `linear issues statuses --team <team>` to list valid names, or use a logical alias (open, closed, in_progress, active)"
      : " — use a logical alias (open, closed, in_progress, active), or pass --team to filter by a team-specific state name";
    throw new Error(`${base.message}${hint}`);
  }

  return result.nodes[0].id;
}

export async function resolveStateIdByType(
  client: LinearSdkClient,
  teamId: string,
  type: "completed" | "unstarted" | "started" | "backlog" | "canceled",
): Promise<string> {
  const result = await client.sdk.workflowStates({
    filter: {
      team: { id: { eq: teamId } },
      type: { eq: type },
    },
    first: 1,
  });

  if (result.nodes.length === 0) {
    throw notFoundError(
      "WorkflowState",
      type,
      `no '${type}' state configured for team ${teamId}`,
    );
  }

  return result.nodes[0].id;
}
