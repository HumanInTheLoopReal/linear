import type { LinearSdkClient } from "../client/linear-client.js";
import type {
  NormalizedBatchOp,
  ResolvedBatchOp,
  ResolvedBatchUpdateInput,
} from "../common/batch-script.js";
import { resolveIssueId, resolveIssueTeamContext } from "./issue-resolver.js";
import { findWorkspaceLabelId } from "./label-resolver.js";
import { resolveStateIdByType, resolveStatusId } from "./status-resolver.js";
import { resolveUserId } from "./user-resolver.js";

const STATUS_TO_STATE_TYPE = {
  open: "unstarted",
  in_progress: "started",
  closed: "completed",
  backlog: "backlog",
  canceled: "canceled",
  cancelled: "canceled",
} as const;

interface ResolveBatchOptions {
  defaultTeamId?: string;
}

class BatchResolutionContext {
  private readonly issueIds = new Map<string, Promise<string>>();
  private readonly issueTeams = new Map<
    string,
    Promise<{ issueId: string; teamId: string }>
  >();
  private readonly stateIds = new Map<string, Promise<string>>();
  private readonly userIds = new Map<string, Promise<string>>();
  private readonly workspaceLabelIds = new Map<
    string,
    Promise<string | undefined>
  >();

  constructor(private readonly client: LinearSdkClient) {}

  resolveIssueId(reference: string): Promise<string> {
    const key = reference.toLowerCase();
    const cached = this.issueIds.get(key);
    if (cached) return cached;
    const pending = resolveIssueId(this.client, reference);
    this.issueIds.set(key, pending);
    return pending;
  }

  resolveIssueTeam(
    reference: string,
  ): Promise<{ issueId: string; teamId: string }> {
    const key = reference.toLowerCase();
    const cached = this.issueTeams.get(key);
    if (cached) return cached;
    const pending = resolveIssueTeamContext(this.client, reference);
    this.issueTeams.set(key, pending);
    if (!this.issueIds.has(key)) {
      this.issueIds.set(
        key,
        pending.then((issue) => issue.issueId),
      );
    }
    return pending;
  }

  resolveState(teamId: string, status: string): Promise<string> {
    const cacheKey = `${teamId}:${status.toLowerCase()}`;
    const cached = this.stateIds.get(cacheKey);
    if (cached) return cached;
    const logicalType =
      STATUS_TO_STATE_TYPE[
        status.toLowerCase() as keyof typeof STATUS_TO_STATE_TYPE
      ];
    const pending = logicalType
      ? resolveStateIdByType(this.client, teamId, logicalType)
      : resolveStatusId(this.client, status, teamId);
    this.stateIds.set(cacheKey, pending);
    return pending;
  }

  resolveUser(reference: string): Promise<string> {
    const key = reference.toLowerCase();
    const cached = this.userIds.get(key);
    if (cached) return cached;
    const pending = resolveUserId(this.client, reference);
    this.userIds.set(key, pending);
    return pending;
  }

  findWorkspaceLabel(reference: string): Promise<string | undefined> {
    const key = reference.toLowerCase();
    const cached = this.workspaceLabelIds.get(key);
    if (cached) return cached;
    const pending = findWorkspaceLabelId(this.client, reference);
    this.workspaceLabelIds.set(key, pending);
    return pending;
  }
}

async function resolveClose(
  op: Extract<NormalizedBatchOp, { cmd: "close" }>,
  context: BatchResolutionContext,
): Promise<ResolvedBatchOp> {
  const issue = await context.resolveIssueTeam(op.target);
  return {
    line: op.line,
    raw: op.raw,
    cmd: "close",
    target: op.target,
    issueId: issue.issueId,
    stateId: await context.resolveState(issue.teamId, "closed"),
    ...(op.reason ? { reason: op.reason } : {}),
  };
}

async function resolveUpdate(
  op: Extract<NormalizedBatchOp, { cmd: "update" }>,
  context: BatchResolutionContext,
): Promise<ResolvedBatchOp> {
  const input: ResolvedBatchUpdateInput = {};
  let issueId: string;

  if (op.update.status !== undefined) {
    const issue = await context.resolveIssueTeam(op.target);
    issueId = issue.issueId;
    input.stateId = await context.resolveState(issue.teamId, op.update.status);
  } else {
    issueId = await context.resolveIssueId(op.target);
  }
  if (op.update.priority !== undefined) input.priority = op.update.priority;
  if (op.update.title !== undefined) input.title = op.update.title;
  if (op.update.assignee !== undefined) {
    input.assigneeId = await context.resolveUser(op.update.assignee);
  }

  return {
    line: op.line,
    raw: op.raw,
    cmd: "update",
    target: op.target,
    issueId,
    input,
  };
}

async function resolveCreate(
  op: Extract<NormalizedBatchOp, { cmd: "create" }>,
  context: BatchResolutionContext,
  options: ResolveBatchOptions,
): Promise<ResolvedBatchOp> {
  if (!options.defaultTeamId) {
    throw new Error(
      "create requires --team to be passed to `linear batch` (Linear creates need a team)",
    );
  }
  const typeLabelId = await context.findWorkspaceLabel(`type:${op.issueType}`);
  return {
    line: op.line,
    raw: op.raw,
    cmd: "create",
    target: op.title,
    teamId: options.defaultTeamId,
    issueType: op.issueType,
    title: op.title,
    priority: op.priority,
    ...(typeLabelId ? { labelIds: [typeLabelId] } : {}),
  };
}

async function resolveDependency(
  op: Extract<NormalizedBatchOp, { cmd: "dep.add" | "dep.remove" }>,
  context: BatchResolutionContext,
): Promise<ResolvedBatchOp> {
  const [fromId, toId] = await Promise.all([
    context.resolveIssueId(op.from),
    context.resolveIssueId(op.to),
  ]);
  const base = {
    line: op.line,
    raw: op.raw,
    target: `${op.from}->${op.to}`,
    fromId,
    toId,
  };
  if (op.cmd === "dep.remove") return { ...base, cmd: "dep.remove" };
  return { ...base, cmd: "dep.add", type: op.type };
}

async function resolveBatchOp(
  op: NormalizedBatchOp,
  context: BatchResolutionContext,
  options: ResolveBatchOptions,
): Promise<ResolvedBatchOp> {
  switch (op.cmd) {
    case "close":
      return resolveClose(op, context);
    case "update":
      return resolveUpdate(op, context);
    case "create":
      return resolveCreate(op, context, options);
    case "dep.add":
    case "dep.remove":
      return resolveDependency(op, context);
  }
}

/** Resolve every human-facing reference before the first batch mutation. */
export async function resolveBatchOps(
  client: LinearSdkClient,
  ops: NormalizedBatchOp[],
  options: ResolveBatchOptions = {},
): Promise<ResolvedBatchOp[]> {
  const context = new BatchResolutionContext(client);
  const resolved: ResolvedBatchOp[] = [];
  for (const op of ops) {
    try {
      resolved.push(await resolveBatchOp(op, context, options));
    } catch (error) {
      throw new Error(
        `line ${op.line} (${op.raw}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return resolved;
}
