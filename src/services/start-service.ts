/**
 * `linear start <id>` — single-command claim+start. (lin-nzqu)
 *
 * Collapses the most common 2-command workflow (`linear assign <id> <me>`
 * + `linear issues update <id> --status "In Progress"`) into one verb that
 * claims the issue (assigns it to the viewer and moves it to in-progress).
 * Resolves the viewer, assigns the issue,
 * and moves it to its team's `started` state (or to an explicit
 * `--status` override if the user wants a different state name).
 *
 * Unlike `linear switch` (lin-jkzw), `start` does NOT touch any other
 * in-progress issue. It is the no-handoff case.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import type { UpdatedIssue } from "../common/types.js";
import { GetViewerDocument, type GetViewerQuery } from "../gql/graphql.js";
import { updateIssue } from "./issue-service.js";

export interface StartInput {
  issueId: string;
  stateId: string;
}

export interface StartResult {
  /** Freshly-claimed-and-started issue. */
  issue: UpdatedIssue;
}

export async function startIssue(
  client: GraphQLClient,
  input: StartInput,
): Promise<StartResult> {
  const viewerRes = await client.request<GetViewerQuery>(GetViewerDocument);
  const updated = await updateIssue(client, input.issueId, {
    assigneeId: viewerRes.viewer.id,
    stateId: input.stateId,
  });
  return { issue: updated };
}
