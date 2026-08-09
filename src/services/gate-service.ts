import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GraphQLClient } from "../client/graphql-client.js";
import { NON_CLOSED_STATE_TYPES } from "../common/issue-lifecycle.js";
import {
  type GateIssueFieldsFragment,
  GetGatesDocument,
  type GetGatesQuery,
  type IssueFilter,
} from "../gql/graphql.js";
import { createComment } from "./comment-service.js";
import { getIssue, updateIssue } from "./issue-service.js";

const execFileAsync = promisify(execFile);

export const GATE_LABEL_NAME = "linear:gate";

export interface GateSummary {
  id: string;
  identifier: string;
  title: string;
  status: string; // state.type
  state_name: string;
  issue_type: "gate"; // constant; preserved for JSON shape stability
  await_type: string | null;
  await_id: string | null;
  timeout: string | null;
  waiters: string[];
  created_at: string;
  team: { id: string; key: string; name: string };
}

/**
 * Pluck a value out of the gate's description markdown. Convention is a list
 * of `key: value` lines, optionally bulleted. Returns null if absent.
 *
 * Examples that match (case-insensitive on the key, value is preserved verbatim):
 *   await_type: gh:run
 *   - await_id: 12345
 *   * timeout: 30m
 */
function pluckFromDescription(
  description: string | null | undefined,
  key: string,
): string | null {
  if (!description) return null;
  const re = new RegExp(
    `^[\\s\\-\\*]*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*:\\s*(.+?)\\s*$`,
    "im",
  );
  const m = description.match(re);
  return m?.[1] ?? null;
}

/**
 * Parse the comma-separated `waiters:` line from a gate description into a
 * trimmed string list. Empty/missing produces []. Whitespace-only entries are
 * skipped so trailing commas don't generate empty waiters.
 */
function parseWaiters(description: string | null | undefined): string[] {
  const raw = pluckFromDescription(description, "waiters");
  if (!raw) return [];
  return raw
    .split(",")
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

function toGateSummary(issue: GateIssueFieldsFragment): GateSummary {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    status: issue.state.type,
    state_name: issue.state.name,
    issue_type: "gate",
    await_type: pluckFromDescription(issue.description, "await_type"),
    await_id: pluckFromDescription(issue.description, "await_id"),
    timeout: pluckFromDescription(issue.description, "timeout"),
    waiters: parseWaiters(issue.description),
    created_at: issue.createdAt,
    team: issue.team,
  };
}

/**
 * Enumerate gate issues across the workspace. By default returns only OPEN
 * gates (triage/backlog/unstarted/started); pass `{all: true}` to include
 * closed gates. Pagination follows Linear's cursor model up to `limit`
 * results (default 50). Each gate's `await_type`/`await_id`/`timeout`/
 * `waiters` are pulled from the description's key:value block.
 */
export async function listGates(
  client: GraphQLClient,
  options: { all?: boolean; teamId?: string; limit?: number } = {},
): Promise<GateSummary[]> {
  const limit = options.limit ?? 50;
  const filter: IssueFilter = {
    labels: { name: { eq: GATE_LABEL_NAME } },
  };
  if (!options.all) {
    filter.state = { type: { in: [...NON_CLOSED_STATE_TYPES] } };
  }
  if (options.teamId) {
    filter.team = { id: { eq: options.teamId } };
  }

  const out: GateSummary[] = [];
  let after: string | undefined;
  // Page in batches of min(limit, 250) until we hit `limit` or the cursor end.
  while (out.length < limit) {
    const pageSize = Math.min(limit - out.length, 250);
    const result: GetGatesQuery = await client.request(GetGatesDocument, {
      filter,
      first: pageSize,
      after,
    });
    for (const node of result.issues.nodes) {
      out.push(toGateSummary(node));
      if (out.length >= limit) break;
    }
    if (!result.issues.pageInfo.hasNextPage) break;
    after = result.issues.pageInfo.endCursor ?? undefined;
    if (!after) break;
  }
  return out;
}

/**
 * Two-step resolver for `gate resolve`: the command needs the gate's team
 * to pick a `completed`-typed workflow state, but the service must accept
 * only pre-resolved UUIDs. This helper validates that `issueId` is in fact
 * a gate-labeled issue and returns the team-id so the command can call
 * `resolveStateIdByType` next.
 *
 * Errors are intentionally explicit: "not a gate" (missing the label) is
 * distinct from "issue not found", so the agent can react accordingly.
 */
export interface GateContext {
  id: string;
  identifier: string;
  team_id: string;
}

export async function fetchGateForResolve(
  gql: GraphQLClient,
  issueId: string,
): Promise<GateContext> {
  const issue = await getIssue(gql, issueId);
  const labelNames =
    "labels" in issue && issue.labels?.nodes
      ? issue.labels.nodes.map((l) => l.name)
      : [];
  if (!labelNames.includes(GATE_LABEL_NAME)) {
    throw new Error(
      `Issue ${issue.identifier} is not a gate (missing '${GATE_LABEL_NAME}' label)`,
    );
  }
  return {
    id: issue.id,
    identifier: issue.identifier,
    team_id: issue.team.id,
  };
}

export interface ResolveGateResult {
  id: string;
  identifier: string;
  state_id: string;
  state_name: string;
  comment_id: string | null;
  reason: string | null;
}

/**
 * Apply a gate resolution: move the issue to the pre-resolved `done`-family
 * state and (optionally) post a comment with the reason. The reason text is
 * recorded as a Linear comment.
 */
export async function resolveGate(
  gql: GraphQLClient,
  args: {
    issueId: string;
    stateId: string;
    reason?: string;
  },
): Promise<ResolveGateResult> {
  const updated = await updateIssue(gql, args.issueId, {
    stateId: args.stateId,
  });
  let commentId: string | null = null;
  if (args.reason && args.reason.trim().length > 0) {
    const body = `Gate resolved.\n\nReason: ${args.reason}`;
    const comment = await createComment(gql, {
      issueId: args.issueId,
      body,
    });
    commentId = comment.id;
  }
  return {
    id: updated.id,
    identifier: updated.identifier,
    state_id: updated.state.id,
    state_name: updated.state.name,
    comment_id: commentId,
    reason: args.reason?.trim() || null,
  };
}

/**
 * Parse the gate timeout duration syntax (e.g. "30s", "5m", "2h", "1d")
 * into milliseconds. Returns null on malformed input. Composite forms
 * ("1h30m") are NOT supported — the gate description block treats the
 * value as opaque text and matches a single unit in practice.
 */
export function parseTimeoutToMs(input: string | null): number | null {
  if (!input) return null;
  const match = input.trim().match(/^(\d+)\s*(ms|s|m|h|d)$/i);
  if (!match) return null;
  const n = Number.parseInt(match[1] ?? "", 10);
  const unit = (match[2] ?? "").toLowerCase();
  if (!Number.isFinite(n) || n < 0) return null;
  switch (unit) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      return null;
  }
}

/**
 * The `--type` filter: matches `await_type` against the requested filter,
 * where `gh` is an alias for `gh:run|gh:pr` and `all`/empty means everything.
 */
function shouldCheckGate(
  gate: GateSummary,
  typeFilter: string | undefined,
): boolean {
  if (!typeFilter || typeFilter === "all") return true;
  const at = gate.await_type ?? "";
  if (typeFilter === "gh") return at.startsWith("gh:");
  return at === typeFilter;
}

interface GhRunPayload {
  status?: string;
  conclusion?: string;
  name?: string;
}
interface GhPRPayload {
  state?: string;
  title?: string;
}

/**
 * Test seam: replace these to bypass the `gh` CLI in unit tests.
 */
export const __ghDeps: {
  runViewJSON: (runId: string) => Promise<GhRunPayload>;
  prViewJSON: (prId: string) => Promise<GhPRPayload>;
} = {
  runViewJSON: async (runId) => {
    const { stdout } = await execFileAsync("gh", [
      "run",
      "view",
      runId,
      "--json",
      "status,conclusion,name",
    ]);
    return JSON.parse(stdout);
  },
  prViewJSON: async (prId) => {
    const { stdout } = await execFileAsync("gh", [
      "pr",
      "view",
      prId,
      "--json",
      "state,title",
    ]);
    return JSON.parse(stdout);
  },
};

export type CheckOutcome = "resolved" | "escalated" | "pending" | "skipped";

export interface CheckEvaluation {
  outcome: CheckOutcome;
  reason: string;
  error?: string;
}

async function evaluateGate(
  gate: GateSummary,
  now: number,
): Promise<CheckEvaluation> {
  const awaitType = gate.await_type ?? "";

  if (!gate.await_id && awaitType.startsWith("gh:")) {
    return { outcome: "pending", reason: "no await_id specified" };
  }

  if (awaitType === "gh:run") {
    try {
      const data = await __ghDeps.runViewJSON(gate.await_id ?? "");
      const status = data.status ?? "";
      const conclusion = data.conclusion ?? "";
      const name = data.name ?? "";
      if (status === "completed") {
        if (conclusion === "success" || conclusion === "skipped") {
          return {
            outcome: "resolved",
            reason: `workflow '${name}' ${conclusion}`,
          };
        }
        return {
          outcome: "escalated",
          reason: `workflow '${name}' concluded with ${conclusion}`,
        };
      }
      return {
        outcome: "pending",
        reason: `workflow '${name}' is ${status || "unknown"}`,
      };
    } catch (e) {
      return {
        outcome: "pending",
        reason: "gh run view failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  if (awaitType === "gh:pr") {
    try {
      const data = await __ghDeps.prViewJSON(gate.await_id ?? "");
      const state = data.state ?? "";
      const title = data.title ?? "";
      if (state === "MERGED")
        return { outcome: "resolved", reason: `PR '${title}' was merged` };
      if (state === "CLOSED")
        return {
          outcome: "escalated",
          reason: `PR '${title}' was closed without merging`,
        };
      return {
        outcome: "pending",
        reason: `PR '${title}' state: ${state || "unknown"}`,
      };
    } catch (e) {
      return {
        outcome: "pending",
        reason: "gh pr view failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  if (awaitType === "timer") {
    const ms = parseTimeoutToMs(gate.timeout);
    if (ms == null) {
      return {
        outcome: "pending",
        reason: "timer gate without parseable timeout",
        error: "no timeout set",
      };
    }
    const createdAtMs = new Date(gate.created_at).getTime();
    const expiresAtMs = createdAtMs + ms;
    if (now > expiresAtMs) {
      const elapsedSec = Math.floor((now - expiresAtMs) / 1000);
      return {
        outcome: "resolved",
        reason: `timer expired ${elapsedSec}s ago`,
      };
    }
    const remainingSec = Math.floor((expiresAtMs - now) / 1000);
    return { outcome: "pending", reason: `expires in ${remainingSec}s` };
  }

  // human, issue, unknown: nothing to poll, leave it for manual resolution
  return {
    outcome: "skipped",
    reason: `await_type '${awaitType}' requires manual resolution`,
  };
}

export interface GateCheckRecord {
  gate_id: string;
  identifier: string;
  await_type: string | null;
  await_id: string | null;
  outcome: CheckOutcome;
  reason: string;
  closed: boolean;
  error: string | null;
}

export interface GateCheckSummary {
  checked: number;
  resolved: number;
  escalated: number;
  pending: number;
  skipped: number;
  errors: number;
  dry_run: boolean;
  results: GateCheckRecord[];
}

export interface GateCheckOptions {
  typeFilter?: string;
  dryRun?: boolean;
  limit?: number;
  teamId?: string;
  /** Pre-fetched by the command so this service remains GraphQL-only. */
  gates?: GateSummary[];
  /** Completed-state UUID (or lookup error) resolved once per team. */
  completedStateByTeam?: ReadonlyMap<
    string,
    { stateId?: string; error?: string }
  >;
}

/**
 * Iterate open gate issues and evaluate each gate's await condition,
 * closing any that resolve.
 *
 *   1. `--escalate` (firing `gt escalate`) is not wired — `gt` is not
 *      part of the linear toolchain. Failed/expired gates are still
 *      reported with outcome=escalated so callers can act on them.
 *   2. Cross-rig issue-tracker gates are reported as skipped.
 *
 * The completed-state lookup is cached per team to avoid an N+1 SDK round
 * trip when many gates belong to the same team.
 */
export async function runGateCheck(
  gql: GraphQLClient,
  options: GateCheckOptions = {},
): Promise<GateCheckSummary> {
  const limit = options.limit ?? 100;
  const allGates =
    options.gates ??
    (await listGates(gql, {
      teamId: options.teamId,
      limit,
    }));
  const gates = allGates.filter((g) => shouldCheckGate(g, options.typeFilter));

  const now = Date.now();
  const results: GateCheckRecord[] = [];
  let resolved = 0;
  let escalated = 0;
  let pending = 0;
  let skipped = 0;
  let errors = 0;

  for (const gate of gates) {
    const evalRes = await evaluateGate(gate, now);
    let closed = false;
    let extraError: string | null = evalRes.error ?? null;

    if (evalRes.outcome === "resolved" && !options.dryRun) {
      try {
        const state = options.completedStateByTeam?.get(gate.team.id);
        if (!state?.stateId) {
          throw new Error(
            state?.error ??
              `completed state was not resolved for team ${gate.team.key}`,
          );
        }
        await updateIssue(gql, gate.id, { stateId: state.stateId });
        closed = true;
      } catch (e) {
        extraError = e instanceof Error ? e.message : String(e);
        errors += 1;
      }
    }

    switch (evalRes.outcome) {
      case "resolved":
        resolved += 1;
        break;
      case "escalated":
        escalated += 1;
        break;
      case "pending":
        pending += 1;
        break;
      case "skipped":
        skipped += 1;
        break;
    }

    results.push({
      gate_id: gate.id,
      identifier: gate.identifier,
      await_type: gate.await_type,
      await_id: gate.await_id,
      outcome: evalRes.outcome,
      reason: evalRes.reason,
      closed,
      error: extraError,
    });
  }

  return {
    checked: results.length,
    resolved,
    escalated,
    pending,
    skipped,
    errors,
    dry_run: options.dryRun ?? false,
    results,
  };
}
