import type { GraphQLClient } from "../client/graphql-client.js";
import type { LinearSdkClient } from "../client/linear-client.js";
import type { IssueFilterOptions } from "../common/issue-filter.js";
import type { NormalizedIssueFilterOptions } from "../common/issue-filter-options.js";
import { resolveSearchFilterIds } from "./issue-filter-resolver.js";
import { resolveMilestoneId } from "./milestone-resolver.js";

/**
 * Resolves normalized human-facing filter references to API identifiers.
 *
 * Configuration/default selection and validation happen before this resolver.
 * The optional GraphQL client exists only for the documented milestone lookup
 * exception; every other reference is resolved through the SDK.
 *
 * @param sdkClient - SDK client used for ordinary human-reference resolution
 * @param normalized - Validated references and direct filter values
 * @param milestoneGqlClient - GraphQL exception seam used only for milestones
 */
export async function resolveFilterOptions(
  sdkClient: LinearSdkClient,
  normalized: NormalizedIssueFilterOptions,
  milestoneGqlClient?: GraphQLClient,
): Promise<IssueFilterOptions> {
  const batchResolved = normalized.searchReferences
    ? await resolveSearchFilterIds(sdkClient, normalized.searchReferences)
    : {};

  let milestoneId: string | undefined;
  if (normalized.milestoneReference) {
    if (!milestoneGqlClient) {
      throw new Error(
        "Milestone filter resolution requires the milestone GraphQL client",
      );
    }
    milestoneId = await resolveMilestoneId(
      milestoneGqlClient,
      sdkClient,
      normalized.milestoneReference.milestone,
      normalized.milestoneReference.project,
    );
  }

  return {
    ...batchResolved,
    milestoneId,
    ...normalized.directOptions,
  };
}
