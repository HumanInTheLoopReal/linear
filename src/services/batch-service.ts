/**
 * `linear batch`.
 *
 * Executes multiple write operations from a small line-oriented grammar
 * in a single CLI invocation. Linear is hosted and exposes no client-side
 * multi-mutation transaction, so operations run *sequentially* and stop
 * at the first failure — no rollback.
 *
 * Grammar (one command per line; `#` lines and blank lines ignored):
 *   close <id> [reason...]
 *   update <id> <key>=<value> [<key>=<value> ...]
 *   create <type> <priority> <title...>          // requires --team
 *   dep add <from-id> <to-id> [type]
 *   dep remove <from-id> <to-id>
 *
 * Supported `update` keys: status, priority, title, assignee.
 * Supported `dep` types: blocks (default), related, duplicate, similar.
 *
 * Notes:
 *  - `create`: `<type>` (task/bug/feature) has no Linear primitive; it is
 *    recorded as a `type:<value>` workspace label when that label already
 *    exists, otherwise ignored. Title and priority always apply.
 *  - `batch-resolver.ts` validates the full script and resolves issue,
 *    user, team, and state references before this GraphQL-only executor
 *    performs the first mutation.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import type {
  BatchOp,
  BatchOpName,
  BatchRelationType,
  ResolvedBatchOp,
} from "../common/batch-script.js";
import { IssueRelationType } from "../gql/graphql.js";
import { createComment } from "./comment-service.js";
import {
  createIssueRelation,
  deleteIssueRelation,
  findIssueRelation,
} from "./issue-relation-service.js";
import { createIssue, updateIssue } from "./issue-service.js";

export type { BatchOp, BatchOpName } from "../common/batch-script.js";
export {
  parseBatchScript,
  parseUpdateKVs,
  tokenizeBatchLine,
} from "../common/batch-script.js";

export interface BatchOpResult {
  line: number;
  op: BatchOpName;
  target?: string;
}

export interface BatchRunResult {
  operations: number;
  status: "ok";
  results: BatchOpResult[];
}

export interface BatchDryRunResult {
  dry_run: true;
  operations: number;
  results: { line: number; raw: string }[];
}

const DEP_TYPE_MAP: Record<BatchRelationType, IssueRelationType> = {
  blocks: IssueRelationType.Blocks,
  related: IssueRelationType.Related,
  duplicate: IssueRelationType.Duplicate,
  similar: IssueRelationType.Similar,
};

export interface RunBatchOpts {
  gql: GraphQLClient;
}

async function runResolvedBatchOp(
  op: ResolvedBatchOp,
  opts: RunBatchOpts,
): Promise<BatchOpResult> {
  switch (op.cmd) {
    case "close":
      if (op.reason) {
        await createComment(opts.gql, {
          issueId: op.issueId,
          body: op.reason,
        });
      }
      await updateIssue(opts.gql, op.issueId, { stateId: op.stateId });
      return { line: op.line, op: op.cmd, target: op.target };
    case "update":
      await updateIssue(opts.gql, op.issueId, op.input);
      return { line: op.line, op: op.cmd, target: op.target };
    case "create": {
      const created = await createIssue(opts.gql, {
        teamId: op.teamId,
        title: op.title,
        priority: op.priority,
        ...(op.labelIds ? { labelIds: op.labelIds } : {}),
      });
      return { line: op.line, op: op.cmd, target: created.identifier };
    }
    case "dep.add":
      await createIssueRelation(opts.gql, {
        issueId: op.fromId,
        relatedIssueId: op.toId,
        type: DEP_TYPE_MAP[op.type],
      });
      return { line: op.line, op: op.cmd, target: op.target };
    case "dep.remove": {
      const relationId = await findIssueRelation(opts.gql, op.fromId, op.toId);
      await deleteIssueRelation(opts.gql, relationId);
      return { line: op.line, op: op.cmd, target: op.target };
    }
  }
}

/**
 * Execute a resolved batch sequentially. Linear is *not* transactional from
 * the client, so a failure on op N leaves ops 1..N-1 committed. The error
 * message identifies the failing source line so the caller can recover.
 */
export async function runBatchOps(
  ops: ResolvedBatchOp[],
  opts: RunBatchOpts,
): Promise<BatchRunResult> {
  const results: BatchOpResult[] = [];
  for (const op of ops) {
    try {
      results.push(await runResolvedBatchOp(op, opts));
    } catch (e) {
      throw new Error(`line ${op.line} (${op.raw}): ${(e as Error).message}`);
    }
  }
  return { operations: results.length, status: "ok", results };
}

export function buildDryRunResult(ops: BatchOp[]): BatchDryRunResult {
  return {
    dry_run: true,
    operations: ops.length,
    results: ops.map((op) => ({ line: op.line, raw: op.raw })),
  };
}
