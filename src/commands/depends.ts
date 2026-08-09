import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import {
  handleCommand,
  outputResult,
  outputSuccess,
  resolveOutputMode,
} from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { IssueRelationType } from "../gql/graphql.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import {
  type DanglingEdge,
  findDanglingEdges,
} from "../services/dangling-edge-service.js";
import {
  loadDependencyTree,
  renderMermaid,
  type TreeDirection,
  type TreeEdges,
  type TreeNode,
} from "../services/dep-tree-service.js";
import {
  computeLayout,
  detectCycles,
  detectCyclesWithIssues,
  type GraphIssue,
  loadAllOpenSubgraphs,
  loadGraphSubgraph,
  renderDot,
  wouldCreateBlockingCycle,
} from "../services/dependency-graph-service.js";
import {
  type BulkRelationEdgeInput,
  type BulkRelationError,
  bulkCreateIssueRelations,
  createIssueRelation,
  type DependsListEntry,
  deleteIssueRelation,
  ensureDependencyTypeLabels,
  findIssueRelation,
  listIssueRelations,
} from "../services/issue-relation-service.js";
import { getIssue } from "../services/issue-service.js";
import {
  addLabelToIssues,
  ensureWorkspaceLabel,
} from "../services/label-service.js";
import { priorityCol } from "./_format.js";

export const DEPENDS_META: DomainMeta = {
  name: "depends",
  summary: "directed blocking dependencies between issues (issueRelation)",
  context: [
    "manages issue-to-issue dependency edges via Linear's native issueRelation",
    "primitive. supports the four Linear-native types: blocks, related,",
    "duplicate, similar. parent-child links are NOT issueRelations in Linear",
    "— set them via `linear issues update <id> --parent <parent>`.",
    "",
    "use `add` to create a directed `blocks` edge (default), `relate` to",
    "create an undirected `related` link, and `list` to inspect a single",
    "issue's outbound (down) or inbound (up) edges. `graph` renders the",
    "dependency subgraph (JSON or Graphviz DOT); `graph check` scans for",
    "cycles and exits 1 if any are found.",
  ].join("\n"),
  arguments: {
    issue: "issue identifier (UUID or ABC-123)",
    "depends-on": "blocking issue identifier (UUID or ABC-123)",
  },
  seeAlso: [
    "issues update --parent",
    "issues update --blocks / --blocked-by / --relates-to",
  ],
};

type DependsType =
  | "blocks"
  | "blocked-by"
  | "related"
  | "relates-to"
  | "tracks"
  | "discovered-from"
  | "until"
  | "caused-by"
  | "validates"
  | "supersedes";

const NATIVE_TYPES = new Set<DependsType>([
  "blocks",
  "blocked-by",
  "related",
  "relates-to",
]);

const HACK_TYPES = new Set<DependsType>([
  "tracks",
  "discovered-from",
  "until",
  "caused-by",
  "validates",
  "supersedes",
]);

function hackLabelName(type: DependsType): string {
  return `dep-type:${type}`;
}

function normalizeType(type: string): DependsType {
  const t = type.toLowerCase();
  if (NATIVE_TYPES.has(t as DependsType) || HACK_TYPES.has(t as DependsType)) {
    return t as DependsType;
  }
  throw invalidParameterError(
    "--type",
    `unsupported type "${type}". Native: blocks, blocked-by, related, relates-to. Linear-Hack: tracks, discovered-from, until, caused-by, validates, supersedes. Use \`linear issues update --parent\` for parent-child relationships.`,
  );
}

/**
 * Map (from, to, depends-type) onto the Linear `IssueRelation` write
 * (issueId, relatedIssueId, IssueRelationType). For `blocks`, the blocker
 * is `to` and the blocked is `from`. Hack types (`tracks`, `validates`, …)
 * all materialize as a directed `Related` relation from→to and rely on
 * a `dep-type:<type>` label on the source to carry the semantic.
 */
function relationForType(
  fromUuid: string,
  toUuid: string,
  type: DependsType,
): {
  issueId: string;
  relatedIssueId: string;
  relationType: IssueRelationType;
} {
  if (type === "blocks") {
    return {
      issueId: toUuid,
      relatedIssueId: fromUuid,
      relationType: IssueRelationType.Blocks,
    };
  }
  if (type === "blocked-by") {
    return {
      issueId: fromUuid,
      relatedIssueId: toUuid,
      relationType: IssueRelationType.Blocks,
    };
  }
  return {
    issueId: fromUuid,
    relatedIssueId: toUuid,
    relationType: IssueRelationType.Related,
  };
}

interface ParsedBulkLine {
  line: number;
  from: string;
  to: string;
  type: DependsType;
}

/**
 * Parse a JSONL bulk-dep file (or stdin contents). Each non-empty line is a
 * JSON object: `{from, to, type?}` with aliases `issue_id` / `depends_on_id`.
 * Defaults type to `"blocks"`. Returns successful parses plus per-line
 * errors (invalid JSON, missing field, unsupported type) keyed by line
 * number — best-effort; we never abort the bulk on a single bad line.
 */
function parseBulkDepBody(body: string): {
  edges: ParsedBulkLine[];
  errors: BulkRelationError[];
} {
  const edges: ParsedBulkLine[] = [];
  const errors: BulkRelationError[] = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]?.trim() ?? "";
    if (raw === "") continue;
    const lineNo = i + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      errors.push({
        line: lineNo,
        error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      errors.push({ line: lineNo, error: "expected a JSON object" });
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    const from = String(obj.from ?? obj.issue_id ?? "").trim();
    const to = String(obj.to ?? obj.depends_on_id ?? "").trim();
    if (!from) {
      errors.push({ line: lineNo, error: "missing 'from' (or 'issue_id')" });
      continue;
    }
    if (!to) {
      errors.push({ line: lineNo, error: "missing 'to' (or 'depends_on_id')" });
      continue;
    }
    const rawType =
      typeof obj.type === "string" && obj.type.trim() !== ""
        ? obj.type.trim()
        : "blocks";
    let type: DependsType;
    try {
      type = normalizeType(rawType);
    } catch (err) {
      errors.push({
        line: lineNo,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    edges.push({ line: lineNo, from, to, type });
  }
  return { edges, errors };
}

async function readBulkDepBody(filePath: string): Promise<string> {
  if (filePath === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFileSync(filePath, "utf8");
}

/**
 * Render the `linear depends list` view. Shape:
 *
 *     \n
 *       <id>: <title> [P<n>] (<state-name>) via <edge-type>\n
 *       <id>: <title> [P<n>] (<state-name>) via <edge-type>\n
 *
 * The parens show Linear's actual workflow state name (e.g. "Backlog",
 * "In Progress", "Done") rather than collapsing into the 5-bucket
 * vocabulary — Linear workspaces vary per-team and we surface that.
 *
 * Empty case: `\n<issue-arg> has no dependencies\n`. The argument echoed
 * back is exactly what the user typed (identifier like TES-388 or a UUID).
 */
/**
 * Render one dependency edge row, shared by the single- and multi-issue
 * (lin-zoqs) text views so both stay byte-identical per row.
 */
function renderDepRow(e: DependsListEntry): string {
  const pri = priorityCol(e.priority);
  const priTag = pri ? `[${pri}]` : "[]";
  // Linear's state.name (e.g. "Backlog", "In Progress") — falls back to the
  // raw state.type token if the service didn't populate state_name for some
  // reason (defensive; should never happen for real Linear data).
  const stateLabel = e.state_name || e.status;
  return `  ${e.identifier}: ${e.title} ${priTag} (${stateLabel}) via ${e.type}`;
}

export function formatDepList(
  entries: DependsListEntry[],
  issueArg: string,
): string {
  if (entries.length === 0) {
    return `\n${issueArg} has no dependencies\n`;
  }
  return `${entries.map(renderDepRow).join("\n")}\n\n`;
}

/**
 * Render the multi-issue survey (lin-zoqs). Groups by issue with a
 * `📋 <id> depends on:` header per issue, keeping linear's richer rows
 * (title/priority/state). Empty issues reuse the
 * single-issue "<id> has no dependencies" line so the per-issue message stays
 * consistent. The header phrase tracks --direction: outbound edges read
 * "depends on", inbound (`up`) reads "is depended on by".
 */
export function formatDepListBatch(
  surveys: { issueArg: string; entries: DependsListEntry[] }[],
  direction: "down" | "up" | "both",
): string {
  const phrase = direction === "up" ? "is depended on by" : "depends on";
  const blocks: string[] = [];
  for (const s of surveys) {
    if (s.entries.length === 0) {
      blocks.push(`\n${s.issueArg} has no dependencies\n`);
      continue;
    }
    blocks.push(
      `\n📋 ${s.issueArg} ${phrase}:\n\n${s.entries.map(renderDepRow).join("\n")}\n`,
    );
  }
  return `${blocks.join("")}\n`;
}

/**
 * Render the dep-tree text view. Shape:
 *
 *     \n
 *     🌲 Dependency tree for <root-id>:\n
 *     \n
 *     <root-id>: <title> [P<n>] (<state-name>) \x1b[1m[READY|BLOCKED]\x1b[m\n
 *         ├── <id>: <title> [P<n>] (<state-name>)\n
 *         └── <id>: <title> [P<n>] (<state-name>)\n
 *     \n
 *
 * The root row gets a bold `[READY]` marker when the tree has no descendants
 * (no parents, no blockers), `[BLOCKED]` otherwise. Descendants are indented
 * by `depth * 4` spaces; the `├──` / `└──` connector reflects whether the
 * node is the last sibling at its level. State name comes from Linear's
 * actual `state.name` (e.g. "Backlog", "In Progress").
 */
export function formatDepTree(tree: TreeNode[]): string {
  if (tree.length === 0) {
    // Defensive: loadDependencyTree always returns at least the root, but a
    // status-filter that drops the root yields []. Emit just the header so
    // the caller's "tree for <id>" intent is still readable.
    return "\n🌲 Dependency tree for ?:\n\n\n";
  }

  const root = tree[0];
  if (!root) return "\n🌲 Dependency tree for ?:\n\n\n";

  const descendants = tree.slice(1);

  const pri = priorityCol(root.priority);
  const priTag = pri ? ` [${pri}]` : "";
  const stateLabel = root.state_name || root.status;
  // ANSI bold ([READY]/[BLOCKED]). A root with no descendants in the tree
  // is READY (no blockers, no parent chain to walk); anything else is BLOCKED.
  const marker =
    descendants.length === 0
      ? "\x1b[1m[READY]\x1b[m"
      : "\x1b[1m[BLOCKED]\x1b[m";
  const rootLine = `${root.identifier}: ${root.title}${priTag} (${stateLabel}) ${marker}`;

  // Compute connector + indentation for each non-root node. Group descendants
  // by parent_id so we can detect last-sibling at each level.
  const childrenByParent = new Map<string, TreeNode[]>();
  for (const node of descendants) {
    if (!node.parent_id) continue;
    const list = childrenByParent.get(node.parent_id) ?? [];
    list.push(node);
    childrenByParent.set(node.parent_id, list);
  }

  // Per-node: am I the last sibling under my parent in this rendering?
  const lastSiblingSet = new Set<string>();
  for (const [, siblings] of childrenByParent) {
    const last = siblings[siblings.length - 1];
    if (last) lastSiblingSet.add(last.id);
  }

  // ancestorColumnsById[X] = the column-continuation flags X's CHILDREN
  // should use as indentation before their own connector. One entry per
  // depth level below the root; `true` means draw `│   ` (X is non-last
  // so its sibling chain continues below), `false` means draw `    `.
  // Children consume their parent's entry verbatim as indent prefix.
  const ancestorColumnsById = new Map<string, boolean[]>();
  ancestorColumnsById.set(root.id, []);

  const descendantLines: string[] = [];
  for (const node of descendants) {
    if (!node.parent_id) continue;
    const parentColumns = ancestorColumnsById.get(node.parent_id) ?? [];
    const isLast = lastSiblingSet.has(node.id);
    ancestorColumnsById.set(node.id, [...parentColumns, !isLast]);

    const indent = parentColumns.map((c) => (c ? "│   " : "    ")).join("");
    const connector = isLast ? "└── " : "├── ";
    const nodePri = priorityCol(node.priority);
    const nodePriTag = nodePri ? ` [${nodePri}]` : "";
    const nodeState = node.state_name || node.status;
    // Leading 4 spaces is the `dep tree` indent — distinct from `dep list`
    // which has no leading indent.
    descendantLines.push(
      `    ${indent}${connector}${node.identifier}: ${node.title}${nodePriTag} (${nodeState})`,
    );
  }

  const lines: string[] = [
    "",
    `🌲 Dependency tree for ${root.identifier}:`,
    "",
    rootLine,
    ...descendantLines,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Render `linear depends cycles`. Empty case (clean board):
 *
 *     \n
 *     ✓ No dependency cycles detected\n
 *     \n
 *
 * Non-empty case: header line plus one row per cycle showing the loop as
 * `id-1 → id-2 → … → id-1`. Each cycle's row is bracketed with the cycle
 * size so callers can tell single-edge cycles (A → A) from longer chains.
 */
export function formatDepCycles(cycles: GraphIssue[][]): string {
  if (cycles.length === 0) {
    return "\n✓ No dependency cycles detected\n\n";
  }
  const lines: string[] = [""];
  lines.push(`🔁 Dependency cycles detected (${cycles.length}):`);
  lines.push("");
  for (const cycle of cycles) {
    if (cycle.length === 0) continue;
    const ids = cycle.map((i) => i.identifier);
    // Close the loop visually by repeating the first identifier — matches
    // how dependency cycles are usually depicted in tooling.
    const loop = [...ids, ids[0]].join(" → ");
    lines.push(`  [${cycle.length}] ${loop}`);
  }
  return `${lines.join("\n")}\n\n`;
}

/**
 * Render `linear depends dangling` output (lin-wb60). One row per broken
 * relation, grouped by source issue. The direction tag tells operators
 * whether the missing side was downstream (forward) or upstream (inverse)
 * of the source — useful when deciding whether to delete the residual
 * relation or recreate the lost issue.
 */
export function formatDanglingEdges(payload: {
  dangling_edges: number;
  edges: DanglingEdge[];
}): string {
  if (payload.dangling_edges === 0) {
    return "\n✓ No dangling dependency edges found\n\n";
  }
  const lines: string[] = [""];
  lines.push(
    `⚠ Dangling dependency edges (${payload.dangling_edges}) — relation target missing:`,
  );
  lines.push("");
  for (const e of payload.edges) {
    lines.push(
      `  ${e.source_identifier} "${e.source_title}"  [${e.relation_type}, ${e.direction}]  relation=${e.relation_id}`,
    );
  }
  return `${lines.join("\n")}\n\n`;
}

interface DepEdgeEchoShape {
  status: string;
  type?: string;
  dep_type_label?: string;
}

/**
 * Render the success line for `linear depends add`. The arrow / verb must
 * match the actual edge semantics:
 *   - blocks (default): `<depends-on>` is the blocker (Linear stores it as
 *     issueId blocks relatedIssueId). Render `<dependsOn> blocks <issue>`.
 *   - blocked-by: positions reverse — `<issue>` is the blocker. Render
 *     `<issue> blocks <dependsOn>`.
 *   - related / relates-to: undirected. Render with `↔`.
 *   - hack types (tracks, supersedes, …): directional from issue→dependsOn.
 *     Render `<issue> -> <dependsOn> [<type>]`.
 * Round-1 UX friction confirmed by 4/4 agents: the old `A -> B [blocks]`
 * message inverted the edge an agent that trusted output would record.
 */
export function formatDepAdded(
  payload: DepEdgeEchoShape,
  issue: string,
  dependsOn: string,
): string {
  const type = payload.type ?? "blocks";
  if (type === "blocks") {
    return `✓ Added: ${dependsOn} blocks ${issue}`;
  }
  if (type === "blocked-by") {
    return `✓ Added: ${issue} blocks ${dependsOn}`;
  }
  if (type === "related" || type === "relates-to") {
    return `✓ Added: ${issue} ↔ ${dependsOn} [${type}]`;
  }
  return `✓ Added: ${issue} -> ${dependsOn} [${type}]`;
}

export function formatDepRemoved(
  _payload: { status: string },
  issue: string,
  dependsOn: string,
): string {
  return `✓ Removed dependency between ${issue} and ${dependsOn}`;
}

interface BulkDepResultShape {
  count: number;
  dependencies: Array<{ line: number; type: string }>;
  errors: Array<{ line: number; error: string }>;
}

interface GraphSubgraphShape {
  root: { identifier: string; title: string } | null;
  issues: Array<{ identifier: string }>;
  dependencies: Array<{
    issue_id: string;
    depends_on_id: string;
    type: string;
  }>;
  layout: { layers: string[][]; max_layer: number };
}

function renderSubgraph(subgraph: GraphSubgraphShape): string[] {
  const lines: string[] = [];
  const rootLabel = subgraph.root
    ? `${subgraph.root.identifier}: ${subgraph.root.title}`
    : "(no root)";
  lines.push(`🕸 ${rootLabel}`);
  lines.push(
    `   Issues: ${subgraph.issues.length} · Edges: ${subgraph.dependencies.length} · Layers: ${subgraph.layout.max_layer + 1}`,
  );
  for (let i = 0; i < subgraph.layout.layers.length; i += 1) {
    const ids = subgraph.layout.layers[i];
    if (!ids || ids.length === 0) continue;
    // Layer arrays hold UUIDs; translate to identifiers via the issues list.
    const idToIdent = new Map(
      subgraph.issues.map((iss) => [
        (iss as { id?: string }).id ?? "",
        iss.identifier,
      ]),
    );
    const labels = ids.map((id) => idToIdent.get(id) ?? id);
    lines.push(`   Layer ${i}: ${labels.join(", ")}`);
  }
  return lines;
}

export function formatDepGraph(subgraph: GraphSubgraphShape): string {
  return renderSubgraph(subgraph).join("\n");
}

interface DepGraphAllShape {
  subgraphs: GraphSubgraphShape[];
  count: number;
}

export function formatDepGraphAll(payload: DepGraphAllShape): string {
  if (payload.count === 0) {
    return "✓ No open issues with dependencies";
  }
  const lines: string[] = [`🕸 ${payload.count} connected component(s):`, ""];
  for (const sg of payload.subgraphs) {
    lines.push(...renderSubgraph(sg));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

interface DepCheckShape {
  clean: boolean;
  cycles: string[][];
  summary?: { cycle_count?: number };
}

export function formatDepCheck(payload: DepCheckShape): string {
  if (payload.clean) {
    return "✓ No dependency cycles detected";
  }
  const count = payload.summary?.cycle_count ?? payload.cycles.length;
  const lines: string[] = [`✗ ${count} dependency cycle(s) detected:`, ""];
  for (const cycle of payload.cycles) {
    if (cycle.length === 0) continue;
    const loop = [...cycle, cycle[0]].join(" → ");
    lines.push(`  [${cycle.length}] ${loop}`);
  }
  return lines.join("\n");
}

export function formatDepRelated(
  _payload: { status: string },
  a: string,
  b: string,
): string {
  return `✓ Related ${a} ↔ ${b}`;
}

export function formatDepUnrelated(
  _payload: { status: string },
  a: string,
  b: string,
): string {
  return `✓ Unrelated ${a} ↔ ${b}`;
}

export function formatDepBulk(result: BulkDepResultShape): string {
  const lines: string[] = [];
  lines.push(`✓ Added ${result.count} dependency edge(s)`);
  for (const dep of result.dependencies) {
    lines.push(`  ✓ line ${dep.line} [${dep.type}]`);
  }
  for (const err of result.errors) {
    lines.push(`  ✗ line ${err.line}: ${err.error}`);
  }
  return lines.join("\n");
}

export function setupDependsCommands(program: Command): void {
  const depends = program
    .command("depends")
    .description(
      "manage issue dependency edges (blocks, related) via issueRelation",
    );

  depends.action(() => depends.help());

  depends
    .command("add [issue] [depends-on]")
    .description(
      "create a `blocks` edge (or read N edges via --file <path|->); default direction: <depends-on> blocks <issue>",
    )
    .option(
      "-t, --type <type>",
      "edge type: native (blocks, blocked-by, related, relates-to) or Linear-Hack (tracks, discovered-from, until, caused-by, validates, supersedes)",
      "blocks",
    )
    .option(
      "--blocker <id>",
      "the issue that blocks (must be paired with --blocked; unambiguous alternative to positional args)",
    )
    .option(
      "--blocked <id>",
      "the issue that is blocked (must be paired with --blocker)",
    )
    .option(
      "--file <path>",
      "JSONL bulk input ({from,to,type?}); use '-' for stdin",
    )
    .addHelpText(
      "after",
      `\nExamples:\n  # positional form — <depends-on> blocks <issue>\n  linear depends add ENG-123 ENG-100        # ENG-100 blocks ENG-123\n\n  # named-flag form — direction is explicit\n  linear depends add --blocker ENG-100 --blocked ENG-123\n\n  # other edge types\n  linear depends add ENG-1 ENG-2 --type related\n  linear depends add ENG-1 ENG-2 --type supersedes\n`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issueArg, dependsOnArg, options, command] = args as [
          string | undefined,
          string | undefined,
          {
            type: string;
            file?: string;
            blocker?: string;
            blocked?: string;
          },
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        // Named-flag form (--blocker / --blocked) maps to the positional
        // pair so the rest of the action stays single-path. The pair must
        // be provided together — a half-set flag is an obvious user error
        // we want to call out.
        const hasBlocker = options.blocker !== undefined;
        const hasBlocked = options.blocked !== undefined;
        if (hasBlocker !== hasBlocked) {
          throw invalidParameterError(
            hasBlocker ? "--blocked" : "--blocker",
            "--blocker and --blocked must be used together",
          );
        }
        if (hasBlocker && (issueArg || dependsOnArg)) {
          throw invalidParameterError(
            "--blocker/--blocked",
            "--blocker/--blocked cannot be combined with positional <issue>/<depends-on>",
          );
        }
        // Positional `<issue> <depends-on>` means dependsOn blocks issue
        // (i.e. dependsOn is the blocker). Map --blocker → dependsOn,
        // --blocked → issue so the named form produces an identical edge.
        const issue = hasBlocker ? options.blocked : issueArg;
        const dependsOn = hasBlocker ? options.blocker : dependsOnArg;

        if (options.file) {
          if (issue || dependsOn) {
            throw invalidParameterError(
              "--file",
              "--file cannot be combined with positional <issue>/<depends-on>",
            );
          }
          const body = await readBulkDepBody(options.file);
          const { edges: parsed, errors: parseErrors } = parseBulkDepBody(body);

          const hackLabelIds = await ensureDependencyTypeLabels(
            ctx.gql,
            parsed.filter((e) => HACK_TYPES.has(e.type)).map((e) => e.type),
          );

          const resolvedEdges: BulkRelationEdgeInput[] = [];
          const carriedErrors: BulkRelationError[] = [...parseErrors];
          await Promise.all(
            parsed.map(async (edge) => {
              try {
                const [fromUuid, toUuid] = await Promise.all([
                  resolveIssueId(ctx.sdk, edge.from),
                  resolveIssueId(ctx.sdk, edge.to),
                ]);
                const { issueId, relatedIssueId, relationType } =
                  relationForType(fromUuid, toUuid, edge.type);
                resolvedEdges.push({
                  line: edge.line,
                  issueId,
                  relatedIssueId,
                  type: relationType,
                  rawType: edge.type,
                  issueLabel: edge.from,
                  relatedLabel: edge.to,
                  ...(HACK_TYPES.has(edge.type)
                    ? { hackLabelId: hackLabelIds.get(edge.type) }
                    : {}),
                });
              } catch (err) {
                carriedErrors.push({
                  line: edge.line,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }),
          );
          resolvedEdges.sort((a, b) => a.line - b.line);
          const result = await bulkCreateIssueRelations(
            ctx.gql,
            resolvedEdges,
            carriedErrors,
          );
          outputResult(result, formatDepBulk, getRootOpts(command));
          return;
        }

        if (!issue || !dependsOn) {
          throw invalidParameterError(
            "<issue> <depends-on>",
            "provide positional <issue> <depends-on>, or --blocker <id> --blocked <id>, or --file <path>",
          );
        }
        const type = normalizeType(options.type);

        const [issueId, dependsOnId] = await Promise.all([
          resolveIssueId(ctx.sdk, issue),
          resolveIssueId(ctx.sdk, dependsOn),
        ]);

        const {
          issueId: blockerId,
          relatedIssueId: blockedId,
          relationType,
        } = relationForType(issueId, dependsOnId, type);

        if (
          relationType === IssueRelationType.Blocks &&
          (await wouldCreateBlockingCycle(ctx.gql, blockerId, blockedId))
        ) {
          throw new Error("adding dependency would create a cycle");
        }

        const relation = await createIssueRelation(ctx.gql, {
          issueId: blockerId,
          relatedIssueId: blockedId,
          type: relationType,
        });

        let hackLabel: string | undefined;
        if (HACK_TYPES.has(type)) {
          const labelName = hackLabelName(type);
          const labelId = await ensureWorkspaceLabel(
            ctx.gql,
            labelName,
            `Linear-Hack: encodes dep-type '${type}'.`,
          );
          await addLabelToIssues(ctx.gql, [issueId], labelId, labelName);
          hackLabel = labelName;
        }

        // Enrich the confirmation with each endpoint's canonical identifier +
        // title (lin-8yl1.5 — show `id (title)` for both sides instead of
        // only the raw args). The mutation now returns both endpoints with
        // titles, so this costs no extra round-trip. Match by UUID to stay
        // agnostic to the per-type blocker/blocked direction.
        const endpointInfo = new Map<
          string,
          { identifier: string; title: string }
        >();
        for (const e of [relation.issue, relation.relatedIssue]) {
          if (e) {
            endpointInfo.set(e.id, {
              identifier: e.identifier,
              title: e.title,
            });
          }
        }
        const issueInfo = endpointInfo.get(issueId);
        const dependsOnInfo = endpointInfo.get(dependsOnId);
        const issueDisplay = issueInfo
          ? `${issueInfo.identifier} (${issueInfo.title})`
          : issue;
        const dependsOnDisplay = dependsOnInfo
          ? `${dependsOnInfo.identifier} (${dependsOnInfo.title})`
          : dependsOn;

        outputResult(
          {
            status: "added",
            relation_id: relation.id,
            issue_id: issueId,
            issue_identifier: issueInfo?.identifier,
            issue_title: issueInfo?.title,
            depends_on_id: dependsOnId,
            depends_on_identifier: dependsOnInfo?.identifier,
            depends_on_title: dependsOnInfo?.title,
            type,
            ...(hackLabel ? { dep_type_label: hackLabel } : {}),
          },
          (data) => formatDepAdded(data, issueDisplay, dependsOnDisplay),
          getRootOpts(command),
        );
      }),
    );

  depends
    .command("remove <issue> <depends-on>")
    .alias("rm")
    .description(
      "delete the dependency edge between two issues (either direction)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, dependsOn, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const [issueId, dependsOnId] = await Promise.all([
          resolveIssueId(ctx.sdk, issue),
          resolveIssueId(ctx.sdk, dependsOn),
        ]);

        const relationId = await findIssueRelation(
          ctx.gql,
          issueId,
          dependsOnId,
        );
        await deleteIssueRelation(ctx.gql, relationId);

        outputResult(
          {
            status: "removed",
            issue_id: issueId,
            depends_on_id: dependsOnId,
          },
          (data) => formatDepRemoved(data, issue, dependsOn),
          getRootOpts(command),
        );
      }),
    );

  depends
    .command("list <issues...>")
    .description(
      "list dependency edges for one or more issues (--direction down=outbound, up=inbound, both)",
    )
    .option(
      "--direction <dir>",
      "down (outbound), up (inbound), or both",
      "down",
    )
    .option("-t, --type <type>", "filter results by edge type")
    .addHelpText(
      "after",
      `\nMultiple issue ids survey edges for each (lin-zoqs). With --json the
output is a flat array of edges across all requested issues (the stable
single-issue shape: explicit relation edges only, no synthetic parent-child
entry). In batch mode (>1 id) an unresolvable id is skipped with a stderr
warning instead of aborting the whole survey.

In text mode (default), the output includes a synthetic \`via parent-child\`
row when an issue has a parent; multiple issues are grouped under a header
per issue.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issues, options, command] = args as [
          string[],
          { direction: string; type?: string },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const direction = options.direction.toLowerCase();
        if (
          direction !== "down" &&
          direction !== "up" &&
          direction !== "both"
        ) {
          throw invalidParameterError(
            "--direction",
            `must be one of: down, up, both (got "${options.direction}")`,
          );
        }

        const batchMode = issues.length > 1;
        // Text-only synthetic parent-child row: only when direction/--type
        // would naturally include it (down + no type, or explicit parent-child).
        const includeParent =
          (direction === "down" || direction === "both") &&
          (options.type === undefined || options.type === "parent-child");

        const jsonMode = resolveOutputMode(rootOpts);

        // Survey each issue. Edges are gathered per-issue; JSON flattens them
        // into one array (stable single-issue shape), text groups by issue.
        const surveys: { issueArg: string; entries: DependsListEntry[] }[] = [];
        for (const issueArg of issues) {
          let issueId: string;
          try {
            issueId = await resolveIssueId(ctx.sdk, issueArg);
          } catch (err) {
            // Batch mode: skip a bad id with a warning rather than aborting
            // the whole survey. Single-id keeps the fatal path.
            if (batchMode) {
              process.stderr.write(
                `warning: resolving ${issueArg}: ${(err as Error).message} (skipped)\n`,
              );
              continue;
            }
            throw err;
          }

          const edges = await listIssueRelations(ctx.gql, issueId, {
            direction: direction as "down" | "up" | "both",
            type: options.type,
          });

          // JSON keeps explicit edges only (no synthetic parent row).
          const entries: DependsListEntry[] = jsonMode ? [...edges] : [];
          if (!jsonMode && includeParent) {
            const issueDetail = await getIssue(ctx.gql, issueId);
            if (issueDetail.parent) {
              entries.push({
                relation_id: "synthetic-parent",
                type: "parent-child",
                direction: "down",
                issue_id: "",
                identifier: issueDetail.parent.identifier,
                title: issueDetail.parent.title,
                priority: issueDetail.parent.priority,
                status: issueDetail.parent.state.type,
                state_name: issueDetail.parent.state.name,
              });
            }
          }
          if (!jsonMode) entries.push(...edges);

          surveys.push({ issueArg, entries });
        }

        if (jsonMode) {
          // Flat array of edges across all surveyed issues (lin-zoqs).
          outputSuccess(
            surveys.flatMap((s) => s.entries),
            jsonMode,
            rootOpts.fields,
          );
          return;
        }

        // Single issue: byte-identical to the legacy single-id output.
        if (!batchMode) {
          const only = surveys[0];
          outputResult(
            only ?? { issueArg: issues[0], entries: [] },
            (d) => formatDepList(d.entries, d.issueArg),
            rootOpts,
          );
          return;
        }

        // Batch: group each issue under its own header block (lin-zoqs).
        outputResult(
          { surveys },
          (d) =>
            formatDepListBatch(d.surveys, direction as "down" | "up" | "both"),
          rootOpts,
        );
      }),
    );

  depends
    .command("dangling")
    .description(
      "find dependency relations whose target issue is missing (deleted)",
    )
    .option(
      "--team <team>",
      "restrict the scan to one team (key, name, or UUID)",
    )
    .addHelpText(
      "after",
      `\nLinear cascade-deletes parent/child edges when an issue is removed,
but other IssueRelation types (blocks, related, duplicate, similar)
can be left pointing at a deleted issue. This verb scans open issues
and surfaces those broken relations so hygiene tools can clean them
up (e.g. via 'linear depends remove'). Exits 1 when any dangling edges
are found so it composes with shell pipelines / CI checks. (lin-wb60)
`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [{ team?: string }, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;
        const edges = await findDanglingEdges(ctx.gql, { teamId });
        outputResult(
          { dangling_edges: edges.length, edges },
          formatDanglingEdges,
          rootOpts,
        );
        if (edges.length > 0) process.exit(1);
      }),
    );

  depends
    .command("cycles")
    .description("detect dependency cycles across the workspace")
    .option(
      "--team <team>",
      "restrict the scan to one team (key, name, or UUID)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [{ team?: string }, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;
        const subgraphs = await loadAllOpenSubgraphs(ctx.gql, { teamId });
        const cycles = detectCyclesWithIssues(subgraphs);
        outputResult(cycles, formatDepCycles, rootOpts);
      }),
    );

  depends
    .command("relate <issue-a> <issue-b>")
    .description("create a bidirectional `related` link between two issues")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [a, b, , command] = args as [string, string, unknown, Command];
        const ctx = createContext(getRootOpts(command));

        const [aId, bId] = await Promise.all([
          resolveIssueId(ctx.sdk, a),
          resolveIssueId(ctx.sdk, b),
        ]);

        const relation = await createIssueRelation(ctx.gql, {
          issueId: aId,
          relatedIssueId: bId,
          type: IssueRelationType.Related,
        });

        outputResult(
          {
            status: "related",
            relation_id: relation.id,
            issue_a_id: aId,
            issue_b_id: bId,
          },
          (data) => formatDepRelated(data, a, b),
          getRootOpts(command),
        );
      }),
    );

  depends
    .command("unrelate <issue-a> <issue-b>")
    .description("remove a `related` link between two issues")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [a, b, , command] = args as [string, string, unknown, Command];
        const ctx = createContext(getRootOpts(command));

        const [aId, bId] = await Promise.all([
          resolveIssueId(ctx.sdk, a),
          resolveIssueId(ctx.sdk, b),
        ]);

        const relationId = await findIssueRelation(ctx.gql, aId, bId);
        await deleteIssueRelation(ctx.gql, relationId);

        outputResult(
          {
            status: "unrelated",
            issue_a_id: aId,
            issue_b_id: bId,
          },
          (data) => formatDepUnrelated(data, a, b),
          getRootOpts(command),
        );
      }),
    );

  const graph = depends
    .command("graph [issue]")
    .description(
      "visualize an issue's dependency subgraph (or all non-terminal issues with --all)",
    )
    .option(
      "--all",
      "scan all non-terminal issues and group by connected component (mutually exclusive with [issue])",
      false,
    )
    .option(
      "--team <team>",
      "with --all, restrict to one team (key, name, or UUID)",
    )
    .option(
      "--max-depth <n>",
      "BFS expansion depth from the root (single-issue mode only)",
      "5",
    )
    .option(
      "--dot",
      "emit Graphviz DOT (raw text, not JSON; pipe to `dot -Tsvg`)",
      false,
    )
    .addHelpText(
      "after",
      `\nThe default output is JSON with {root, issues, dependencies, layout}.
Layering uses longest-path on \`blocks\` edges only — \`related\` /
\`duplicate\` / \`similar\` edges appear in \`dependencies\` but do not
influence layer placement. --dot is a documented text-output exception
(like \`linear prime\`) so the result can be piped to graphviz.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string | undefined,
          { all: boolean; team?: string; maxDepth: string; dot: boolean },
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        if (options.all && issue) {
          throw invalidParameterError(
            "issue",
            "cannot specify an issue identifier with --all",
          );
        }
        if (!options.all && !issue) {
          throw invalidParameterError(
            "issue",
            "issue identifier required (or use --all)",
          );
        }

        if (options.all) {
          const teamKey = options.team ?? getDefaultTeam() ?? undefined;
          const teamId = teamKey
            ? await resolveTeamId(ctx.sdk, teamKey)
            : undefined;
          const subgraphs = await loadAllOpenSubgraphs(ctx.gql, { teamId });
          if (options.dot) {
            // ARCHITECTURAL EXCEPTION: DOT is raw text, not JSON. Mirrors the
            // text-output exception used by `linear prime`. Multiple components
            // get separate digraphs separated by blank lines.
            const out = subgraphs
              .map((sg) => renderDot(computeLayout(sg), sg))
              .join("\n\n");
            process.stdout.write(`${out}\n`);
            return;
          }
          const result = subgraphs.map((sg) => ({
            root: sg.root,
            issues: sg.issues,
            dependencies: sg.dependencies,
            layout: computeLayout(sg),
          }));
          outputResult(
            { subgraphs: result, count: result.length },
            formatDepGraphAll,
            getRootOpts(command),
          );
          return;
        }

        const rootIssue = issue as string;
        const maxDepth = Number.parseInt(options.maxDepth, 10);
        if (!Number.isFinite(maxDepth) || maxDepth < 0) {
          throw invalidParameterError(
            "--max-depth",
            `must be a non-negative integer (got "${options.maxDepth}")`,
          );
        }

        const issueId = await resolveIssueId(ctx.sdk, rootIssue);
        const subgraph = await loadGraphSubgraph(ctx.gql, issueId, {
          maxDepth,
        });
        const layout = computeLayout(subgraph);

        if (options.dot) {
          // ARCHITECTURAL EXCEPTION: see above.
          process.stdout.write(`${renderDot(layout, subgraph)}\n`);
          return;
        }
        outputResult(
          {
            root: subgraph.root,
            issues: subgraph.issues,
            dependencies: subgraph.dependencies,
            layout,
          },
          formatDepGraph,
          getRootOpts(command),
        );
      }),
    );

  graph
    .command("check")
    .description(
      "scan all non-terminal issues for dependency cycles; exits 1 if cycles found",
    )
    .option(
      "--team <team>",
      "restrict the scan to one team (key, name, or UUID)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [{ team?: string }, Command];
        const ctx = createContext(getRootOpts(command));
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;
        const subgraphs = await loadAllOpenSubgraphs(ctx.gql, { teamId });
        const cycles = detectCycles(subgraphs);
        const clean = cycles.length === 0;
        outputResult(
          {
            clean,
            cycles,
            summary: { cycle_count: cycles.length },
          },
          formatDepCheck,
          getRootOpts(command),
        );
        if (!clean) process.exit(1);
      }),
    );

  depends
    .command("tree <issue>")
    .description("show the transitive dependency tree rooted at an issue")
    .option(
      "--direction <dir>",
      "tree direction: 'down' (what blocks this), 'up' (what this blocks), 'both'",
      "down",
    )
    .option(
      "--edges <edges>",
      "edge classes to follow: 'blocks' (default), 'parent', or 'all'",
      "blocks",
    )
    .option("-d, --max-depth <n>", "maximum tree depth to expand", "50")
    .option(
      "--status <status>",
      "filter to nodes matching this status: open, in_progress, closed",
    )
    .option(
      "--show-all-paths",
      "do not deduplicate diamond-dependency nodes; emit each path",
      false,
    )
    .option(
      "--format <format>",
      "output format: 'json' (default) or 'mermaid' (Mermaid.js flowchart, raw text)",
    )
    .option("--reverse", "deprecated alias for --direction=up", false)
    .addHelpText(
      "after",
      `\nClient-side BFS over Linear's relations / inverseRelations and the
parent / children edges, gated by --edges. The default text output
renders a familiar tree view (\`🌲 Dependency tree for <id>:\` header
+ ANSI [READY]/[BLOCKED] marker on the root). The --json envelope
returns a flat array of {id, identifier, parent_id, title, status,
state_name, priority, depth, edge_from_parent, truncated}.

--edges=blocks (default) follows only \`blocks\` relations. As an
epic-reachability convenience, when the root issue has children
(i.e. is a parent / epic), its children are walked once too so the
tree exposes the children's blocker chains instead of an empty body.
--edges=parent follows only parent-child edges (children downward,
parent upward). --edges=all follows both.

--format mermaid is a documented text-output exception (raw stdout,
not JSON), similar to 'depends graph --dot'.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          {
            direction: string;
            edges: string;
            maxDepth: string;
            status?: string;
            showAllPaths: boolean;
            format?: string;
            reverse: boolean;
          },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        let direction = options.direction as TreeDirection;
        if (options.reverse) direction = "up";
        if (
          direction !== "down" &&
          direction !== "up" &&
          direction !== "both"
        ) {
          throw invalidParameterError(
            "--direction",
            `must be one of: down, up, both (got '${options.direction}')`,
          );
        }
        const edges = options.edges as TreeEdges;
        if (edges !== "blocks" && edges !== "parent" && edges !== "all") {
          throw invalidParameterError(
            "--edges",
            `must be one of: blocks, parent, all (got '${options.edges}')`,
          );
        }
        const maxDepth = Number.parseInt(options.maxDepth, 10);
        if (!Number.isFinite(maxDepth) || maxDepth < 0) {
          throw invalidParameterError(
            "--max-depth",
            `must be a non-negative integer (got '${options.maxDepth}')`,
          );
        }
        if (
          options.format !== undefined &&
          options.format !== "json" &&
          options.format !== "mermaid"
        ) {
          throw invalidParameterError(
            "--format",
            `must be 'json' or 'mermaid' (got '${options.format}')`,
          );
        }

        const issueId = await resolveIssueId(ctx.sdk, issue);
        const tree = await loadDependencyTree(ctx.gql, issueId, {
          direction,
          edges,
          maxDepth,
          status: options.status,
          showAllPaths: options.showAllPaths,
        });

        if (options.format === "mermaid") {
          // ARCHITECTURAL EXCEPTION: Mermaid is raw text, not JSON.
          // Mirrors 'depends graph --dot'. See file-level comment.
          process.stdout.write(`${renderMermaid(tree)}\n`);
          return;
        }
        outputResult(tree, formatDepTree, rootOpts);
      }),
    );

  depends
    .command("usage")
    .description("show detailed usage for depends")
    .action(() => {
      console.log(formatDomainUsage(depends, DEPENDS_META));
    });
}
