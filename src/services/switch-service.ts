/**
 * `linear switch <new-id>` — mid-flight task interruption handoff. (lin-jkzw)
 *
 * The most common agent-interrupt workflow: you're working on issue X,
 * discover a blocker / urgent piece of work, and need to swap to issue Y
 * without losing track of X. Without a single verb this takes 4 commands:
 *   1. snooze (or move back to Todo) the old issue
 *   2. update the old issue's status
 *   3. assign the new issue to yourself
 *   4. move the new issue to In Progress
 *
 * `linear switch` collapses those into one call:
 *  - resolves the "old" in-progress issue assigned to you (or honors
 *    --from <old-id>),
 *  - moves it back to its team's `unstarted` state,
 *  - claims + starts the new issue.
 *
 * If no in-progress issue is found and --from is not given, the old-side
 * work is skipped silently (the call still claims+starts the new one).
 * Ambiguous current-in-progress (more than one) is rejected so the user
 * can disambiguate via --from.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import { invalidParameterError } from "../common/errors.js";
import type { UpdatedIssue } from "../common/types.js";
import {
  FilteredSearchIssuesDocument,
  type FilteredSearchIssuesQuery,
  GetIssueByIdDocument,
  type GetIssueByIdQuery,
  GetViewerDocument,
  type GetViewerQuery,
  type IssueFilter,
} from "../gql/graphql.js";
import { updateIssue } from "./issue-service.js";

export interface PrepareSwitchOptions {
  /**
   * Explicit pre-resolved old issue UUID. When omitted,
   * the service finds the viewer's single currently-in-progress issue
   * and uses that. Ambiguity (more than one in-progress) is rejected.
   */
  fromIssueId?: string;
}

export interface SwitchPlan {
  viewerId: string;
  newIssueId: string;
  newTeamId: string;
  oldIssueId: string | null;
  oldTeamId: string | null;
  oldOriginalStateId: string | null;
  oldNeedsUnstarted: boolean;
  oldSource: SwitchResult["oldSource"];
}

export interface SwitchStateIds {
  startedStateId: string;
  unstartedStateId?: string;
}

export interface SwitchResult {
  /**
   * The freshly-claimed-and-started new issue (always present on success).
   */
  new: UpdatedIssue;
  /**
   * The old issue moved back to unstarted, or `null` when nothing was
   * detected and `--from` was not provided.
   */
  old: UpdatedIssue | null;
  /**
   * One of:
   *  - `auto`     — detected the in-progress issue automatically
   *  - `explicit` — caller passed `--from <id>`
   *  - `none`     — no current in-progress, no --from; old-side skipped
   */
  oldSource: "auto" | "explicit" | "none";
}

async function fetchIssueTeamAndState(
  client: GraphQLClient,
  id: string,
): Promise<{ teamId: string; stateId: string; stateType: string }> {
  const res = await client.request<GetIssueByIdQuery>(GetIssueByIdDocument, {
    id,
  });
  if (!res.issue) {
    throw invalidParameterError("<issue>", `not found: ${id}`);
  }
  return {
    teamId: res.issue.team.id,
    stateId: res.issue.state.id,
    stateType: res.issue.state.type,
  };
}

/**
 * Find the viewer's single currently-in-progress (state.type=started)
 * issue. Returns the issue id, or null when none exists. Throws when
 * more than one is found so the caller can ask for `--from`.
 */
async function findCurrentInProgress(
  client: GraphQLClient,
  viewerId: string,
): Promise<string | null> {
  const filter: IssueFilter = {
    and: [
      { assignee: { id: { eq: viewerId } } },
      { state: { type: { eq: "started" } } },
    ],
  };
  const res = await client.request<FilteredSearchIssuesQuery>(
    FilteredSearchIssuesDocument,
    { first: 5, filter },
  );
  const nodes = res.issues.nodes ?? [];
  if (nodes.length === 0) return null;
  if (nodes.length > 1) {
    const ids = nodes.map((n) => n.identifier).join(", ");
    throw invalidParameterError(
      "--from",
      `multiple in-progress issues assigned to you (${ids}); pass --from <id> to disambiguate`,
    );
  }
  return nodes[0]?.id ?? null;
}

export async function prepareSwitch(
  client: GraphQLClient,
  newIssueId: string,
  options: PrepareSwitchOptions = {},
): Promise<SwitchPlan> {
  const viewerRes = await client.request<GetViewerQuery>(GetViewerDocument);
  const viewerId = viewerRes.viewer.id;

  let oldIssueId: string | null = null;
  let oldSource: SwitchResult["oldSource"] = "none";
  if (options.fromIssueId) {
    oldIssueId = options.fromIssueId;
    oldSource = "explicit";
  } else {
    oldIssueId = await findCurrentInProgress(client, viewerId);
    oldSource = oldIssueId ? "auto" : "none";
  }

  if (oldIssueId === newIssueId) {
    throw invalidParameterError(
      "<new>",
      "the in-progress issue is the same as <new>; nothing to switch",
    );
  }

  const [newMeta, oldMeta] = await Promise.all([
    fetchIssueTeamAndState(client, newIssueId),
    oldIssueId
      ? fetchIssueTeamAndState(client, oldIssueId)
      : Promise.resolve(null),
  ]);

  return {
    viewerId,
    newIssueId,
    newTeamId: newMeta.teamId,
    oldIssueId,
    oldTeamId: oldMeta?.teamId ?? null,
    oldOriginalStateId: oldMeta?.stateId ?? null,
    oldNeedsUnstarted: oldMeta?.stateType === "started",
    oldSource,
  };
}

export async function executeSwitch(
  client: GraphQLClient,
  plan: SwitchPlan,
  stateIds: SwitchStateIds,
): Promise<SwitchResult> {
  const unstartedStateId = stateIds.unstartedStateId;
  if (plan.oldNeedsUnstarted && !unstartedStateId) {
    throw invalidParameterError(
      "switch",
      "missing pre-resolved unstarted state for the old issue",
    );
  }
  if (plan.oldNeedsUnstarted && !plan.oldOriginalStateId) {
    throw invalidParameterError(
      "switch",
      "missing the old issue's original state for rollback",
    );
  }

  let oldUpdated: UpdatedIssue | null = null;
  if (plan.oldIssueId && plan.oldNeedsUnstarted && unstartedStateId) {
    oldUpdated = await updateIssue(client, plan.oldIssueId, {
      stateId: unstartedStateId,
    });
  }

  let newUpdated: UpdatedIssue;
  try {
    newUpdated = await updateIssue(client, plan.newIssueId, {
      assigneeId: plan.viewerId,
      stateId: stateIds.startedStateId,
    });
  } catch (newIssueError) {
    if (oldUpdated && plan.oldIssueId && plan.oldOriginalStateId) {
      try {
        await updateIssue(client, plan.oldIssueId, {
          stateId: plan.oldOriginalStateId,
        });
      } catch (rollbackError) {
        throw new Error(
          `switch partially applied: failed to start ${plan.newIssueId} and failed to restore ${plan.oldIssueId}; new error: ${errorMessage(newIssueError)}; rollback error: ${errorMessage(rollbackError)}`,
        );
      }
      throw new Error(
        `switch failed to start ${plan.newIssueId}; restored ${plan.oldIssueId} to its original state: ${errorMessage(newIssueError)}`,
      );
    }
    throw newIssueError;
  }

  return { new: newUpdated, old: oldUpdated, oldSource: plan.oldSource };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
