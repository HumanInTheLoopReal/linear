import type { GraphQLClient } from "../client/graphql-client.js";
import type { UpdatedIssue } from "../common/types.js";
import {
  type CompleteIssueFieldsFragment,
  FilteredSearchIssuesDocument,
  type FilteredSearchIssuesQuery,
  type IssueFilter,
} from "../gql/graphql.js";
import { getIssue, updateIssue } from "./issue-service.js";
import {
  deleteWorkspaceLabel,
  ensureWorkspaceLabel,
  getLabelIssueUsage,
} from "./label-service.js";

export const DEFERRED_LABEL = "deferred";
export const DEFERRED_UNTIL_PREFIX = "deferred-until:";

/**
 * Fetch every issue carrying a deferral label (the bare `deferred` tag or any
 * `deferred-until:*` date). `name.startsWith("deferred")` catches both in one
 * server-side filter, so the hygiene scan in `snooze verify` sees orphaned
 * `deferred-until:` labels even when the bare tag was stripped. Optionally
 * narrowed to a single team. Returns up to 250 issues (snooze sets are small
 * in practice; the verify command notes if the cap is hit). (lin-ay7q)
 */
export async function listDeferredIssues(
  client: GraphQLClient,
  teamId?: string,
): Promise<CompleteIssueFieldsFragment[]> {
  const fragments: IssueFilter[] = [
    { labels: { some: { name: { startsWith: DEFERRED_LABEL } } } },
  ];
  if (teamId) {
    fragments.push({ team: { id: { eq: teamId } } });
  }
  const result = await client.request<FilteredSearchIssuesQuery>(
    FilteredSearchIssuesDocument,
    { first: 250, filter: { and: fragments } },
  );
  return result.issues.nodes;
}

/**
 * After removing one or more `deferred-until:<date>` labels from an issue,
 * delete each label that no other issue still carries. Linear creates one
 * workspace label per unique snooze-until date, so over months these
 * accumulate as cruft; GC at wake/re-snooze time keeps the label list
 * bounded by the count of *currently snoozed* issues, not the count of
 * historical snoozes. Best-effort: probe failures and delete failures are
 * swallowed (the user's snooze/wake should not fail because GC couldn't
 * clean up). `unlabeledIssueId` is excluded from the usage count because
 * Linear's eventual consistency may still report it as a member of the
 * label set for a brief window after our update. (lin-5d8g)
 */
async function gcOrphanDeferredUntilLabels(
  client: GraphQLClient,
  labelIds: string[],
  unlabeledIssueId: string,
): Promise<void> {
  for (const labelId of labelIds) {
    try {
      const users = await getLabelIssueUsage(client, labelId);
      if (users === null) continue;
      const others = users.filter((id) => id !== unlabeledIssueId);
      if (others.length > 0) continue;
      await deleteWorkspaceLabel(client, labelId);
    } catch {
      // best-effort
    }
  }
}

/**
 * Apply the Linear-Hack `deferred` label to an issue, optionally encoding a
 * resurface date as a `deferred-until:<YYYY-MM-DD>` label. The workflow
 * `state` is intentionally NOT changed — the labels alone signal deferral,
 * and `linear next` reads them client-side to drop hidden work from its
 * results.
 *
 * Re-snoozing an issue strips any pre-existing `deferred-until:*` label so
 * the filter never sees two competing dates.
 */
export async function snoozeIssue(
  client: GraphQLClient,
  issueId: string,
  until?: string,
): Promise<UpdatedIssue> {
  const deferredId = await ensureWorkspaceLabel(
    client,
    DEFERRED_LABEL,
    "Linear-Hack: issue is deferred and hidden from `next`.",
  );
  const untilLabelName = until ? `${DEFERRED_UNTIL_PREFIX}${until}` : undefined;
  const untilLabelId = untilLabelName
    ? await ensureWorkspaceLabel(
        client,
        untilLabelName,
        `Linear-Hack: resurface date for a deferred issue.`,
      )
    : undefined;

  const issue = await getIssue(client, issueId);
  const currentLabels =
    "labels" in issue && issue.labels?.nodes ? issue.labels.nodes : [];

  // Remove any stale deferred-until:* labels; preserve the rest. Capture
  // their ids so we can GC the now-orphan workspace labels after the
  // update. Don't strip the label we're about to re-add (would no-op the
  // GC and waste an API call). (lin-5d8g)
  const strippedDeferredUntilIds: string[] = [];
  const preserved: string[] = [];
  for (const l of currentLabels) {
    if (l.name.startsWith(DEFERRED_UNTIL_PREFIX)) {
      if (l.id !== untilLabelId) strippedDeferredUntilIds.push(l.id);
    } else {
      preserved.push(l.id);
    }
  }

  const next = new Set<string>(preserved);
  next.add(deferredId);
  if (untilLabelId) next.add(untilLabelId);

  const updated = await updateIssue(client, issueId, {
    labelIds: Array.from(next),
  });
  if (strippedDeferredUntilIds.length > 0) {
    await gcOrphanDeferredUntilLabels(
      client,
      strippedDeferredUntilIds,
      issueId,
    );
  }
  return updated;
}

export type WakeOutcome =
  | { status: "woke"; issue: UpdatedIssue }
  | { status: "skipped"; issue_id: string; issue_identifier: string };

/**
 * Remove the `deferred` and any `deferred-until:*` labels from an issue,
 * restoring it to `linear next` visibility. When the issue carries no
 * deferral labels at all, returns a `skipped` outcome so the command can
 * surface a warning to stderr without polluting the JSON result set.
 */
export async function wakeIssue(
  client: GraphQLClient,
  issueId: string,
): Promise<WakeOutcome> {
  const issue = await getIssue(client, issueId);
  const currentLabels =
    "labels" in issue && issue.labels?.nodes ? issue.labels.nodes : [];

  const hasDeferred = currentLabels.some(
    (l) =>
      l.name === DEFERRED_LABEL || l.name.startsWith(DEFERRED_UNTIL_PREFIX),
  );
  if (!hasDeferred) {
    return {
      status: "skipped",
      issue_id: issue.id,
      issue_identifier: issue.identifier,
    };
  }

  const remainingIds = currentLabels
    .filter(
      (l) =>
        l.name !== DEFERRED_LABEL && !l.name.startsWith(DEFERRED_UNTIL_PREFIX),
    )
    .map((l) => l.id);
  const strippedDeferredUntilIds = currentLabels
    .filter((l) => l.name.startsWith(DEFERRED_UNTIL_PREFIX))
    .map((l) => l.id);

  const updated = await updateIssue(client, issueId, {
    labelIds: remainingIds,
  });
  if (strippedDeferredUntilIds.length > 0) {
    await gcOrphanDeferredUntilLabels(
      client,
      strippedDeferredUntilIds,
      issueId,
    );
  }
  return { status: "woke", issue: updated };
}
