import type { GraphQLClient } from "../client/graphql-client.js";
import { NON_CLOSED_STATE_TYPES } from "../common/issue-lifecycle.js";
import {
  type CompleteIssueFieldsFragment,
  FilteredSearchIssuesDocument,
  type FilteredSearchIssuesQuery,
  type IssueFilter,
} from "../gql/graphql.js";
import { updateIssue } from "./issue-service.js";

export interface AdoptCandidate {
  id: string;
  identifier: string;
  title: string;
  currentLabelIds: string[];
}

export interface FindUnscopedOptions {
  teamId?: string;
  projectId?: string;
  scopeLabel: string;
  limit?: number;
}

/**
 * Find non-terminal issues in the workspace (optionally narrowed to a team or
 * project) that do NOT yet carry the scope label. Used by `linear adopt`
 * to retroactively tag pre-scope work after a fresh `git:<name>` label
 * is introduced.
 *
 * Filter shape:
 *   - `state.type in NON_CLOSED_STATE_TYPES` — includes in-progress work
 *   - optional `team.id.eq` and `project.id.eq`
 *   - `labels.every.name.neq <scopeLabel>` — matches issues with NO label
 *     equal to `<scopeLabel>` (vacuously true for unlabeled issues)
 */
export async function findUnscopedCandidates(
  client: GraphQLClient,
  options: FindUnscopedOptions,
): Promise<AdoptCandidate[]> {
  const fragments: IssueFilter[] = [
    { state: { type: { in: [...NON_CLOSED_STATE_TYPES] } } },
    { labels: { every: { name: { neq: options.scopeLabel } } } },
  ];
  if (options.teamId) {
    fragments.push({ team: { id: { eq: options.teamId } } });
  }
  if (options.projectId) {
    fragments.push({ project: { id: { eq: options.projectId } } });
  }

  const result: AdoptCandidate[] = [];
  let after: string | undefined;
  do {
    const page = await client.request<FilteredSearchIssuesQuery>(
      FilteredSearchIssuesDocument,
      {
        first: 100,
        after,
        filter: { and: fragments },
      },
    );
    for (const issue of page.issues.nodes) {
      result.push(toAdoptCandidate(issue));
      if (options.limit && result.length >= options.limit) {
        return result;
      }
    }
    after = page.issues.pageInfo.hasNextPage
      ? (page.issues.pageInfo.endCursor ?? undefined)
      : undefined;
  } while (after);
  return result;
}

function toAdoptCandidate(issue: CompleteIssueFieldsFragment): AdoptCandidate {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    currentLabelIds: issue.labels?.nodes?.map((l) => l.id) ?? [],
  };
}

export interface TaggedIssue {
  id: string;
  identifier: string;
  labels_added: string[];
}

/**
 * Best-effort bulk-tag pass. Each candidate fetches its own current labels
 * (already in the `AdoptCandidate`) and unions in `scopeLabelId`; the
 * resulting `updateIssue` overwrites the full labelIds set (Linear's
 * `IssueUpdateInput.labelIds` is replace-semantics, not append).
 *
 * Failures are surfaced per-issue: the function returns the successful
 * tag results, and any caught error is rethrown by the command layer
 * after the partial summary is logged.
 */
export async function tagWithScope(
  client: GraphQLClient,
  candidates: AdoptCandidate[],
  scopeLabelId: string,
): Promise<TaggedIssue[]> {
  const results: TaggedIssue[] = [];
  for (const candidate of candidates) {
    if (candidate.currentLabelIds.includes(scopeLabelId)) continue;
    const next = [...candidate.currentLabelIds, scopeLabelId];
    await updateIssue(client, candidate.id, { labelIds: next });
    results.push({
      id: candidate.id,
      identifier: candidate.identifier,
      labels_added: [scopeLabelId],
    });
  }
  return results;
}
