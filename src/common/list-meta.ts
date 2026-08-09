/**
 * Additive `meta` layer for paginated list JSON envelopes (lin-hsjq —
 * "output-token-economy" audit).
 *
 * The problem: `list` / `search` / `children` emit `{nodes, pageInfo}`,
 * and an agent piping `--json` can't cheaply tell a *complete* result
 * from a *truncated* one without reasoning about `pageInfo` cursors. We
 * surface that (and the scope/limit that produced the page) as a single
 * `meta` block:
 *
 *   {
 *     "nodes": [...],            // unchanged
 *     "pageInfo": {...},         // unchanged
 *     "meta": {
 *       "count": 50,             // nodes on THIS page
 *       "truncated": true,       // more pages exist (pageInfo.hasNextPage)
 *       "limit_applied": 50,     // the --limit that capped this page
 *       "scope": { "team": "ENG", "project": null }
 *     }
 *   }
 *
 * Strictly ADDITIVE: `nodes` and `pageInfo` are untouched, so every
 * existing `jq '.nodes[]'` pipeline keeps working. Text formatters read
 * `.nodes` and ignore `.meta`, so attaching meta needs no formatter
 * changes.
 *
 * Why a sibling and not a wrapper: Linear's GraphQL returns an
 * authoritative `pageInfo.hasNextPage`, so `truncated` is exact — no
 * `limit+1` fetch or second count query to approximate it. The raw-array
 * "view" verbs (`next`, `blocked`) keep their bare-array JSON; their
 * truncation tell stays a stderr hint, a separate concern.
 */

import type { PageInfo, PaginatedResult } from "./types.js";

export interface ListMetaScope {
  team?: string | null;
  project?: string | null;
}

export interface ListMeta {
  /** Number of nodes on this page (`nodes.length`). */
  count: number;
  /** True when more pages exist (mirrors `pageInfo.hasNextPage`). */
  truncated: boolean;
  /** The `--limit` value that capped this page, or null if uncapped. */
  limit_applied: number | null;
  /** Human-facing scope identifiers that produced this page. */
  scope: { team: string | null; project: string | null };
  /**
   * True when agent mode trimmed the defaults for this page (lin-g1hy).
   * Tells an agent the lower page size / compact JSON came from
   * auto-detection so it can opt back in with an explicit `--limit`.
   */
  agent_mode: boolean;
}

export interface PaginatedResultWithMeta<T> extends PaginatedResult<T> {
  meta: ListMeta;
}

/** Build a {@link ListMeta} from a page's primitives. */
export function buildListMeta(opts: {
  count: number;
  pageInfo?: PageInfo | null;
  limit?: number | null;
  scope?: ListMetaScope;
  agentMode?: boolean;
}): ListMeta {
  return {
    count: opts.count,
    truncated: Boolean(opts.pageInfo?.hasNextPage),
    limit_applied: opts.limit ?? null,
    scope: {
      team: opts.scope?.team ?? null,
      project: opts.scope?.project ?? null,
    },
    agent_mode: Boolean(opts.agentMode),
  };
}

/**
 * Attach a {@link ListMeta} sibling to a `{nodes, pageInfo}` result. The
 * returned object spreads the original first, so `nodes`/`pageInfo` are
 * byte-identical and only `meta` is added.
 */
export function withListMeta<T>(
  result: PaginatedResult<T>,
  opts: {
    limit?: number | null;
    scope?: ListMetaScope;
    agentMode?: boolean;
  } = {},
): PaginatedResultWithMeta<T> {
  return {
    ...result,
    meta: buildListMeta({
      count: result.nodes.length,
      pageInfo: result.pageInfo,
      limit: opts.limit,
      scope: opts.scope,
      agentMode: opts.agentMode,
    }),
  };
}
