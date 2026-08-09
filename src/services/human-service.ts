/**
 * `linear human` — manage issues flagged for human intervention.
 *
 * Linear-Hack convention: any issue carrying a label named `human` shows
 * up in this domain as a human-decision queue.
 *
 * Subcommands implemented here:
 *   • list     — enumerate the queue (filterable by status)
 *   • respond  — comment + move to a `completed` state for the issue's team
 *   • dismiss  — optional comment + move to a `canceled` state
 *   • stats    — count {total, pending, responded, dismissed}
 *
 * Linear has no first-class CloseReason field; the terminal `state.type`
 * is used as the signal instead — `completed` ≡ responded, while `canceled`
 * and `duplicate` are dismissed. The comment carries the human-readable text.
 *
 * State-id resolution is per-team (each Linear team owns its own workflow
 * states), so the command layer does the SDK lookup (`resolveStateIdByType`)
 * and passes a pre-resolved `stateId` into the service. Services stay on
 * GraphQLClient per the architecture invariants.
 *
 * Status filtering on `list` is a client-side overlay rather than a server
 * filter because Linear's `state.type` filter isn't easily composable with
 * the label filter in a single request; the page is small enough that
 * post-filtering is fine.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import {
  isClosedStateType,
  type LifecycleStatus,
  lifecycleStatusFromStateType,
} from "../common/issue-lifecycle.js";
import {
  CreateCommentDocument,
  type CreateCommentMutation,
  GetHumanIssueByIdDocument,
  type GetHumanIssueByIdQuery,
  type HumanIssueFieldsFragment,
  ListHumanIssuesDocument,
  type ListHumanIssuesQuery,
  UpdateIssueDocument,
  type UpdateIssueMutation,
} from "../gql/graphql.js";

export type HumanStatusFilter = LifecycleStatus;

export interface HumanIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  status_type: string;
  team_key: string | null;
  priority: number | null;
  labels: string[];
  updated_at: string;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

function projectIssue(node: HumanIssueFieldsFragment): HumanIssue {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    status: node.state.name,
    status_type: node.state.type,
    team_key: node.team?.key ?? null,
    priority: node.priority ?? null,
    labels: (node.labels?.nodes ?? []).map((l) => l.name),
    updated_at: node.updatedAt as string,
  };
}

function matchesStatus(
  type: string,
  filter: HumanStatusFilter | undefined,
): boolean {
  if (!filter) return true;
  return lifecycleStatusFromStateType(type) === filter;
}

export interface ListHumanIssuesOpts {
  client: GraphQLClient;
  /** Filter with the shared open/in_progress/closed lifecycle vocabulary. */
  status?: HumanStatusFilter;
}

export async function listHumanIssues(
  opts: ListHumanIssuesOpts,
): Promise<HumanIssue[]> {
  const all: HumanIssue[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const r = await opts.client.request<ListHumanIssuesQuery>(
      ListHumanIssuesDocument,
      { first: PAGE_SIZE, after: cursor },
    );
    for (const node of r.issues.nodes) {
      if (!matchesStatus(node.state.type, opts.status)) continue;
      all.push(projectIssue(node));
    }
    if (!r.issues.pageInfo.hasNextPage) return all;
    cursor = r.issues.pageInfo.endCursor ?? undefined;
    if (!cursor) return all;
  }
  return all;
}

export function isHumanStatusFilter(s: string): s is HumanStatusFilter {
  return s === "open" || s === "in_progress" || s === "closed";
}

const HUMAN_LABEL = "human";

export interface HumanIssueSnapshot {
  id: string;
  identifier: string;
  team_id: string;
  team_key: string | null;
  state_type: string;
  has_human_label: boolean;
}

export async function getHumanIssueSnapshot(
  client: GraphQLClient,
  issueId: string,
): Promise<HumanIssueSnapshot> {
  const r = await client.request<GetHumanIssueByIdQuery>(
    GetHumanIssueByIdDocument,
    { id: issueId },
  );
  if (!r.issue) throw new Error(`Issue with ID "${issueId}" not found`);
  const node = r.issue;
  if (!node.team) {
    throw new Error(`Issue "${node.identifier}" has no team — cannot proceed`);
  }
  return {
    id: node.id,
    identifier: node.identifier,
    team_id: node.team.id,
    team_key: node.team.key ?? null,
    state_type: node.state.type,
    has_human_label: (node.labels?.nodes ?? []).some(
      (l) => l.name === HUMAN_LABEL,
    ),
  };
}

export interface HumanActionResult {
  issue: { id: string; identifier: string };
  action: "responded" | "dismissed";
  /** True when the issue carried the `human` label. Warn-only — `respond`
   * and `dismiss` still proceed without the label. */
  had_human_label: boolean;
  /** UUID of the comment that carries the response/reason text, if any. */
  comment_id: string | null;
  /** The state UUID the issue was transitioned into. */
  state_id: string;
}

export interface RespondHumanIssueOpts {
  client: GraphQLClient;
  /** Pre-resolved issue UUID (resolver runs in command layer). */
  issueId: string;
  /** Pre-resolved `state.type === "completed"` ID for the issue's team. */
  stateId: string;
  /** Required response text; prefixed with `Response: ` on the comment. */
  response: string;
}

export async function respondHumanIssue(
  opts: RespondHumanIssueOpts,
): Promise<HumanActionResult> {
  const snap = await getHumanIssueSnapshot(opts.client, opts.issueId);
  if (isClosedStateType(snap.state_type)) {
    throw new Error(`Issue ${snap.identifier} is already closed`);
  }

  const commentResult = await opts.client.request<CreateCommentMutation>(
    CreateCommentDocument,
    {
      input: {
        issueId: opts.issueId,
        body: `Response: ${opts.response}`,
      },
    },
  );
  if (
    !commentResult.commentCreate.success ||
    !commentResult.commentCreate.comment
  ) {
    throw new Error("Failed to create response comment");
  }
  const commentId = commentResult.commentCreate.comment.id;

  const updateResult = await opts.client.request<UpdateIssueMutation>(
    UpdateIssueDocument,
    {
      id: opts.issueId,
      input: { stateId: opts.stateId },
    },
  );
  if (!updateResult.issueUpdate.success) {
    throw new Error("Failed to move issue to completed state");
  }

  return {
    issue: { id: snap.id, identifier: snap.identifier },
    action: "responded",
    had_human_label: snap.has_human_label,
    comment_id: commentId,
    state_id: opts.stateId,
  };
}

export interface DismissHumanIssueOpts {
  client: GraphQLClient;
  issueId: string;
  /** Pre-resolved `state.type === "canceled"` ID for the issue's team. */
  stateId: string;
  /** Optional reason text; prefixed with `Dismissed: ` on the comment. */
  reason?: string;
}

export async function dismissHumanIssue(
  opts: DismissHumanIssueOpts,
): Promise<HumanActionResult> {
  const snap = await getHumanIssueSnapshot(opts.client, opts.issueId);
  if (isClosedStateType(snap.state_type)) {
    throw new Error(`Issue ${snap.identifier} is already closed`);
  }

  let commentId: string | null = null;
  const reasonText = opts.reason?.trim();
  if (reasonText) {
    const commentResult = await opts.client.request<CreateCommentMutation>(
      CreateCommentDocument,
      {
        input: {
          issueId: opts.issueId,
          body: `Dismissed: ${reasonText}`,
        },
      },
    );
    if (
      !commentResult.commentCreate.success ||
      !commentResult.commentCreate.comment
    ) {
      throw new Error("Failed to create dismissal comment");
    }
    commentId = commentResult.commentCreate.comment.id;
  }

  const updateResult = await opts.client.request<UpdateIssueMutation>(
    UpdateIssueDocument,
    {
      id: opts.issueId,
      input: { stateId: opts.stateId },
    },
  );
  if (!updateResult.issueUpdate.success) {
    throw new Error("Failed to move issue to canceled state");
  }

  return {
    issue: { id: snap.id, identifier: snap.identifier },
    action: "dismissed",
    had_human_label: snap.has_human_label,
    comment_id: commentId,
    state_id: opts.stateId,
  };
}

export interface HumanStats {
  total: number;
  /** Non-terminal: state.type NOT IN [completed, canceled, duplicate]. */
  pending: number;
  /** Terminal `completed`. */
  responded: number;
  /** Terminal `canceled`. */
  dismissed: number;
}

export function summarizeHumanIssues(issues: HumanIssue[]): HumanStats {
  let pending = 0;
  let responded = 0;
  let dismissed = 0;
  for (const i of issues) {
    if (i.status_type === "completed") responded += 1;
    else if (i.status_type === "canceled" || i.status_type === "duplicate")
      dismissed += 1;
    else pending += 1;
  }
  return { total: issues.length, pending, responded, dismissed };
}

export async function humanStats(
  opts: Pick<ListHumanIssuesOpts, "client">,
): Promise<HumanStats> {
  const issues = await listHumanIssues({ client: opts.client });
  return summarizeHumanIssues(issues);
}
