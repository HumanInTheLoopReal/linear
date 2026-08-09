/**
 * Issue activity service for `linear issues activity`.
 *
 * Linear keeps the two halves of "what happened to this issue" in separate
 * connections: `comments` (discussion, threaded via `parentId`) and `history`
 * (one event per field change). An agent resuming work wants them as one
 * ordered story, so this merges both into a single newest-first timeline
 * rather than making the caller interleave two paginated lists.
 *
 * Both halves are fetched in full before merging — a cursor into a merged
 * timeline is only meaningful if the whole sequence is known.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import { listComments } from "./comment-service.js";
import { getIssueHistory, type HistoryEvent } from "./history-service.js";

/** Per-request page size for the discussion half, matching `getIssueHistory`. */
const COMMENT_PAGE_SIZE = 100;

/** Walk the comment connection to the end — see the file header on why. */
async function fetchAllComments(
  client: GraphQLClient,
  issueId: string,
): Promise<Awaited<ReturnType<typeof listComments>>["nodes"]> {
  const nodes: Awaited<ReturnType<typeof listComments>>["nodes"] = [];
  const seenCursors = new Set<string>();
  let after: string | undefined;

  while (true) {
    const page = await listComments(client, issueId, {
      limit: COMMENT_PAGE_SIZE,
      after,
    });
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;

    // Both guards fail closed: a partial timeline is worse than no timeline,
    // because the caller cannot tell one from the other.
    const next = page.pageInfo.endCursor;
    if (!next) {
      throw new Error(
        "comment pagination returned no cursor; timeline would be incomplete",
      );
    }
    if (seenCursors.has(next)) {
      throw new Error(
        `comment pagination repeated cursor "${next}"; timeline would be incomplete`,
      );
    }
    seenCursors.add(next);
    after = next;
  }

  return nodes;
}

export interface ActivityActor {
  id?: string | null;
  name?: string | null;
  displayName?: string | null;
}

export interface ActivityEntry {
  kind: "comment" | "event";
  id: string;
  createdAt: string;
  actor: ActivityActor | null;
  /** Comment body; null on history events. */
  body: string | null;
  /** Parent comment id for a reply; null on roots and history events. */
  parentId: string | null;
  /** Field deltas; null on comments. */
  event: HistoryEvent | null;
}

export interface IssueActivityResult {
  issue: { id: string; identifier: string; title: string };
  entries: ActivityEntry[];
  total: number;
}

export interface IssueActivityOptions {
  /** Max entries to return after merging. 0 returns everything. */
  limit?: number;
  /** Entry id to resume after — see the `--after` note in the command help. */
  after?: string;
  /** Drop history events, keeping only the discussion. */
  commentsOnly?: boolean;
}

/** Newest first, matching Linear's native history order. */
function byNewestFirst(a: ActivityEntry, b: ActivityEntry): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

export async function getIssueActivity(
  client: GraphQLClient,
  issueId: string,
  options: IssueActivityOptions = {},
): Promise<IssueActivityResult> {
  const { limit = 0, after, commentsOnly = false } = options;

  // The history call doubles as the source of issue metadata, so it runs even
  // when only comments are wanted — with a 1-event cap to keep it cheap.
  const [history, comments] = await Promise.all([
    getIssueHistory(client, issueId, commentsOnly ? 1 : 0),
    fetchAllComments(client, issueId),
  ]);

  const entries: ActivityEntry[] = comments.map((comment) => ({
    kind: "comment" as const,
    id: comment.id,
    createdAt: comment.createdAt,
    actor: comment.user ?? null,
    body: comment.body,
    parentId: comment.parentId ?? null,
    event: null,
  }));

  if (!commentsOnly) {
    for (const event of history.events) {
      entries.push({
        kind: "event",
        id: event.id,
        createdAt: event.createdAt,
        actor: event.actor,
        body: null,
        parentId: null,
        event,
      });
    }
  }

  entries.sort(byNewestFirst);

  let windowed = entries;
  if (after) {
    const index = windowed.findIndex((entry) => entry.id === after);
    if (index < 0) {
      throw new Error(`Activity cursor "${after}" not found on this issue`);
    }
    windowed = windowed.slice(index + 1);
  }
  if (limit > 0) windowed = windowed.slice(0, limit);

  return {
    issue: history.issue,
    entries: windowed,
    total: windowed.length,
  };
}
