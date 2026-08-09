import type { GraphQLClient } from "../client/graphql-client.js";
import { NON_CLOSED_STATE_TYPES } from "../common/issue-lifecycle.js";
import {
  GetIssueGraphNodeDocument,
  type GetIssueGraphNodeQuery,
  GetOpenIssuesForGraphDocument,
  type GetOpenIssuesForGraphQuery,
  type GraphNodeFieldsFragment,
  type IssueFilter,
} from "../gql/graphql.js";

const DEFAULT_MAX_DEPTH = 5;

export type GraphEdgeType = "blocks" | "related" | "duplicate" | "similar";

export interface GraphIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  status: string; // state.type
  state_name: string;
  team: { id: string; key: string; name: string };
}

/**
 * Directed edge normalized so `depends_on_id` is the prerequisite (upstream,
 * "blocker") and `issue_id` is the dependent (downstream, "blocked").
 * Layering puts depends_on at a lower layer than issue_id.
 */
export interface GraphEdge {
  issue_id: string;
  depends_on_id: string;
  type: GraphEdgeType;
}

export interface GraphSubgraph {
  root: GraphIssue | null;
  issues: GraphIssue[];
  dependencies: GraphEdge[];
}

export interface GraphLayoutNode {
  layer: number;
  position: number;
  depends_on: string[];
}

export interface GraphLayout {
  nodes: Record<string, GraphLayoutNode>;
  layers: string[][];
  max_layer: number;
  root_id: string | null;
}

function toGraphIssue(node: GraphNodeFieldsFragment): GraphIssue {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    priority: node.priority,
    status: node.state.type,
    state_name: node.state.name,
    team: { id: node.team.id, key: node.team.key, name: node.team.name },
  };
}

function normalizeEdgeType(type: string): GraphEdgeType {
  switch (type) {
    case "blocks":
      return "blocks";
    case "duplicate":
      return "duplicate";
    case "similar":
      return "similar";
    default:
      return "related";
  }
}

/**
 * BFS-expand a subgraph from the given root UUID. Each fetched node yields
 * both forward (this blocks others) and inverse (others block this) edges.
 *
 * Linear stores forward edges on the BLOCKER: `relations[X][Blocks].relatedIssue`
 * means "X blocks relatedIssue". Inverse edges are on the BLOCKED: `inverseRelations[Y][Blocks].issue`
 * means "issue blocks Y". We normalize both to `(issue_id=blocked, depends_on_id=blocker)`.
 */
export async function loadGraphSubgraph(
  client: GraphQLClient,
  rootIssueId: string,
  options: { maxDepth?: number } = {},
): Promise<GraphSubgraph> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const visited = new Map<string, GraphIssue>();
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: rootIssueId, depth: 0 },
  ];
  let root: GraphIssue | null = null;

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const { id, depth } = item;
    if (visited.has(id)) continue;

    const result: GetIssueGraphNodeQuery = await client.request(
      GetIssueGraphNodeDocument,
      { id },
    );
    if (!result.issue) continue;
    const summary = toGraphIssue(result.issue);
    visited.set(id, summary);
    if (!root) root = summary;

    for (const r of result.issue.relations.nodes) {
      if (!r.relatedIssue) continue;
      const key = `${r.relatedIssue.id}<-${id}:${r.type}`;
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        edges.push({
          issue_id: r.relatedIssue.id,
          depends_on_id: id,
          type: normalizeEdgeType(r.type),
        });
      }
      if (depth < maxDepth) {
        queue.push({ id: r.relatedIssue.id, depth: depth + 1 });
      }
    }

    for (const r of result.issue.inverseRelations.nodes) {
      if (!r.issue) continue;
      const key = `${id}<-${r.issue.id}:${r.type}`;
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        edges.push({
          issue_id: id,
          depends_on_id: r.issue.id,
          type: normalizeEdgeType(r.type),
        });
      }
      if (depth < maxDepth) {
        queue.push({ id: r.issue.id, depth: depth + 1 });
      }
    }
  }

  const issues = Array.from(visited.values());
  const idSet = new Set(visited.keys());
  const pruned = edges.filter(
    (e) => idSet.has(e.issue_id) && idSet.has(e.depends_on_id),
  );
  return { root, issues, dependencies: pruned };
}

/**
 * Scan all non-terminal issues in (optionally) one team and split them into connected
 * components by relation adjacency. Returns one GraphSubgraph per component,
 * sorted by size (largest first). Root of each component is the lowest-priority
 * issue, with lex-smallest identifier as tiebreak.
 */
export async function loadAllOpenSubgraphs(
  client: GraphQLClient,
  options: { teamId?: string } = {},
): Promise<GraphSubgraph[]> {
  const filter: IssueFilter = {
    state: { type: { in: [...NON_CLOSED_STATE_TYPES] } },
  };
  if (options.teamId) {
    filter.team = { id: { eq: options.teamId } };
  }

  const fetched: GraphNodeFieldsFragment[] = [];
  let after: string | undefined;
  do {
    const result: GetOpenIssuesForGraphQuery = await client.request(
      GetOpenIssuesForGraphDocument,
      { filter, first: 250, after },
    );
    fetched.push(...result.issues.nodes);
    after = result.issues.pageInfo.hasNextPage
      ? (result.issues.pageInfo.endCursor ?? undefined)
      : undefined;
  } while (after);

  const issueById = new Map<string, GraphIssue>();
  for (const node of fetched) {
    issueById.set(node.id, toGraphIssue(node));
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const node of fetched) {
    for (const r of node.relations.nodes) {
      if (!r.relatedIssue) continue;
      if (!issueById.has(r.relatedIssue.id)) continue;
      const key = `${r.relatedIssue.id}<-${node.id}:${r.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        issue_id: r.relatedIssue.id,
        depends_on_id: node.id,
        type: normalizeEdgeType(r.type),
      });
    }
  }

  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.issue_id)) adj.set(e.issue_id, new Set());
    if (!adj.has(e.depends_on_id)) adj.set(e.depends_on_id, new Set());
    adj.get(e.issue_id)?.add(e.depends_on_id);
    adj.get(e.depends_on_id)?.add(e.issue_id);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const id of issueById.keys()) {
    if (visited.has(id)) continue;
    const comp: string[] = [];
    const q: string[] = [id];
    visited.add(id);
    while (q.length > 0) {
      const cur = q.shift();
      if (!cur) break;
      comp.push(cur);
      const nbrs = adj.get(cur);
      if (nbrs) {
        for (const n of nbrs) {
          if (!visited.has(n)) {
            visited.add(n);
            q.push(n);
          }
        }
      }
    }
    components.push(comp);
  }

  components.sort((a, b) => b.length - a.length);

  return components.map((comp) => {
    const compSet = new Set(comp);
    const compIssues = comp.map((id) => {
      const issue = issueById.get(id);
      if (!issue) throw new Error(`unreachable: missing issue ${id}`);
      return issue;
    });
    const sortedForRoot = [...compIssues].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.identifier.localeCompare(b.identifier);
    });
    const root = sortedForRoot[0] ?? null;
    const compEdges = edges.filter(
      (e) => compSet.has(e.issue_id) && compSet.has(e.depends_on_id),
    );
    return { root, issues: compIssues, dependencies: compEdges };
  });
}

/**
 * Longest-path layering on `blocks` edges only. Returns layers keyed by
 * `identifier` (not UUID) for human-readable JSON output. Issues with no
 * blocking dependency go to layer 0; cycles/unassigned nodes fall back to 0.
 */
export function computeLayout(subgraph: GraphSubgraph): GraphLayout {
  const dependsOn = new Map<string, string[]>();
  for (const e of subgraph.dependencies) {
    if (e.type !== "blocks") continue;
    const list = dependsOn.get(e.issue_id) ?? [];
    list.push(e.depends_on_id);
    dependsOn.set(e.issue_id, list);
  }

  const layer = new Map<string, number>();
  for (const issue of subgraph.issues) layer.set(issue.id, -1);

  let changed = true;
  while (changed) {
    changed = false;
    for (const issue of subgraph.issues) {
      if ((layer.get(issue.id) ?? -1) >= 0) continue;
      const deps = dependsOn.get(issue.id) ?? [];
      if (deps.length === 0) {
        layer.set(issue.id, 0);
        changed = true;
        continue;
      }
      let max = -1;
      let allAssigned = true;
      for (const depId of deps) {
        const l = layer.get(depId);
        if (l === undefined || l < 0) {
          allAssigned = false;
          break;
        }
        if (l > max) max = l;
      }
      if (allAssigned) {
        layer.set(issue.id, max + 1);
        changed = true;
      }
    }
  }
  for (const [id, l] of layer.entries()) {
    if (l < 0) layer.set(id, 0);
  }

  let maxLayer = 0;
  for (const l of layer.values()) {
    if (l > maxLayer) maxLayer = l;
  }

  const idToIdentifier = new Map<string, string>();
  for (const issue of subgraph.issues) {
    idToIdentifier.set(issue.id, issue.identifier);
  }

  const layerBucketsById: string[][] = Array.from(
    { length: maxLayer + 1 },
    () => [],
  );
  for (const [id, l] of layer.entries()) {
    layerBucketsById[l].push(id);
  }
  for (const bucket of layerBucketsById) {
    bucket.sort((a, b) =>
      (idToIdentifier.get(a) ?? a).localeCompare(idToIdentifier.get(b) ?? b),
    );
  }

  const nodes: Record<string, GraphLayoutNode> = {};
  for (const issue of subgraph.issues) {
    const lvl = layer.get(issue.id) ?? 0;
    const pos = layerBucketsById[lvl].indexOf(issue.id);
    nodes[issue.identifier] = {
      layer: lvl,
      position: pos,
      depends_on: (dependsOn.get(issue.id) ?? []).map(
        (id) => idToIdentifier.get(id) ?? id,
      ),
    };
  }

  const layers = layerBucketsById.map((bucket) =>
    bucket.map((id) => idToIdentifier.get(id) ?? id),
  );

  return {
    nodes,
    layers,
    max_layer: maxLayer,
    root_id: subgraph.root?.identifier ?? null,
  };
}

/**
 * Pre-write cycle check for `blocks` edges. Returns true if creating a new
 * "blocker → blocked" Linear relation would close a dependency cycle.
 *
 * Linear has no server-side DAG invariant, so this is a best-effort,
 * client-side check. We walk the existing `blocks` graph from `blockerId`
 * following `depends_on` edges (toward prerequisites). If `blockedId` is
 * reachable from `blockerId`, then `blocked → blocker` would close a cycle.
 *
 * Self-edges (blocker == blocked) are always rejected.
 *
 * NOTE: race-condition vulnerable — a concurrent edge create after this
 * check but before the mutation lands can still produce a cycle. The
 * `depends cycles` scan is the read-time fallback.
 */
export async function wouldCreateBlockingCycle(
  client: GraphQLClient,
  blockerId: string,
  blockedId: string,
): Promise<boolean> {
  if (blockerId === blockedId) return true;
  const subgraph = await loadGraphSubgraph(client, blockerId);
  const adj = new Map<string, string[]>();
  for (const e of subgraph.dependencies) {
    if (e.type !== "blocks") continue;
    const list = adj.get(e.issue_id) ?? [];
    list.push(e.depends_on_id);
    adj.set(e.issue_id, list);
  }
  const visited = new Set<string>();
  const stack: string[] = [blockerId];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    if (cur === blockedId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const n of adj.get(cur) ?? []) stack.push(n);
  }
  return false;
}

/**
 * DFS cycle detection over `blocks` edges only. Returns each detected cycle
 * as an ordered list of identifiers. The walk follows `depends_on` (toward
 * prerequisites): if you hit a node already on the stack, the slice from
 * first visit to current is a cycle.
 */
export function detectCycles(subgraphs: GraphSubgraph[]): string[][] {
  const cycles: string[][] = [];
  for (const sg of subgraphs) {
    const adj = new Map<string, string[]>();
    for (const e of sg.dependencies) {
      if (e.type !== "blocks") continue;
      const list = adj.get(e.issue_id) ?? [];
      list.push(e.depends_on_id);
      adj.set(e.issue_id, list);
    }
    const idToIdentifier = new Map<string, string>();
    for (const issue of sg.issues) {
      idToIdentifier.set(issue.id, issue.identifier);
    }

    const visited = new Set<string>();
    const onStack = new Set<string>();
    const stack: string[] = [];

    const dfs = (id: string): void => {
      visited.add(id);
      onStack.add(id);
      stack.push(id);
      for (const n of adj.get(id) ?? []) {
        if (onStack.has(n)) {
          const idx = stack.indexOf(n);
          if (idx >= 0) {
            cycles.push(
              stack.slice(idx).map((c) => idToIdentifier.get(c) ?? c),
            );
          }
        } else if (!visited.has(n)) {
          dfs(n);
        }
      }
      onStack.delete(id);
      stack.pop();
    };

    for (const issue of sg.issues) {
      if (!visited.has(issue.id)) dfs(issue.id);
    }
  }
  return cycles;
}

/**
 * Like `detectCycles` but enriches each identifier with its full `GraphIssue`
 * record from the source subgraph. Used by `linear depends cycles` to emit
 * an issue payload per cycle.
 */
export function detectCyclesWithIssues(
  subgraphs: GraphSubgraph[],
): GraphIssue[][] {
  const issueByIdentifier = new Map<string, GraphIssue>();
  for (const sg of subgraphs) {
    for (const issue of sg.issues) {
      issueByIdentifier.set(issue.identifier, issue);
    }
  }
  return detectCycles(subgraphs).map((cycle) =>
    cycle.map((ident) => {
      const issue = issueByIdentifier.get(ident);
      if (issue) return issue;
      // Unreachable: detectCycles never emits an identifier outside the
      // input subgraphs. The synthetic fallback satisfies the type and
      // keeps the call infallible.
      return {
        id: ident,
        identifier: ident,
        title: "",
        priority: 0,
        status: "",
        state_name: "",
        team: { id: "", key: "", name: "" },
      };
    }),
  );
}

/**
 * Render a subgraph as Graphviz DOT. Pipe to `dot -Tsvg`. Only `blocks` edges
 * appear in the rendered DAG; other relation types are ignored for the
 * visualization since they don't represent execution order.
 */
export function renderDot(
  layout: GraphLayout,
  subgraph: GraphSubgraph,
): string {
  if (subgraph.issues.length === 0) return "digraph linear { }";

  const lines: string[] = [];
  lines.push("digraph linear {");
  lines.push("  rankdir=LR;");
  lines.push(
    `  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=11];`,
  );
  lines.push(`  edge [color="#666666"];`);
  lines.push("");

  const fillByStatus = (status: string): { fill: string; font: string } => {
    switch (status) {
      case "started":
        return { fill: "#fff3cd", font: "#664d03" };
      case "completed":
        return { fill: "#d4edda", font: "#888888" };
      case "canceled":
        return { fill: "#f8d7da", font: "#842029" };
      case "triage":
      case "backlog":
      case "unstarted":
        return { fill: "#e8f4fd", font: "#1a1a1a" };
      default:
        return { fill: "#e2e3e5", font: "#41464b" };
    }
  };

  const byIdentifier = new Map<string, GraphIssue>();
  for (const issue of subgraph.issues)
    byIdentifier.set(issue.identifier, issue);

  for (let i = 0; i < layout.layers.length; i++) {
    lines.push(`  subgraph cluster_layer_${i} {`);
    lines.push("    style=invis;");
    lines.push("    rank=same;");
    for (const identifier of layout.layers[i]) {
      const issue = byIdentifier.get(identifier);
      if (!issue) continue;
      const { fill, font } = fillByStatus(issue.status);
      const safeTitle = issue.title
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, " ")
        .slice(0, 40);
      const label = `${issue.identifier}\\nP${issue.priority} | ${safeTitle}`;
      lines.push(
        `    "${issue.identifier}" [label="${label}", fillcolor="${fill}", fontcolor="${font}"];`,
      );
    }
    lines.push("  }");
  }
  lines.push("");

  const idToIdentifier = new Map<string, string>();
  for (const issue of subgraph.issues) {
    idToIdentifier.set(issue.id, issue.identifier);
  }
  for (const edge of subgraph.dependencies) {
    if (edge.type !== "blocks") continue;
    const blocker = idToIdentifier.get(edge.depends_on_id);
    const blocked = idToIdentifier.get(edge.issue_id);
    if (!blocker || !blocked) continue;
    lines.push(`  "${blocker}" -> "${blocked}";`);
  }
  lines.push("}");
  return lines.join("\n");
}
