import { isClosedStateType } from "../common/issue-lifecycle.js";
import type { CompleteIssueFieldsFragment } from "../gql/graphql.js";
import type { BlockedIssue, BlockerDetail } from "./blocked-service.js";

//
// Dependency-aware reasoning shared by `next --explain` and `blocked --explain`.
//
// Ready issues get a resolved-blocker rationale, blocked issues get their open
// blockers enumerated with detail, and dependency cycles are surfaced. The
// builders are pure functions over pre-fetched data so they unit-test without
// any GraphQL plumbing.
//
// "Open" vs "closed" follows the same bucket mapping as the rest of the CLI:
// A blocker counts as RESOLVED once it lands in the canonical `closed` bucket
// (completed / canceled / duplicate).

/** Per-ready-issue reasoning: which blockers were resolved to unblock it. */
export interface ReadyExplainItem {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  /** Human reason: "no blocking dependencies" or "N blocker(s) resolved". */
  reason: string;
  /** Identifiers of previously-blocking issues that are now closed. */
  resolved_blockers: string[];
  /** Count of downstream issues this one blocks (its `blocks` relations). */
  unblocks_count: number;
}

/** Per-blocked-issue reasoning: the remaining OPEN blockers, with detail. */
export interface BlockedExplainItem {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  blocked_by: BlockerDetail[];
  blocked_by_count: number;
}

export interface ExplainSummary {
  total_ready: number;
  total_blocked: number;
  cycle_count: number;
}

/** Structured envelope returned by `next --explain` / `blocked --explain`. */
export interface ExplainResult {
  ready: ReadyExplainItem[];
  blocked: BlockedExplainItem[];
  /** Each cycle is an ordered list of identifiers (loop not closed). */
  cycles: string[][];
  summary: ExplainSummary;
}

/**
 * Build the `ready` reasoning for one batch of ready candidates. A ready issue
 * has no OPEN blockers (Linear's `hasBlockedByRelations` is false), so the
 * interesting signal is which of its former `blocks` predecessors are now
 * CLOSED — those are the "resolved blockers" that unblocked it. We read those
 * off the issue's inverseRelations (the blocker stores the forward `blocks`
 * edge, so the blocked issue sees it inverse).
 */
export function buildReadyItems(
  readyIssues: CompleteIssueFieldsFragment[],
): ReadyExplainItem[] {
  return readyIssues.map((issue) => {
    const resolved: string[] = [];
    for (const r of issue.inverseRelations.nodes) {
      if (r.type !== "blocks") continue;
      if (isClosedStateType(r.issue.state.type)) {
        resolved.push(r.issue.identifier);
      }
    }
    resolved.sort((a, b) => a.localeCompare(b));

    // Downstream issues this one blocks: forward `blocks` relations.
    let unblocks = 0;
    for (const r of issue.relations.nodes) {
      if (r.type === "blocks") unblocks += 1;
    }

    const reason =
      resolved.length > 0
        ? `${resolved.length} blocker(s) resolved`
        : "no blocking dependencies";

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      priority: issue.priority,
      reason,
      resolved_blockers: resolved,
      unblocks_count: unblocks,
    };
  });
}

/**
 * Build the `blocked` reasoning: each blocked issue keeps its open blocker
 * details verbatim from the service. Detail is already identifier-sorted by
 * `listBlockedIssues`.
 */
export function buildBlockedItems(
  blockedIssues: BlockedIssue[],
): BlockedExplainItem[] {
  return blockedIssues.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    priority: issue.priority,
    blocked_by: issue.blocked_by_details,
    blocked_by_count: issue.blocked_by_count,
  }));
}

/**
 * Assemble the full explain envelope from pre-fetched ready issues, blocked
 * issues, and detected cycles (identifier lists). Pure: no GraphQL access.
 */
export function buildExplainResult(
  readyIssues: CompleteIssueFieldsFragment[],
  blockedIssues: BlockedIssue[],
  cycles: string[][],
): ExplainResult {
  const ready = buildReadyItems(readyIssues);
  const blocked = buildBlockedItems(blockedIssues);
  return {
    ready,
    blocked,
    cycles,
    summary: {
      total_ready: ready.length,
      total_blocked: blocked.length,
      cycle_count: cycles.length,
    },
  };
}
