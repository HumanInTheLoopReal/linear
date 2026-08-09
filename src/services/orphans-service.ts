import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GraphQLClient } from "../client/graphql-client.js";
import { NON_CLOSED_STATE_TYPES } from "../common/issue-lifecycle.js";
import {
  type CompleteIssueFieldsFragment,
  FilteredSearchIssuesDocument,
  type FilteredSearchIssuesQuery,
  type IssueFilter,
} from "../gql/graphql.js";
import { updateIssue } from "./issue-service.js";

const execFileAsync = promisify(execFile);

// Linear identifiers in commit messages: `ABC-123` or `(ABC-123)`. We match
// the bare form (the parenthesised form is a subset) anywhere on a line.
const LINEAR_ID_PATTERN = /\b[A-Z][A-Z0-9]*-\d+\b/g;

export interface OrphanIssue {
  issue_id: string;
  identifier: string;
  title: string;
  status: string;
  team_id: string;
  latest_commit?: string;
  latest_commit_message?: string;
}

export interface FindOrphansOptions {
  repoPath?: string;
  limit?: number;
  labelIds?: string[];
  labelIdsAny?: string[];
}

/**
 * Scan a git repository for Linear issue identifiers and intersect those
 * references against the workspace's currently-open issues. An orphan is
 * any issue mentioned in a commit message that has not yet transitioned
 * to a terminal workflow state.
 *
 * `labelIds` (AND: every listed id must be attached) and `labelIdsAny`
 * (OR: at least one) are applied client-side to keep the GraphQL filter
 * small — Linear's `every: { id: { in: [...] } }` does not express the
 * "must have all of these" semantic.
 */
export async function findOrphanedIssues(
  client: GraphQLClient,
  options: FindOrphansOptions = {},
): Promise<OrphanIssue[]> {
  const repoPath = options.repoPath ?? ".";

  // 1. Check we're in a git repo. If not, return [].
  try {
    await execFileAsync("git", ["-C", repoPath, "rev-parse", "--git-dir"]);
  } catch {
    return [];
  }

  // 2. Fetch open issues.
  const fragments: IssueFilter[] = [
    { state: { type: { in: [...NON_CLOSED_STATE_TYPES] } } },
  ];
  const limit = options.limit ?? 250;
  const result = await client.request<FilteredSearchIssuesQuery>(
    FilteredSearchIssuesDocument,
    { first: limit, filter: { and: fragments } },
  );

  let openIssues: CompleteIssueFieldsFragment[] = result.issues.nodes;

  // 3. Client-side label filters.
  if (options.labelIds && options.labelIds.length > 0) {
    const required = new Set(options.labelIds);
    openIssues = openIssues.filter((issue) => {
      const attached = new Set(issue.labels?.nodes?.map((l) => l.id) ?? []);
      for (const id of required) if (!attached.has(id)) return false;
      return true;
    });
  }
  if (options.labelIdsAny && options.labelIdsAny.length > 0) {
    const allowed = new Set(options.labelIdsAny);
    openIssues = openIssues.filter((issue) => {
      const attached = issue.labels?.nodes?.map((l) => l.id) ?? [];
      return attached.some((id) => allowed.has(id));
    });
  }

  if (openIssues.length === 0) return [];

  const byIdentifier = new Map<string, OrphanIssue>();
  for (const issue of openIssues) {
    byIdentifier.set(issue.identifier, {
      issue_id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      status: issue.state.name,
      team_id: issue.team.id,
    });
  }

  // 4. Scan git log. `--all` ensures orphan detection is not limited to
  // the current branch's history.
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repoPath, "log", "--oneline", "--all"],
    { maxBuffer: 64 * 1024 * 1024 },
  );

  const orphans: OrphanIssue[] = [];
  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    const spaceIdx = line.indexOf(" ");
    const commitHash = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
    const commitMsg = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1);

    LINEAR_ID_PATTERN.lastIndex = 0;
    const matches = line.match(LINEAR_ID_PATTERN);
    if (!matches) continue;

    for (const id of matches) {
      const orphan = byIdentifier.get(id);
      if (!orphan) continue;
      if (orphan.latest_commit) continue; // only the most-recent commit counts
      orphan.latest_commit = commitHash;
      orphan.latest_commit_message = commitMsg;
    }
  }

  for (const orphan of byIdentifier.values()) {
    if (orphan.latest_commit) orphans.push(orphan);
  }

  // Stable identifier sort so callers see deterministic output.
  return orphans.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/**
 * Close an orphan by setting its workflow state to the team's `completed`
 * type. Each team is resolved on demand; callers pass `teamStateCache` if
 * they want to amortise the lookup across a batch.
 */
export async function closeOrphan(
  gql: GraphQLClient,
  orphan: OrphanIssue,
  completedStateId: string,
): Promise<void> {
  await updateIssue(gql, orphan.issue_id, { stateId: completedStateId });
}
