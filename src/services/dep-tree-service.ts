/**
 * Tree walker for `linear depends tree`. Emits a flat record shape:
 * each node points at its parent_id with the edge type that connected
 * them, plus a `depth` and `truncated` flag.
 *
 * Linear has no server-side tree query, so this is a client-side
 * BFS that fetches each visited node via `GetIssueGraphNode` and
 * follows edges in the requested direction:
 *
 *   - down: "what blocks me / what's under me" — follow
 *           inverseRelations[blocks] (for `blocks` edges) and the
 *           children connection (for `parent` edges).
 *   - up:   "what I block / what's above me" — follow
 *           relations[blocks] forward and the `parent` field.
 *   - both: union of the two above (returns a graph, not a tree;
 *           each node still records its discovery parent).
 *
 * `--edges` controls which edge classes are traversed:
 *   - `blocks` (default): only `blocks`-type issue relations.
 *   - `parent`: only parent-child edges (children downward, parent upward).
 *   - `all`: both `blocks` and parent-child edges.
 *
 * When `--edges=blocks` and the root issue is a parent (has children),
 * the root's children are walked once as well. This is the
 * "epic reachability" case: an epic with no direct blockers but many
 * children should still expose the children's blocker chains so the
 * tree reflects the work it actually represents.
 *
 * The optional --status filter drops nodes whose Linear state.type
 * does not match (post-fetch); their subtrees are NOT followed.
 *
 * Diamond-dependency dedup: by default a node is visited once,
 * with the first-found parent recorded. `--show-all-paths` records
 * every (node, parent) discovery, so the same node may appear
 * multiple times with different parents.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import { stateTypesForLogicalStatus } from "../common/issue-lifecycle.js";
import {
  GetIssueGraphNodeDocument,
  type GetIssueGraphNodeQuery,
} from "../gql/graphql.js";

export type TreeDirection = "down" | "up" | "both";
export type TreeEdges = "blocks" | "parent" | "all";

export interface TreeNode {
  id: string;
  identifier: string;
  parent_id: string | null;
  title: string;
  /** Linear's `state.type` enum (triage/backlog/unstarted/started/...). Used
   * categorically (icons, --status filter). */
  status: string;
  /** Linear's `state.name` — the workspace-specific display name like
   * "Backlog", "In Progress", "Done". Surfaced verbatim in text output. */
  state_name: string;
  priority: number;
  depth: number;
  edge_from_parent: string | null;
  truncated: boolean;
}

export interface DepTreeOptions {
  direction: TreeDirection;
  maxDepth: number;
  status?: string;
  showAllPaths?: boolean;
  edges?: TreeEdges;
}

function matchesStatus(stateType: string, filter: string | undefined): boolean {
  if (!filter) return true;
  const types = stateTypesForLogicalStatus(filter);
  if (!types) return false;
  return types.includes(stateType);
}

export async function loadDependencyTree(
  client: GraphQLClient,
  rootIssueId: string,
  options: DepTreeOptions,
): Promise<TreeNode[]> {
  const edges = options.edges ?? "blocks";
  const followBlocks = edges === "blocks" || edges === "all";
  const followParent = edges === "parent" || edges === "all";

  const results: TreeNode[] = [];
  const visited = new Map<string, TreeNode>();
  const queue: Array<{
    id: string;
    parentId: string | null;
    edgeType: string | null;
    depth: number;
  }> = [{ id: rootIssueId, parentId: null, edgeType: null, depth: 0 }];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;

    const allowAllPaths = options.showAllPaths ?? false;
    if (visited.has(item.id) && !allowAllPaths) continue;

    const res = await client.request<GetIssueGraphNodeQuery>(
      GetIssueGraphNodeDocument,
      { id: item.id },
    );
    if (!res.issue) continue;
    const issue = res.issue;
    if (!matchesStatus(issue.state.type, options.status)) continue;

    const truncated = item.depth >= options.maxDepth;
    const node: TreeNode = {
      id: issue.id,
      identifier: issue.identifier,
      parent_id: item.parentId,
      title: issue.title,
      status: issue.state.type,
      state_name: issue.state.name,
      priority: issue.priority,
      depth: item.depth,
      edge_from_parent: item.edgeType,
      truncated,
    };
    results.push(node);
    if (!allowAllPaths) visited.set(item.id, node);

    if (truncated) continue;

    // Epic reachability: with --edges=blocks, the root epic's children
    // get walked too so the user sees the children's blocker chains
    // rather than an empty tree. Non-root nodes do NOT auto-expand
    // their children under --edges=blocks (would interleave parent +
    // blocks edges, the bug we're fixing).
    const isRoot = item.parentId === null;
    const expandChildrenForEpic =
      edges === "blocks" &&
      isRoot &&
      issue.children.nodes.length > 0 &&
      (options.direction === "down" || options.direction === "both");

    if (options.direction === "down" || options.direction === "both") {
      if (followBlocks) {
        for (const r of issue.inverseRelations.nodes) {
          if (!r.issue) continue;
          if (r.type !== "blocks") continue;
          queue.push({
            id: r.issue.id,
            parentId: issue.id,
            edgeType: r.type,
            depth: item.depth + 1,
          });
        }
      }
      if (followParent || expandChildrenForEpic) {
        for (const child of issue.children.nodes) {
          queue.push({
            id: child.id,
            parentId: issue.id,
            edgeType: "parent-child",
            depth: item.depth + 1,
          });
        }
      }
    }

    if (options.direction === "up" || options.direction === "both") {
      if (followBlocks) {
        for (const r of issue.relations.nodes) {
          if (!r.relatedIssue) continue;
          if (r.type !== "blocks") continue;
          queue.push({
            id: r.relatedIssue.id,
            parentId: issue.id,
            edgeType: r.type,
            depth: item.depth + 1,
          });
        }
      }
      if (followParent && issue.parent) {
        queue.push({
          id: issue.parent.id,
          parentId: issue.id,
          edgeType: "parent-child",
          depth: item.depth + 1,
        });
      }
    }
  }

  return results;
}

export function renderMermaid(tree: TreeNode[]): string {
  const lines = ["flowchart TD"];
  for (const node of tree) {
    const safeId = node.id.replace(/-/g, "_");
    const label = `${node.identifier}: ${node.title.replace(/"/g, "'")}`;
    lines.push(`  ${safeId}["${label}"]`);
  }
  for (const node of tree) {
    if (!node.parent_id) continue;
    const safeParent = node.parent_id.replace(/-/g, "_");
    const safeChild = node.id.replace(/-/g, "_");
    const edge = node.edge_from_parent ?? "related";
    lines.push(`  ${safeParent} -- ${edge} --> ${safeChild}`);
  }
  return lines.join("\n");
}
