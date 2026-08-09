import type { GraphQLClient } from "../client/graphql-client.js";
import { notFoundError } from "../common/errors.js";
import { isClosedStateType } from "../common/issue-lifecycle.js";
import type { CreatedIssueRelation } from "../common/types.js";
import {
  CreateIssueRelationDocument,
  type CreateIssueRelationMutation,
  DeleteIssueRelationDocument,
  type DeleteIssueRelationMutation,
  GetIssueRelationsDocument,
  type GetIssueRelationsQuery,
  IssueRelationType,
  ListIssueRelationsDocument,
  type ListIssueRelationsQuery,
} from "../gql/graphql.js";
import { wouldCreateBlockingCycle } from "./dependency-graph-service.js";
import { addLabelToIssues, ensureWorkspaceLabel } from "./label-service.js";

export interface DependsListEntry {
  relation_id: string;
  type: string;
  direction: "down" | "up";
  issue_id: string;
  identifier: string;
  title: string;
  priority: number;
  status: string;
  state_name: string;
}

export interface NewlyUnblockedIssue {
  identifier: string;
  title: string;
  priority: number;
}

/** Ensure the metadata labels used to encode non-native dependency types. */
export async function ensureDependencyTypeLabels(
  client: GraphQLClient,
  types: string[],
): Promise<Map<string, string>> {
  const distinct = Array.from(new Set(types));
  const entries = await Promise.all(
    distinct.map(async (type) => {
      const id = await ensureWorkspaceLabel(
        client,
        `dep-type:${type}`,
        `Linear-Hack: encodes dep-type '${type}'.`,
      );
      return [type, id] as const;
    }),
  );
  return new Map(entries);
}

export async function createIssueRelation(
  client: GraphQLClient,
  input: {
    issueId: string;
    relatedIssueId: string;
    type: IssueRelationType;
  },
): Promise<CreatedIssueRelation> {
  const result = await client.request<CreateIssueRelationMutation>(
    CreateIssueRelationDocument,
    { input },
  );
  if (!result.issueRelationCreate.success) {
    throw new Error("Failed to create issue relation");
  }
  return result.issueRelationCreate.issueRelation;
}

export interface BulkRelationEdgeInput {
  line: number;
  issueId: string;
  relatedIssueId: string;
  type: IssueRelationType;
  rawType: string;
  issueLabel: string;
  relatedLabel: string;
  /**
   * If set, after the relation mutation succeeds the loop adds this label
   * to the source (`issueId`) issue. Used by the Linear-Hack `dep-type:*`
   * convention to carry extended dep types (`tracks`, `validates`, …)
   * that Linear's native relation set can't express.
   */
  hackLabelId?: string;
}

export interface BulkRelationSuccess {
  line: number;
  issue_id: string;
  depends_on_id: string;
  type: string;
}

export interface BulkRelationError {
  line: number;
  error: string;
}

export interface BulkRelationResult {
  status: "added";
  count: number;
  dependencies: BulkRelationSuccess[];
  errors: BulkRelationError[];
}

/**
 * Sequentially create N issue relations, one mutation per edge. Linear has
 * no transactional bulk write, so partial failure is reported per-edge:
 * `count` and `dependencies` carry the successes; `errors` carries the
 * line-attributed failures. Callers prefilter and resolve UUIDs first;
 * this function only owns the write loop.
 */
export async function bulkCreateIssueRelations(
  client: GraphQLClient,
  edges: BulkRelationEdgeInput[],
  carriedErrors: BulkRelationError[] = [],
): Promise<BulkRelationResult> {
  const dependencies: BulkRelationSuccess[] = [];
  const errors: BulkRelationError[] = [...carriedErrors];

  for (const edge of edges) {
    try {
      if (
        edge.type === IssueRelationType.Blocks &&
        (await wouldCreateBlockingCycle(
          client,
          edge.issueId,
          edge.relatedIssueId,
        ))
      ) {
        throw new Error("adding dependency would create a cycle");
      }
      await createIssueRelation(client, {
        issueId: edge.issueId,
        relatedIssueId: edge.relatedIssueId,
        type: edge.type,
      });
      if (edge.hackLabelId) {
        await addLabelToIssues(
          client,
          [edge.issueId],
          edge.hackLabelId,
          `dep-type:${edge.rawType}`,
        );
      }
      dependencies.push({
        line: edge.line,
        issue_id: edge.issueId,
        depends_on_id: edge.relatedIssueId,
        type: edge.rawType,
      });
    } catch (err) {
      errors.push({
        line: edge.line,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  errors.sort((a, b) => a.line - b.line);
  return {
    status: "added",
    count: dependencies.length,
    dependencies,
    errors,
  };
}

export async function findIssueRelation(
  client: GraphQLClient,
  issueId: string,
  relatedIssueId: string,
): Promise<string> {
  const result = await client.request<GetIssueRelationsQuery>(
    GetIssueRelationsDocument,
    { issueId },
  );

  if (!result.issue) {
    throw notFoundError("Issue", issueId);
  }

  const forwardMatch = result.issue.relations.nodes.find(
    (r) => r.relatedIssue.id === relatedIssueId,
  );
  if (forwardMatch) return forwardMatch.id;

  const inverseMatch = result.issue.inverseRelations.nodes.find(
    (r) => r.issue.id === relatedIssueId,
  );
  if (inverseMatch) return inverseMatch.id;

  throw notFoundError("Relation", `between ${issueId} and ${relatedIssueId}`);
}

export async function deleteIssueRelation(
  client: GraphQLClient,
  relationId: string,
): Promise<{ id: string; success: boolean }> {
  const result = await client.request<DeleteIssueRelationMutation>(
    DeleteIssueRelationDocument,
    { id: relationId },
  );
  if (!result.issueRelationDelete.success) {
    throw new Error("Failed to delete issue relation");
  }
  return { id: result.issueRelationDelete.entityId, success: true };
}

export async function listIssueRelations(
  client: GraphQLClient,
  issueId: string,
  options: { direction?: "down" | "up" | "both"; type?: string } = {},
): Promise<DependsListEntry[]> {
  const direction = options.direction ?? "down";
  const result = await client.request<ListIssueRelationsQuery>(
    ListIssueRelationsDocument,
    { issueId },
  );
  if (!result.issue) {
    throw notFoundError("Issue", issueId);
  }

  // Direction semantics:
  //   direction=down → "what this issue depends on" (blockers OF this issue)
  //   direction=up   → "what depends on this issue" (things this issue blocks)
  //
  // Linear stores `issueRelationCreate({issueId: A, relatedIssueId: B, type: Blocks})`
  // as "A blocks B", with the forward edge on A's `relations` and the
  // inverse edge on B's `inverseRelations`. So for issue X:
  //   inverseRelations = edges where someone-else.blocks(X) → X's blockers → down
  //   relations        = edges where X.blocks(other)       → X's dependents → up
  // (For `related` and other symmetric types the directionality is informational only.)
  const out: DependsListEntry[] = [];
  if (direction === "down" || direction === "both") {
    for (const r of result.issue.inverseRelations.nodes) {
      if (options.type && r.type !== options.type) continue;
      out.push({
        relation_id: r.id,
        type: r.type,
        direction: "down",
        issue_id: r.issue.id,
        identifier: r.issue.identifier,
        title: r.issue.title,
        priority: r.issue.priority,
        status: r.issue.state.type,
        state_name: r.issue.state.name,
      });
    }
  }
  if (direction === "up" || direction === "both") {
    for (const r of result.issue.relations.nodes) {
      if (options.type && r.type !== options.type) continue;
      out.push({
        relation_id: r.id,
        type: r.type,
        direction: "up",
        issue_id: r.relatedIssue.id,
        identifier: r.relatedIssue.identifier,
        title: r.relatedIssue.title,
        priority: r.relatedIssue.priority,
        status: r.relatedIssue.state.type,
        state_name: r.relatedIssue.state.name,
      });
    }
  }
  return out;
}

/**
 * Return the direct dependents for which closing `closedIssueId` removed the
 * final non-terminal blocker.
 */
export async function findNewlyUnblockedByClose(
  client: GraphQLClient,
  closedIssueId: string,
): Promise<NewlyUnblockedIssue[]> {
  const dependents = await listIssueRelations(client, closedIssueId, {
    direction: "up",
    type: IssueRelationType.Blocks,
  });
  const freed: NewlyUnblockedIssue[] = [];
  for (const dependent of dependents) {
    if (isClosedStateType(dependent.status)) continue;
    const blockers = await listIssueRelations(client, dependent.issue_id, {
      direction: "down",
      type: IssueRelationType.Blocks,
    });
    if (blockers.some((blocker) => !isClosedStateType(blocker.status))) {
      continue;
    }
    freed.push({
      identifier: dependent.identifier,
      title: dependent.title,
      priority: dependent.priority,
    });
  }
  return freed;
}
