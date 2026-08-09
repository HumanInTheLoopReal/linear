import type { GraphQLClient } from "../client/graphql-client.js";
import {
  FindIssuesByLabelNameDocument,
  type FindIssuesByLabelNameQuery,
  type ShipCandidateFieldsFragment,
} from "../gql/graphql.js";
import { updateIssue } from "./issue-service.js";
import { ensureWorkspaceLabel } from "./label-service.js";

export interface ShipResult {
  status: "shipped" | "already_shipped" | "dry_run";
  capability: string;
  issue_id: string;
  issue_identifier: string;
  label?: string;
  would_add?: string;
}

const COMPLETED_STATE_TYPE = "completed";

/**
 * Resolve every issue tagged with the given label name. Paginates so we
 * don't truncate when many issues share a label (rare for capability
 * labels, but possible during migrations).
 */
async function findIssuesByLabelName(
  client: GraphQLClient,
  name: string,
): Promise<ShipCandidateFieldsFragment[]> {
  const issues: ShipCandidateFieldsFragment[] = [];
  let after: string | undefined;
  do {
    const result = await client.request<FindIssuesByLabelNameQuery>(
      FindIssuesByLabelNameDocument,
      { name, first: 250, after },
    );
    issues.push(...result.issues.nodes);
    after = result.issues.pageInfo.hasNextPage
      ? (result.issues.pageInfo.endCursor ?? undefined)
      : undefined;
  } while (after);
  return issues;
}

/**
 * Publish a capability by adding a `provides:<capability>` label to the
 * issue that already carries `export:<capability>`. Used to satisfy
 * cross-project `external:<project>:<capability>` dependencies.
 *
 * The export-label issue must be in a completed state unless `force` is
 * set. Returns an idempotent `already_shipped` if the provides-label is
 * already attached, and a non-mutating `dry_run` if requested.
 *
 * @throws if no issue carries the export label, or more than one does.
 */
export async function shipCapability(
  client: GraphQLClient,
  capability: string,
  options: { force: boolean; dryRun: boolean },
): Promise<ShipResult> {
  const exportLabel = `export:${capability}`;
  const providesLabel = `provides:${capability}`;

  const candidates = await findIssuesByLabelName(client, exportLabel);
  if (candidates.length === 0) {
    throw new Error(
      `no issue found with label '${exportLabel}' (add it first with 'linear issues tag <issue> ${exportLabel}')`,
    );
  }
  if (candidates.length > 1) {
    const list = candidates
      .map((c) => `${c.identifier} (${c.state.name})`)
      .join(", ");
    throw new Error(
      `multiple issues carry label '${exportLabel}': [${list}]; only one issue should export a given capability`,
    );
  }
  const issue = candidates[0]!;

  if (issue.state.type !== COMPLETED_STATE_TYPE && !options.force) {
    throw new Error(
      `issue ${issue.identifier} is not completed (state: ${issue.state.name}); close it first or pass --force`,
    );
  }

  const alreadyShipped = issue.labels.nodes.some(
    (l) => l.name === providesLabel,
  );
  if (alreadyShipped) {
    return {
      status: "already_shipped",
      capability,
      issue_id: issue.id,
      issue_identifier: issue.identifier,
    };
  }

  if (options.dryRun) {
    return {
      status: "dry_run",
      capability,
      issue_id: issue.id,
      issue_identifier: issue.identifier,
      would_add: providesLabel,
    };
  }

  const providesLabelId = await ensureWorkspaceLabel(
    client,
    providesLabel,
    `Capability ${capability} is published by this issue.`,
  );
  const labelIds = Array.from(
    new Set([...issue.labels.nodes.map((l) => l.id), providesLabelId]),
  );
  await updateIssue(client, issue.id, { labelIds });

  return {
    status: "shipped",
    capability,
    issue_id: issue.id,
    issue_identifier: issue.identifier,
    label: providesLabel,
  };
}
