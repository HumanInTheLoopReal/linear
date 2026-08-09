import type { GraphQLClient } from "../client/graphql-client.js";
import {
  isClosedStateType,
  lifecycleStatusFromStateType,
} from "../common/issue-lifecycle.js";
import {
  FindSwarmsByLabelDocument,
  type FindSwarmsByLabelQuery,
  GetIssueForSwarmDocument,
  type GetIssueForSwarmQuery,
  IssueRelationType,
  type SwarmCandidateFieldsFragment,
  type SwarmIssueFieldsFragment,
} from "../gql/graphql.js";
import { createIssueRelation } from "./issue-relation-service.js";
import { createIssue, updateIssue } from "./issue-service.js";
import { ensureWorkspaceLabel } from "./label-service.js";

export const SWARM_LABEL_NAME = "swarm";
const SWARM_LABEL_DESCRIPTION = "Coordinates parallel agent work on an epic.";

export interface SwarmIssueNode {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: number;
  depends_on: string[]; // identifiers within the epic
  depended_on_by: string[]; // identifiers within the epic
  wave: number;
}

export interface ReadyFront {
  wave: number;
  issues: string[]; // identifiers
  titles: string[];
}

export interface SwarmAnalysis {
  epic_id: string;
  epic_identifier: string;
  epic_title: string;
  total_issues: number;
  closed_issues: number;
  ready_fronts: ReadyFront[];
  max_parallelism: number;
  estimated_sessions: number;
  warnings: string[];
  errors: string[];
  swarmable: boolean;
  issues?: Record<string, SwarmIssueNode>;
}

export interface SwarmMolecule {
  id: string;
  identifier: string;
  title: string;
  description: string;
  epic_id: string;
  epic_identifier: string;
  coordinator: string;
}

/**
 * Load the issue used to create a swarm and normalize it to an epic. A source
 * issue with no children is wrapped in a new epic, then re-fetched so callers
 * always receive the complete epic projection used by the rest of the swarm
 * service.
 */
export async function prepareSwarmEpic(
  client: GraphQLClient,
  issueId: string,
  displayRef = issueId,
): Promise<SwarmIssueFieldsFragment> {
  const sourceResult = await client.request<GetIssueForSwarmQuery>(
    GetIssueForSwarmDocument,
    { id: issueId },
  );
  if (!sourceResult.issue) {
    throw new Error(`issue '${displayRef}' not found`);
  }

  if (sourceResult.issue.children.nodes.length > 0) {
    return sourceResult.issue;
  }

  const wrapper = await wrapIssueAsEpic(client, sourceResult.issue);
  const refetched = await client.request<GetIssueForSwarmQuery>(
    GetIssueForSwarmDocument,
    { id: wrapper.id },
  );
  if (!refetched.issue) {
    throw new Error(`wrapper epic '${wrapper.id}' not found after creation`);
  }
  return refetched.issue;
}

/**
 * Run a Kahn's-algorithm wave decomposition over the epic's children + their
 * blocks-relations. Children outside the epic are ignored for layering (with
 * a warning); cycles are reported as errors and short-circuit wave compute.
 *
 * The structural-warning heuristics (foundation/setup, integration/final)
 * are language-agnostic title scans.
 */
export async function analyzeEpicForSwarm(
  client: GraphQLClient,
  epicId: string,
): Promise<SwarmAnalysis> {
  const result = await client.request<GetIssueForSwarmQuery>(
    GetIssueForSwarmDocument,
    { id: epicId },
  );
  if (!result.issue) throw new Error(`epic '${epicId}' not found`);
  const epic = result.issue;

  const analysis: SwarmAnalysis = {
    epic_id: epic.id,
    epic_identifier: epic.identifier,
    epic_title: epic.title,
    total_issues: 0,
    closed_issues: 0,
    ready_fronts: [],
    max_parallelism: 0,
    estimated_sessions: 0,
    warnings: [],
    errors: [],
    swarmable: true,
    issues: {},
  };

  const children = epic.children.nodes;
  if (children.length === 0) {
    analysis.warnings.push("Epic has no children");
    return analysis;
  }
  analysis.total_issues = children.length;

  // Build node map and the in-epic blocks-graph. We key the graph by UUID
  // internally and surface identifiers (ENG-7) in the JSON payload.
  const childIdSet = new Set(children.map((c) => c.id));
  const idToIdentifier = new Map<string, string>();
  for (const child of children) {
    idToIdentifier.set(child.id, child.identifier);
    analysis.issues![child.id] = {
      id: child.id,
      identifier: child.identifier,
      title: child.title,
      status: child.state.type,
      priority: child.priority,
      depends_on: [],
      depended_on_by: [],
      wave: -1,
    };
    if (isClosedStateType(child.state.type)) analysis.closed_issues++;
  }

  // Linear stores a forward `blocks` edge on the BLOCKER (relations[X][Blocks]
  // means X blocks relatedIssue). For Kahn's we need depends_on, so we flip:
  // when child X has a forward relation [Blocks → Y], Y depends_on X.
  for (const child of children) {
    for (const r of child.relations.nodes) {
      if (r.type !== "blocks" || !r.relatedIssue) continue;
      const target = r.relatedIssue;
      if (childIdSet.has(target.id)) {
        const targetNode = analysis.issues![target.id];
        const sourceNode = analysis.issues![child.id];
        if (targetNode && sourceNode) {
          targetNode.depends_on.push(child.identifier);
          sourceNode.depended_on_by.push(target.identifier);
        }
      } else if (target.id !== epic.id) {
        analysis.warnings.push(
          `${child.identifier} blocks ${target.identifier} (outside epic)`,
        );
      }
    }
  }

  detectStructuralIssues(analysis);
  if (analysis.errors.length === 0) {
    computeReadyFronts(analysis);
  }
  analysis.swarmable = analysis.errors.length === 0;
  return analysis;
}

function detectStructuralIssues(analysis: SwarmAnalysis): void {
  const issues = analysis.issues ?? {};
  const nodes = Object.values(issues);

  // Foundation-like roots that nothing depends on → suspicious.
  // Integration/final/test leaves with no prerequisites → also suspicious.
  for (const node of nodes) {
    const lower = node.title.toLowerCase();
    if (
      node.depended_on_by.length === 0 &&
      (lower.includes("foundation") ||
        lower.includes("setup") ||
        lower.includes("base") ||
        lower.includes("core"))
    ) {
      analysis.warnings.push(
        `${node.identifier} (${node.title}) has no dependents - should other issues depend on it?`,
      );
    }
    if (
      node.depends_on.length === 0 &&
      (lower.includes("integration") ||
        lower.includes("final") ||
        lower.includes("test"))
    ) {
      analysis.warnings.push(
        `${node.identifier} (${node.title}) has no dependencies - should it depend on implementation?`,
      );
    }
  }

  // Reachability from roots (issues with no depends_on) via depended_on_by.
  const roots = nodes.filter((n) => n.depends_on.length === 0);
  const visited = new Set<string>();
  // Map identifier -> id for reverse lookup.
  const idByIdentifier = new Map<string, string>();
  for (const [uuid, node] of Object.entries(issues)) {
    idByIdentifier.set(node.identifier, uuid);
  }
  const dfs = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const n = issues[id];
    if (!n) return;
    for (const childIdent of n.depended_on_by) {
      const childUuid = idByIdentifier.get(childIdent);
      if (childUuid) dfs(childUuid);
    }
  };
  for (const root of roots) dfs(root.id);
  const disconnected = nodes
    .filter((n) => !visited.has(n.id))
    .map((n) => n.identifier);
  if (disconnected.length > 0) {
    analysis.warnings.push(
      `Disconnected issues (not reachable from roots): [${disconnected.join(
        ", ",
      )}]`,
    );
  }

  // Cycle detection over depends_on edges.
  const inProgress = new Set<string>();
  const completed = new Set<string>();
  const path: string[] = [];
  const foundCycle: { identifiers: string[] | null } = { identifiers: null };
  const detectCycle = (id: string): boolean => {
    if (completed.has(id)) return false;
    if (inProgress.has(id)) {
      const idx = path.indexOf(id);
      foundCycle.identifiers = path
        .slice(idx >= 0 ? idx : 0)
        .map((p) => issues[p]?.identifier ?? p);
      return true;
    }
    inProgress.add(id);
    path.push(id);
    const n = issues[id];
    if (n) {
      for (const depIdent of n.depends_on) {
        const depUuid = idByIdentifier.get(depIdent);
        if (depUuid && detectCycle(depUuid)) return true;
      }
    }
    path.pop();
    inProgress.delete(id);
    completed.add(id);
    return false;
  };
  for (const id of Object.keys(issues)) {
    if (!completed.has(id) && detectCycle(id)) break;
  }
  if (foundCycle.identifiers) {
    analysis.errors.push(
      `Dependency cycle detected involving: [${foundCycle.identifiers.join(", ")}]`,
    );
  }
}

function computeReadyFronts(analysis: SwarmAnalysis): void {
  const issues = analysis.issues ?? {};
  const idByIdentifier = new Map<string, string>();
  for (const [uuid, n] of Object.entries(issues)) {
    idByIdentifier.set(n.identifier, uuid);
  }
  const inDegree = new Map<string, number>();
  for (const [id, node] of Object.entries(issues)) {
    inDegree.set(id, node.depends_on.length);
  }

  let currentWave = Object.entries(issues)
    .filter(([, n]) => n.depends_on.length === 0)
    .map(([id]) => id);
  for (const id of currentWave) {
    const n = issues[id];
    if (n) n.wave = 0;
  }

  let wave = 0;
  while (currentWave.length > 0) {
    currentWave.sort((a, b) =>
      (issues[a]?.identifier ?? a).localeCompare(issues[b]?.identifier ?? b),
    );
    analysis.ready_fronts.push({
      wave,
      issues: currentWave.map((id) => issues[id]?.identifier ?? id),
      titles: currentWave.map((id) => issues[id]?.title ?? ""),
    });
    if (currentWave.length > analysis.max_parallelism) {
      analysis.max_parallelism = currentWave.length;
    }
    const nextWave: string[] = [];
    for (const id of currentWave) {
      const node = issues[id];
      if (!node) continue;
      for (const dependentIdent of node.depended_on_by) {
        const dependentId = idByIdentifier.get(dependentIdent);
        if (!dependentId) continue;
        const newDeg = (inDegree.get(dependentId) ?? 0) - 1;
        inDegree.set(dependentId, newDeg);
        if (newDeg === 0) {
          nextWave.push(dependentId);
          const dn = issues[dependentId];
          if (dn) dn.wave = wave + 1;
        }
      }
    }
    currentWave = nextWave;
    wave++;
  }
  analysis.estimated_sessions = analysis.total_issues;
}

/**
 * Scan for an existing swarm molecule linked to the given epic via a Related
 * issueRelation. Returns the first match or null. The search is bounded to
 * issues bearing the `swarm` label so the result set stays small.
 */
export async function findExistingSwarm(
  client: GraphQLClient,
  epicId: string,
): Promise<SwarmCandidateFieldsFragment | null> {
  let after: string | undefined;
  do {
    const result = await client.request<FindSwarmsByLabelQuery>(
      FindSwarmsByLabelDocument,
      {
        filter: { labels: { name: { eq: SWARM_LABEL_NAME } } },
        first: 250,
        after,
      },
    );
    for (const candidate of result.issues.nodes) {
      const linked = candidate.relations.nodes.some(
        (r) => r.type === "related" && r.relatedIssue?.id === epicId,
      );
      if (linked) return candidate;
    }
    after = result.issues.pageInfo.hasNextPage
      ? (result.issues.pageInfo.endCursor ?? undefined)
      : undefined;
  } while (after);
  return null;
}

export function buildSwarmDescription(input: {
  epic_id: string;
  epic_identifier: string;
  coordinator: string;
}): string {
  return [
    `Swarm molecule orchestrating epic ${input.epic_identifier}.`,
    "",
    `- epic_id: ${input.epic_id}`,
    `- epic_identifier: ${input.epic_identifier}`,
    `- coordinator: ${input.coordinator || ""}`,
  ].join("\n");
}

/**
 * Pull the `coordinator:` value back out of a swarm-molecule description.
 * Returns "" when the marker is missing or empty so unassigned swarms
 * surface an empty coordinator field.
 */
export function parseSwarmCoordinator(description: string | null): string {
  if (!description) return "";
  for (const line of description.split("\n")) {
    const trimmed = line.trim();
    const idx = trimmed.toLowerCase().indexOf("- coordinator:");
    if (idx === 0) {
      return trimmed.slice("- coordinator:".length).trim();
    }
  }
  return "";
}

/**
 * Create a swarm molecule for the given epic: ensures the `swarm` label
 * exists, creates a Linear issue (`Swarm: <epic-title>`) in the epic's team
 * with that label, then links it to the epic via a Related relation.
 */
export async function createSwarmMolecule(
  client: GraphQLClient,
  input: {
    epic: SwarmIssueFieldsFragment;
    coordinator: string;
  },
): Promise<SwarmMolecule> {
  const swarmLabelId = await ensureWorkspaceLabel(
    client,
    SWARM_LABEL_NAME,
    SWARM_LABEL_DESCRIPTION,
  );
  const description = buildSwarmDescription({
    epic_id: input.epic.id,
    epic_identifier: input.epic.identifier,
    coordinator: input.coordinator,
  });

  const created = await createIssue(client, {
    teamId: input.epic.team.id,
    title: `Swarm: ${input.epic.title}`,
    description,
    priority: input.epic.priority,
    labelIds: [swarmLabelId],
  });

  await createIssueRelation(client, {
    issueId: created.id,
    relatedIssueId: input.epic.id,
    type: IssueRelationType.Related,
  });

  return {
    id: created.id,
    identifier: created.identifier,
    title: created.title,
    description,
    epic_id: input.epic.id,
    epic_identifier: input.epic.identifier,
    coordinator: input.coordinator,
  };
}

/**
 * Auto-wrap a non-epic issue as the only child of a newly-created wrapper
 * epic. Returns the wrapper's UUID + identifier. Two writes: create wrapper,
 * then update original.parentId — failure between them leaves an orphan
 * wrapper that the caller can clean up.
 */
export async function wrapIssueAsEpic(
  client: GraphQLClient,
  source: SwarmIssueFieldsFragment,
): Promise<{ id: string; identifier: string; title: string }> {
  const wrapper = await createIssue(client, {
    teamId: source.team.id,
    title: `Swarm Epic: ${source.title}`,
    description: `Auto-generated epic to wrap ${source.identifier} for swarm execution.`,
    priority: source.priority,
  });
  await updateIssue(client, source.id, { parentId: wrapper.id });
  return {
    id: wrapper.id,
    identifier: wrapper.identifier,
    title: wrapper.title,
  };
}

export interface StatusIssue {
  id: string;
  identifier: string;
  title: string;
  assignee_id?: string;
  assignee_name?: string;
  assignee_email?: string;
  closed_at?: string;
  /** Identifiers of in-epic dependencies that are still open. Blocked rows only. */
  blocked_by?: string[];
}

export interface SwarmStatus {
  epic_id: string;
  epic_identifier: string;
  epic_title: string;
  total_issues: number;
  completed: StatusIssue[];
  active: StatusIssue[];
  ready: StatusIssue[];
  blocked: StatusIssue[];
  active_count: number;
  ready_count: number;
  blocked_count: number;
  progress_percent: number;
}

/**
 * Compute the current swarm status: per-issue categorization (completed,
 * active, ready, blocked) plus counts and progress. Pure derivation from
 * the epic's children + their in-epic `blocks` relations — no Linear write.
 *
 * Uses Linear primitives: child state.type for completed/active
 * classification, child.relations[blocks] for the dependency graph.
 * Linear stores the forward `blocks` edge on the BLOCKER, so to find
 * what a child depends on, we walk the inverse: any OTHER child whose
 * `blocks` relation points at this child.
 */
export async function getSwarmStatus(
  client: GraphQLClient,
  swarmOrEpicId: string,
): Promise<SwarmStatus> {
  // If the input is a swarm molecule, follow its `related` relation to the epic.
  // We detect a molecule by querying its `labels` for the swarm label and its
  // `relations` for a related-issue id. If no such relation exists, fall back
  // to treating the id as an epic directly.
  const candidate = await client.request<GetIssueForSwarmQuery>(
    GetIssueForSwarmDocument,
    { id: swarmOrEpicId },
  );
  if (!candidate.issue) {
    throw new Error(`issue '${swarmOrEpicId}' not found`);
  }
  const c = candidate.issue;
  const isMolecule = c.labels.nodes.some((l) => l.name === SWARM_LABEL_NAME);
  let epicId = swarmOrEpicId;
  if (isMolecule) {
    const linked = c.relations.nodes.find(
      (r) => r.type === "related" && r.relatedIssue?.id,
    );
    if (!linked?.relatedIssue?.id) {
      throw new Error(`swarm molecule '${swarmOrEpicId}' has no linked epic`);
    }
    epicId = linked.relatedIssue.id;
  }

  // Fetch the epic (possibly refetching the same id we just got, which is a
  // wasted call when input was already the epic — accept it for simplicity).
  const epicResult =
    epicId === swarmOrEpicId
      ? candidate
      : await client.request<GetIssueForSwarmQuery>(GetIssueForSwarmDocument, {
          id: epicId,
        });
  if (!epicResult.issue) {
    throw new Error(`linked epic '${epicId}' not found`);
  }
  const epic = epicResult.issue;
  const children = epic.children.nodes;

  const status: SwarmStatus = {
    epic_id: epic.id,
    epic_identifier: epic.identifier,
    epic_title: epic.title,
    total_issues: children.length,
    completed: [],
    active: [],
    ready: [],
    blocked: [],
    active_count: 0,
    ready_count: 0,
    blocked_count: 0,
    progress_percent: 0,
  };
  if (children.length === 0) return status;

  // Build a quick lookup of child state by id, plus the in-epic dependency
  // graph. Linear stores forward `blocks` on the blocker: child X's
  // relations[blocks] → Y means X blocks Y, so Y depends_on X.
  const childById = new Map<string, (typeof children)[number]>();
  for (const child of children) childById.set(child.id, child);
  const dependsOn = new Map<string, string[]>(); // child.id → list of blocker ids (in-epic)
  for (const child of children) {
    for (const rel of child.relations.nodes) {
      if (rel.type !== "blocks" || !rel.relatedIssue) continue;
      if (!childById.has(rel.relatedIssue.id)) continue;
      const arr = dependsOn.get(rel.relatedIssue.id) ?? [];
      arr.push(child.id);
      dependsOn.set(rel.relatedIssue.id, arr);
    }
  }

  for (const child of children) {
    const stateType = child.state.type;
    const closedAt = child.completedAt ?? child.canceledAt ?? undefined;
    const base: StatusIssue = {
      id: child.id,
      identifier: child.identifier,
      title: child.title,
      ...(child.assignee?.id ? { assignee_id: child.assignee.id } : {}),
      ...(child.assignee?.name ? { assignee_name: child.assignee.name } : {}),
      ...(child.assignee?.email
        ? { assignee_email: child.assignee.email }
        : {}),
    };

    if (isClosedStateType(stateType)) {
      status.completed.push({
        ...base,
        ...(closedAt ? { closed_at: closedAt } : {}),
      });
      continue;
    }
    if (lifecycleStatusFromStateType(stateType) === "in_progress") {
      status.active.push(base);
      continue;
    }

    // Open / backlog / triage / unstarted: check for open in-epic deps.
    const blockerIds = dependsOn.get(child.id) ?? [];
    const openBlockerIdentifiers: string[] = [];
    for (const blockerId of blockerIds) {
      const blocker = childById.get(blockerId);
      if (blocker && !isClosedStateType(blocker.state.type)) {
        openBlockerIdentifiers.push(blocker.identifier);
      }
    }
    if (openBlockerIdentifiers.length > 0) {
      status.blocked.push({ ...base, blocked_by: openBlockerIdentifiers });
    } else {
      status.ready.push(base);
    }
  }

  // Sort each bucket by identifier for stable output.
  const byIdentifier = (a: StatusIssue, b: StatusIssue) =>
    a.identifier.localeCompare(b.identifier, undefined, { numeric: true });
  status.completed.sort(byIdentifier);
  status.active.sort(byIdentifier);
  status.ready.sort(byIdentifier);
  status.blocked.sort(byIdentifier);

  status.active_count = status.active.length;
  status.ready_count = status.ready.length;
  status.blocked_count = status.blocked.length;
  status.progress_percent =
    status.total_issues > 0
      ? (status.completed.length / status.total_issues) * 100
      : 0;
  return status;
}

export interface SwarmListItem {
  swarm_id: string;
  swarm_identifier: string;
  swarm_title: string;
  epic_id: string | null;
  epic_identifier: string | null;
  epic_title: string | null;
  coordinator: string;
  total_issues: number;
  closed_issues: number;
  wave_depth: number;
  max_parallelism: number;
  swarmable: boolean;
  analysis_error?: string;
}

/**
 * Find the related-epic id from a swarm-molecule's relations. The molecule is
 * linked to its epic via an `IssueRelationType.Related` relation written by
 * `createSwarmMolecule`. Returns the first match (the model is 1-to-1).
 */
function findLinkedEpicId(swarm: SwarmCandidateFieldsFragment): string | null {
  for (const rel of swarm.relations.nodes) {
    if (rel.type === "related" && rel.relatedIssue?.id) {
      return rel.relatedIssue.id;
    }
  }
  return null;
}

/**
 * List all swarm molecules in the workspace, computing high-level analysis
 * (total/closed children, wave depth, max parallelism) per swarm. Built on
 * linear primitives (label-scoped issues + Related relation + epic-children
 * tree).
 *
 * One analyzeEpicForSwarm call per swarm — O(N) extra round-trips. Fine for
 * the dozens-of-swarms case; batched epic fetch would be a follow-up.
 */
export async function listSwarmMolecules(
  client: GraphQLClient,
): Promise<{ swarms: SwarmListItem[]; count: number }> {
  const swarms: SwarmCandidateFieldsFragment[] = [];
  let after: string | undefined;
  do {
    const result = await client.request<FindSwarmsByLabelQuery>(
      FindSwarmsByLabelDocument,
      {
        filter: { labels: { name: { eq: SWARM_LABEL_NAME } } },
        first: 250,
        after,
      },
    );
    swarms.push(...result.issues.nodes);
    after = result.issues.pageInfo.hasNextPage
      ? (result.issues.pageInfo.endCursor ?? undefined)
      : undefined;
  } while (after);

  const items: SwarmListItem[] = [];
  for (const swarm of swarms) {
    const coordinator = parseSwarmCoordinator(swarm.description ?? null);
    const epicId = findLinkedEpicId(swarm);
    let epicIdentifier: string | null = null;
    let epicTitle: string | null = null;
    let totalIssues = 0;
    let closedIssues = 0;
    let waveDepth = 0;
    let maxParallelism = 0;
    let swarmable = false;
    let analysisError: string | undefined;

    if (epicId) {
      try {
        const analysis = await analyzeEpicForSwarm(client, epicId);
        epicIdentifier = analysis.epic_identifier;
        epicTitle = analysis.epic_title;
        totalIssues = analysis.total_issues;
        closedIssues = analysis.closed_issues;
        waveDepth = analysis.ready_fronts.length;
        maxParallelism = analysis.max_parallelism;
        swarmable = analysis.swarmable;
      } catch (e) {
        analysisError = (e as Error).message;
      }
    }

    items.push({
      swarm_id: swarm.id,
      swarm_identifier: swarm.identifier,
      swarm_title: swarm.title,
      epic_id: epicId,
      epic_identifier: epicIdentifier,
      epic_title: epicTitle,
      coordinator,
      total_issues: totalIssues,
      closed_issues: closedIssues,
      wave_depth: waveDepth,
      max_parallelism: maxParallelism,
      swarmable,
      ...(analysisError ? { analysis_error: analysisError } : {}),
    });
  }
  return { swarms: items, count: items.length };
}
