import type { GraphQLClient } from "../client/graphql-client.js";
import { createComment } from "./comment-service.js";
import { getIssue, updateIssue } from "./issue-service.js";
import { ensureWorkspaceLabel } from "./label-service.js";

const STATE_LABEL_DESCRIPTION =
  "State dimension label (created by linear set-state).";

export interface StateValue {
  issue_id: string;
  issue_identifier: string;
  dimension: string;
  value: string | null;
}

export interface StateDimensions {
  issue_id: string;
  issue_identifier: string;
  states: Record<string, string>;
}

/**
 * Parse the "labels-as-state" convention: any label of the form
 * `<dimension>:<value>` is treated as state. Both halves must be non-empty —
 * a trailing colon or a leading colon produces no entry. Later labels with
 * the same dimension overwrite earlier ones (Linear's label set is unordered
 * but issueUpdate returns a stable order, so this is deterministic enough
 * for `state list` to be consistent across runs).
 */
export function parseStateDimensions(
  labelNames: readonly string[],
): Record<string, string> {
  const states: Record<string, string> = {};
  for (const label of labelNames) {
    const idx = label.indexOf(":");
    if (idx <= 0 || idx === label.length - 1) continue;
    const dimension = label.slice(0, idx);
    const value = label.slice(idx + 1);
    states[dimension] = value;
  }
  return states;
}

/**
 * Read a single state dimension off an issue's labels. Returns
 * `value: null` when no matching `<dimension>:*` label exists.
 */
export async function getStateValue(
  client: GraphQLClient,
  issueId: string,
  dimension: string,
): Promise<StateValue> {
  const issue = await getIssue(client, issueId);
  const labelNames =
    "labels" in issue && issue.labels?.nodes
      ? issue.labels.nodes.map((l) => l.name)
      : [];
  const states = parseStateDimensions(labelNames);
  return {
    issue_id: issue.id,
    issue_identifier: issue.identifier,
    dimension,
    value: states[dimension] ?? null,
  };
}

/**
 * Read every state dimension off an issue's labels into a flat map. Labels
 * that don't follow the `dimension:value` convention are filtered out.
 */
export async function listStateDimensions(
  client: GraphQLClient,
  issueId: string,
): Promise<StateDimensions> {
  const issue = await getIssue(client, issueId);
  const labelNames =
    "labels" in issue && issue.labels?.nodes
      ? issue.labels.nodes.map((l) => l.name)
      : [];
  return {
    issue_id: issue.id,
    issue_identifier: issue.identifier,
    states: parseStateDimensions(labelNames),
  };
}

export interface SetStateResult {
  issue_id: string;
  issue_identifier: string;
  dimension: string;
  old_value: string | null;
  new_value: string;
  comment_id: string | null;
  changed: boolean;
}

/**
 * Atomically set a `<dimension>:<value>` state label on an issue. If a label
 * matching `<dimension>:*` already exists on the issue it is removed in the
 * same update mutation. The new label is auto-created workspace-wide on
 * first use, following the "labels-as-state" convention.
 *
 * Returns `changed: false` (no mutation, no comment) when the dimension is
 * already set to the requested value.
 *
 * An optional `commentCreate` carries the old → new transition and reason.
 */
export async function setStateLabel(
  client: GraphQLClient,
  issueId: string,
  dimension: string,
  newValue: string,
  reason?: string,
): Promise<SetStateResult> {
  const issue = await getIssue(client, issueId);
  const labelNodes =
    "labels" in issue && issue.labels?.nodes ? issue.labels.nodes : [];
  const prefix = `${dimension}:`;
  const existing = labelNodes.find((l) => l.name.startsWith(prefix));
  const oldValue = existing ? existing.name.slice(prefix.length) || null : null;
  const newName = `${dimension}:${newValue}`;

  if (existing?.name === newName) {
    return {
      issue_id: issue.id,
      issue_identifier: issue.identifier,
      dimension,
      old_value: oldValue,
      new_value: newValue,
      comment_id: null,
      changed: false,
    };
  }

  const newLabelId = await ensureWorkspaceLabel(
    client,
    newName,
    STATE_LABEL_DESCRIPTION,
  );
  const labelIds = Array.from(
    new Set([
      ...labelNodes
        .filter((l) => !existing || l.id !== existing.id)
        .map((l) => l.id),
      newLabelId,
    ]),
  );
  await updateIssue(client, issue.id, { labelIds });

  let commentId: string | null = null;
  if (reason) {
    const body = oldValue
      ? `State: ${dimension} ${oldValue} → ${newValue}\n\nReason: ${reason}`
      : `State: ${dimension} set to ${newValue}\n\nReason: ${reason}`;
    const comment = await createComment(client, { issueId: issue.id, body });
    commentId = comment.id;
  }

  return {
    issue_id: issue.id,
    issue_identifier: issue.identifier,
    dimension,
    old_value: oldValue,
    new_value: newValue,
    comment_id: commentId,
    changed: true,
  };
}
