import type { GraphQLClient } from "../client/graphql-client.js";
import { isUuid } from "../common/identifier.js";
import type { PaginatedResult, PaginationOptions } from "../common/types.js";
import {
  CreateIssueLabelDocument,
  type CreateIssueLabelMutation,
  DeleteIssueLabelDocument,
  type DeleteIssueLabelMutation,
  GetIssueLabelUsageDocument,
  type GetIssueLabelUsageQuery,
  GetLabelsDocument,
  type GetLabelsQuery,
  GetProjectLabelsDocument,
  type GetProjectLabelsQuery,
  type IssueLabelFilter,
  type IssueLabelUpdateInput,
  UpdateIssueLabelDocument,
  type UpdateIssueLabelMutation,
} from "../gql/graphql.js";
import { buildIssueFilter } from "./issue-filter.js";
import { getIssue, listIssues, updateIssue } from "./issue-service.js";

export type LabelType = "issue" | "project";
export type LabelScope = "workspace" | "team";

export interface Label {
  id: string;
  name: string;
  color: string;
  description?: string;
  type: LabelType;
}

export interface ListLabelOptions extends PaginationOptions {
  scope?: LabelScope;
}

function buildIssueLabelFilter(
  teamId?: string,
  scope?: LabelScope,
): IssueLabelFilter | undefined {
  if (scope === "workspace") {
    return { team: { null: true } };
  }

  if (scope === "team" && teamId) {
    return { team: { id: { eq: teamId }, null: false } };
  }

  if (teamId) {
    return { team: { id: { eq: teamId } } };
  }

  return undefined;
}

export async function listLabels(
  client: GraphQLClient,
  teamId?: string,
  options: ListLabelOptions = {},
): Promise<PaginatedResult<Label>> {
  const { limit = 50, after, scope } = options;
  const filter = buildIssueLabelFilter(teamId, scope);

  const result = await client.request<GetLabelsQuery>(GetLabelsDocument, {
    first: limit,
    after,
    filter,
  });

  return {
    nodes: result.issueLabels.nodes.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
      description: label.description ?? undefined,
      type: "issue",
    })),
    pageInfo: result.issueLabels.pageInfo,
  };
}

/**
 * Tally how many issues use each label, keyed by label id (lin-ov30.3).
 *
 * Linear's `IssueConnection` exposes no `totalCount` and there is no
 * server-side per-label aggregate, so we sweep every issue once with an
 * empty filter and bucket label usage in memory. Counts span all
 * workflow states (non-terminal + completed + canceled + duplicate),
 * excluding only archived
 * (trashed) issues.
 *
 * Cost is O(issues / pageSize) requests, independent of the number of labels —
 * strictly cheaper than one usage probe per label, which is what callers would
 * otherwise need.
 */
export async function tallyLabelUsage(
  client: GraphQLClient,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let after: string | undefined;

  // Empty filter + includeClosed bypasses the default terminal-state
  // exclusion, so every state is counted.
  for (;;) {
    const page = await listIssues(
      client,
      { limit: 250, after },
      {},
      { includeClosed: true, includeArchived: false },
    );
    for (const issue of page.nodes) {
      for (const label of issue.labels?.nodes ?? []) {
        counts.set(label.id, (counts.get(label.id) ?? 0) + 1);
      }
    }
    if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }

  return counts;
}

/**
 * Locate (or create on first use) a workspace-wide label by case-insensitive
 * name. Used by Linear-Hack conventions that encode metadata in label names
 * (e.g., `type:task`, `provides:<cap>`). Workspace-scoped so the same
 * convention works across teams.
 *
 * Linear treats label names as case-insensitive for uniqueness: creating
 * `bug` when `Bug` exists fails with "Label 'Bug' already exists". We
 * match `eqIgnoreCase` up front to re-use the existing record's id, and
 * fall back to a rediscovery query if the create mutation still fails
 * (e.g. archived labels that the standard filter omits but the uniqueness
 * check still trips on).
 *
 * NOTE: existing call sites in swarm/capability/state/todo each have a
 * private copy of this helper; migration to use the shared version is
 * tracked separately.
 */
export async function ensureWorkspaceLabel(
  client: GraphQLClient,
  name: string,
  description: string,
): Promise<string> {
  const found = await client.request<GetLabelsQuery>(GetLabelsDocument, {
    first: 50,
    filter: { name: { eqIgnoreCase: name } },
  });
  const existing = found.issueLabels.nodes.find(
    (l) => l.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing.id;

  try {
    const created = await client.request<CreateIssueLabelMutation>(
      CreateIssueLabelDocument,
      { input: { name, description } },
    );
    if (
      !created.issueLabelCreate.success ||
      !created.issueLabelCreate.issueLabel
    ) {
      throw new Error(`failed to create label '${name}'`);
    }
    return created.issueLabelCreate.issueLabel.id;
  } catch (err) {
    // Linear's uniqueness check sees archived labels that the default
    // `issueLabels` query omits. On "already exists", retry the lookup
    // with includeArchived so the archived id can be re-used.
    if (!/already exists/i.test(String(err))) throw err;
    const retry = await client.request<GetLabelsQuery>(GetLabelsDocument, {
      first: 50,
      filter: { name: { eqIgnoreCase: name } },
      includeArchived: true,
    });
    const rediscovered = retry.issueLabels.nodes.find(
      (l) => l.name.toLowerCase() === name.toLowerCase(),
    );
    if (rediscovered) return rediscovered.id;
    throw err;
  }
}

/**
 * Resolve a list of label names to workspace label UUIDs, creating missing
 * labels on first use. UUID inputs pass through unchanged and blank names are
 * ignored. Resolution stays sequential to preserve input order and the
 * existing mutation order observed by callers.
 */
export async function ensureWorkspaceLabelIds(
  client: GraphQLClient,
  names: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name.length === 0) continue;
    if (isUuid(name)) {
      ids.push(name);
      continue;
    }
    ids.push(await ensureWorkspaceLabel(client, name, `Label '${name}'.`));
  }
  return ids;
}

/**
 * Resolve a label id for `labels add`, preferring a label already scoped to
 * the *issue's own team* before falling back to the workspace find-or-create
 * path. (lin-ay7q)
 *
 * Why: `ensureWorkspaceLabel` looks up by name with no team filter, so when a
 * team-scoped label (e.g. team EN's `backlog`) shares a name with the intent,
 * it could grab a foreign-team label or shadow it with a workspace duplicate.
 * Tagging an issue from team T should reuse T's own `backlog` when it exists.
 *
 * Precedence (additive — only step 1 is new; 2/3 are the prior behavior):
 *   1. a team-scoped label in `issueTeamId`               → reuse it
 *   2. an existing workspace-global label of that name    → reuse it
 *   3. otherwise create the label workspace-wide          → unchanged default
 *
 * Steps 2 and 3 are exactly what `ensureWorkspaceLabel` already does, so this
 * never regresses the workspace path; it only adds the team-preference probe.
 */
export async function ensureLabelForIssueTeam(
  client: GraphQLClient,
  name: string,
  issueTeamId: string,
  description: string,
): Promise<string> {
  const teamScoped = await client.request<GetLabelsQuery>(GetLabelsDocument, {
    first: 50,
    filter: {
      name: { eqIgnoreCase: name },
      team: { id: { eq: issueTeamId }, null: false },
    },
  });
  const match = teamScoped.issueLabels.nodes.find(
    (l) => l.name.toLowerCase() === name.toLowerCase(),
  );
  if (match) return match.id;
  return ensureWorkspaceLabel(client, name, description);
}

export interface CreateLabelResult {
  id: string;
  name: string;
  created: boolean;
}

/**
 * Idempotent workspace-label creation. If a label with this name already
 * exists (case-insensitive) returns `created: false` so the caller can
 * differentiate "just made it" from "found it". Used by the explicit
 * `linear labels create <name>` verb (lin-s9hs); the implicit auto-create
 * on `labels add` still goes through `ensureWorkspaceLabel` directly.
 */
export async function createWorkspaceLabel(
  client: GraphQLClient,
  name: string,
  description: string,
): Promise<CreateLabelResult> {
  const found = await client.request<GetLabelsQuery>(GetLabelsDocument, {
    first: 50,
    filter: { name: { eqIgnoreCase: name } },
  });
  const existing = found.issueLabels.nodes.find(
    (l) => l.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    return { id: existing.id, name: existing.name, created: false };
  }
  const id = await ensureWorkspaceLabel(client, name, description);
  return { id, name, created: true };
}

export interface UpdateLabelResult {
  id: string;
  name: string;
  description?: string | null;
}

/**
 * Rename and/or re-describe an existing label. Linear applies only the keys
 * present in `input`, so this never clears a field the caller left alone,
 * and every issue already carrying the label keeps it.
 *
 * Unlike `deleteWorkspaceLabel` (best-effort, used by snooze GC) this throws
 * on failure — it backs an explicit user verb, so a silent no-op would be
 * indistinguishable from success.
 */
export async function updateWorkspaceLabel(
  client: GraphQLClient,
  labelId: string,
  input: IssueLabelUpdateInput,
): Promise<UpdateLabelResult> {
  const result = await client.request<UpdateIssueLabelMutation>(
    UpdateIssueLabelDocument,
    { id: labelId, input },
  );
  if (
    !result.issueLabelUpdate?.success ||
    !result.issueLabelUpdate.issueLabel
  ) {
    throw new Error("Failed to update label");
  }
  const label = result.issueLabelUpdate.issueLabel;
  return {
    id: label.id,
    name: label.name,
    description: label.description ?? null,
  };
}

/**
 * Permanently delete a workspace/team label by id. Used by snooze GC to
 * prune dated `deferred-until:<YYYY-MM-DD>` labels once no issue still
 * carries them. Returns false (instead of throwing) when Linear declines —
 * the GC path is best-effort and shouldn't fail the user's wake/snooze
 * command if the label can't be deleted for permissions or race reasons.
 * (lin-5d8g)
 */
export async function deleteWorkspaceLabel(
  client: GraphQLClient,
  labelId: string,
): Promise<boolean> {
  try {
    const result = await client.request<DeleteIssueLabelMutation>(
      DeleteIssueLabelDocument,
      { id: labelId },
    );
    return Boolean(result.issueLabelDelete?.success);
  } catch {
    return false;
  }
}

/**
 * Probe whether a workspace label is still applied to any issue. Returns
 * the list of issue ids (capped at 2 by the query) so callers can decide
 * "is the only remaining user the one I just unlabeled?". A null result
 * means the label itself no longer exists (already deleted), which the
 * GC path treats as "nothing to clean". (lin-5d8g)
 */
export async function getLabelIssueUsage(
  client: GraphQLClient,
  labelId: string,
): Promise<string[] | null> {
  const result = await client.request<GetIssueLabelUsageQuery>(
    GetIssueLabelUsageDocument,
    { id: labelId },
  );
  if (!result.issueLabel) return null;
  return result.issueLabel.issues.nodes.map((n) => n.id);
}

export async function listProjectLabels(
  client: GraphQLClient,
  options: PaginationOptions = {},
): Promise<PaginatedResult<Label>> {
  const { limit = 50, after } = options;

  const result = await client.request<GetProjectLabelsQuery>(
    GetProjectLabelsDocument,
    {
      first: limit,
      after,
    },
  );

  return {
    nodes: result.projectLabels.nodes.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
      description: label.description ?? undefined,
      type: "project",
    })),
    pageInfo: result.projectLabels.pageInfo,
  };
}

export type LabelOpStatus = "added" | "removed" | "propagated";

export interface LabelOpResult {
  status: LabelOpStatus;
  issue_id: string;
  issue_identifier: string;
  label: string;
  changed: boolean;
}

function readCurrentLabelIds(issue: {
  labels?: { nodes?: Array<{ id: string }> } | null;
}): string[] {
  return issue.labels?.nodes?.map((l) => l.id) ?? [];
}

export async function getLabelsForIssue(
  client: GraphQLClient,
  issueId: string,
): Promise<string[]> {
  const issue = await getIssue(client, issueId);
  if (!("labels" in issue) || !issue.labels?.nodes) return [];
  return issue.labels.nodes.map((l) => l.name).sort();
}

export async function addLabelToIssues(
  client: GraphQLClient,
  issueIds: string[],
  labelId: string,
  labelName: string,
): Promise<LabelOpResult[]> {
  const results: LabelOpResult[] = [];
  for (const id of issueIds) {
    const issue = await getIssue(client, id);
    const currentIds = readCurrentLabelIds(issue);
    if (currentIds.includes(labelId)) {
      results.push({
        status: "added",
        issue_id: issue.id,
        issue_identifier: issue.identifier,
        label: labelName,
        changed: false,
      });
      continue;
    }
    await updateIssue(client, issue.id, {
      labelIds: [...currentIds, labelId],
    });
    results.push({
      status: "added",
      issue_id: issue.id,
      issue_identifier: issue.identifier,
      label: labelName,
      changed: true,
    });
  }
  return results;
}

export async function removeLabelFromIssues(
  client: GraphQLClient,
  issueIds: string[],
  labelId: string,
  labelName: string,
): Promise<LabelOpResult[]> {
  const results: LabelOpResult[] = [];
  for (const id of issueIds) {
    const issue = await getIssue(client, id);
    const currentIds = readCurrentLabelIds(issue);
    if (!currentIds.includes(labelId)) {
      results.push({
        status: "removed",
        issue_id: issue.id,
        issue_identifier: issue.identifier,
        label: labelName,
        changed: false,
      });
      continue;
    }
    await updateIssue(client, issue.id, {
      labelIds: currentIds.filter((cid) => cid !== labelId),
    });
    results.push({
      status: "removed",
      issue_id: issue.id,
      issue_identifier: issue.identifier,
      label: labelName,
      changed: true,
    });
  }
  return results;
}

export async function propagateLabelToChildren(
  client: GraphQLClient,
  parentId: string,
  labelId: string,
  labelName: string,
): Promise<LabelOpResult[]> {
  const filter = buildIssueFilter({ parentId });
  const children = await listIssues(client, { limit: 250 }, filter, {
    includeClosed: true,
  });

  const results: LabelOpResult[] = [];
  for (const child of children.nodes) {
    const currentIds = readCurrentLabelIds(child);
    if (currentIds.includes(labelId)) {
      results.push({
        status: "propagated",
        issue_id: child.id,
        issue_identifier: child.identifier,
        label: labelName,
        changed: false,
      });
      continue;
    }
    await updateIssue(client, child.id, {
      labelIds: [...currentIds, labelId],
    });
    results.push({
      status: "propagated",
      issue_id: child.id,
      issue_identifier: child.identifier,
      label: labelName,
      changed: true,
    });
  }
  return results;
}
