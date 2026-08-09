/**
 * `linear doctor` — workspace health diagnostics.
 *
 * The *workspace-shape* slice — auth, stale issues, unassigned issues,
 * label conventions — plus a rich agent-readable output mode (`--agent`).
 *
 * Emits a stable `doctorResult` JSON shape (snake_case keys, `checks[]`
 * plus envelope fields). The envelope includes `path`, `cli_version`,
 * `timestamp`, `platform`, and `suppressed_count`.
 *
 * Relationship to `linear preflight`: preflight is the *fast* probe
 * (auth, stale, triage) intended as a pre-PR self-reminder. Doctor is
 * the *comprehensive* checkup (auth, stale, unassigned, labels) intended as
 * a longer-running diagnostic. They overlap deliberately — both should
 * pass on a healthy workspace.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import {
  checkNameToSuppressSlug,
  getSuppressedDoctorChecks,
} from "../common/config-store.js";
import type { DoctorCheck } from "../common/doctor-types.js";
import { deriveScopeLabel } from "../common/git-remote.js";
import { type ActiveScope, getActiveScope } from "../common/scope-filter.js";
import {
  CountBrokenParentEdgesDocument,
  type CountBrokenParentEdgesQuery,
  CountClosedNotArchivedDocument,
  type CountClosedNotArchivedQuery,
  CountOrphanIssuesDocument,
  type CountOrphanIssuesQuery,
  CountStaleIssuesDocument,
  CountStaleIssuesInTeamDocument,
  type CountStaleIssuesInTeamQuery,
  type CountStaleIssuesQuery,
  GetLabelsDocument,
  type GetLabelsQuery,
} from "../gql/graphql.js";
import { findUnscopedCandidates } from "./adopt-service.js";
import { validateToken } from "./auth-service.js";
import {
  AGENT_CHECK_NAMES,
  resolveAgentChecks,
} from "./doctor-agent-service.js";
import { enrichCheck } from "./doctor-enrichers.js";
import { listLabels } from "./label-service.js";

export type { CheckStatus, DoctorCheck } from "../common/doctor-types.js";

export interface DoctorResult {
  path: string;
  checks: DoctorCheck[];
  overall_ok: boolean;
  cli_version: string;
  timestamp: string;
  platform: { key: string };
  suppressed_count: number;
}

export const DEFAULT_DOCTOR_STALE_DAYS = 30;

const CHECK_NAMES = [
  "auth",
  "stale",
  "unassigned",
  "labels",
  "scope_label_exists",
  "scope_drift",
  "scope_coverage",
  "closed_not_archived",
  "broken_parent_edges",
  "stale_by_team_default",
  // lin-i79e: integration-health checks (Claude plugin/hooks/settings, CLI
  // on PATH). These run filesystem/PATH probes — no GraphQL — and are
  // composed by doctor-agent-service.ts.
  ...AGENT_CHECK_NAMES,
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

/**
 * Threshold above which the closed-not-archived hygiene check warns.
 * Linear's auto-archive setting is opt-in; on a healthy workspace some
 * closed work always sits un-archived, so a small count is normal.
 */
const CLOSED_NOT_ARCHIVED_WARN_THRESHOLD = 50;

export function isCheckName(s: string): s is CheckName {
  return (CHECK_NAMES as readonly string[]).includes(s);
}

/**
 * A suppressible check, as surfaced by `linear doctor --list-suppressible`.
 * Suppression hides a check's WARNING (only) when
 * `doctor.suppress.<slug>` = "true" is set; errors and ok always show.
 */
export interface SuppressibleCheck {
  /** The doctor check name (e.g. `closed_not_archived`). */
  name: string;
  /** The config slug (e.g. `closed-not-archived`). */
  slug: string;
  /** The config key a user sets to "true" to suppress this check's warning. */
  config_key: string;
}

/**
 * Every check name a user may suppress, with its config slug + key. Every
 * doctor check can warn, so the suppressible set is the full `CHECK_NAMES`
 * list mapped through `checkNameToSuppressSlug`. lin-k5nx.
 */
export function listSuppressibleChecks(): SuppressibleCheck[] {
  return CHECK_NAMES.map((name) => {
    const slug = checkNameToSuppressSlug(name);
    return { name, slug, config_key: `doctor.suppress.${slug}` };
  });
}

async function pageCount(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ count: number; hasNext: boolean; endCursor: string | null }>,
  maxPages = 50,
): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await fetchPage(cursor);
    total += page.count;
    if (!page.hasNext) return total;
    cursor = page.endCursor ?? undefined;
    if (cursor === undefined) return total;
  }
  return total;
}

async function checkAuth(client: GraphQLClient): Promise<DoctorCheck> {
  const base = {
    name: "auth",
    category: "auth",
    expected_state: "viewer query returns an authenticated user",
    commands: ["linear auth status"],
  };
  try {
    const viewer = await validateToken(client);
    return {
      ...base,
      status: "ok",
      severity: "info",
      message: `Authenticated as ${viewer.name}`,
      observed_state: `viewer.id=${viewer.id} email=${viewer.email}`,
    };
  } catch (e) {
    const err = (e as Error).message;
    return {
      ...base,
      status: "error",
      severity: "error",
      message: "Token failed to authenticate against Linear",
      detail: err,
      fix: "Re-run `linear auth` to mint a fresh token.",
      observed_state: err,
      explanation:
        "The configured API token did not resolve to a user. Most often this means the token has been rotated or revoked.",
    };
  }
}

async function checkStale(
  client: GraphQLClient,
  staleDays: number,
): Promise<DoctorCheck> {
  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString();
  const base = {
    name: "stale",
    category: "conventions",
    expected_state: `0 non-terminal issues older than ${staleDays} days`,
    commands: [`linear issues list --updated-before ${staleDays}d`],
  };
  try {
    const count = await pageCount(async (cursor) => {
      const r = await client.request<CountStaleIssuesQuery>(
        CountStaleIssuesDocument,
        { cutoff, first: 100, after: cursor },
      );
      return {
        count: r.issues.nodes.length,
        hasNext: r.issues.pageInfo.hasNextPage,
        endCursor: r.issues.pageInfo.endCursor ?? null,
      };
    });
    if (count === 0) {
      return {
        ...base,
        status: "ok",
        severity: "info",
        message: "No stale non-terminal issues",
        observed_state: "stale_count=0",
      };
    }
    return {
      ...base,
      status: "warning",
      severity: "warning",
      message: `${count} non-terminal issue(s) not updated in ${staleDays}+ days`,
      detail: "Backlog hygiene smell: review for closure, defer, or reassign.",
      fix: "Run `linear blocked` and `linear issues list --status open,in_progress --updated-before 30d` to triage.",
      observed_state: `stale_count=${count}`,
    };
  } catch (e) {
    return {
      ...base,
      status: "error",
      severity: "error",
      message: "Stale-issue query failed",
      detail: (e as Error).message,
    };
  }
}

// lin-pysz: renamed from `checkOrphans` / name:"orphans" — "orphans" was
// vocabulary-colliding with the top-level `linear orphans` verb (which
// detects commits-without-close, a completely different concept). The
// check itself is unchanged; only the user-facing name moved to
// `unassigned` so the CLI vocabulary has one meaning per word.
async function checkUnassigned(client: GraphQLClient): Promise<DoctorCheck> {
  const base = {
    name: "unassigned",
    category: "conventions",
    expected_state: "0 non-terminal issues without an assignee",
    commands: ["linear issues list --assignee null"],
  };
  try {
    const count = await pageCount(async (cursor) => {
      const r = await client.request<CountOrphanIssuesQuery>(
        CountOrphanIssuesDocument,
        { first: 100, after: cursor },
      );
      return {
        count: r.issues.nodes.length,
        hasNext: r.issues.pageInfo.hasNextPage,
        endCursor: r.issues.pageInfo.endCursor ?? null,
      };
    });
    if (count === 0) {
      return {
        ...base,
        status: "ok",
        severity: "info",
        message: "No unassigned issues (every open issue has an assignee)",
        observed_state: "unassigned_count=0",
      };
    }
    return {
      ...base,
      status: "warning",
      severity: "warning",
      message: `${count} non-terminal issue(s) without an assignee`,
      detail:
        "Unassigned issues accumulate when work is filed but never claimed.",
      fix: "Triage with `linear issues list --assignee null` and assign owners.",
      observed_state: `unassigned_count=${count}`,
    };
  } catch (e) {
    return {
      ...base,
      status: "error",
      severity: "error",
      message: "Unassigned-issue query failed",
      detail: (e as Error).message,
    };
  }
}

/**
 * Check that every name in `required` exists as an issue label on the
 * workspace. Used for convention enforcement (e.g. workflow-required
 * labels like `tier:linear-direct`). Missing required-labels config
 * means the check passes trivially (no convention enforced).
 */
async function checkLabels(
  client: GraphQLClient,
  required: string[],
): Promise<DoctorCheck> {
  const base = {
    name: "labels",
    category: "conventions",
    expected_state:
      required.length > 0
        ? `every required label present: ${required.join(", ")}`
        : "no required labels configured (trivially ok)",
    commands: ["linear labels list"],
  };
  if (required.length === 0) {
    return {
      ...base,
      status: "ok",
      severity: "info",
      message: "No required labels configured — check skipped",
      observed_state: "required_labels=[]",
    };
  }
  try {
    const present = new Set<string>();
    let cursor: string | undefined;
    for (let i = 0; i < 50; i += 1) {
      const page = await listLabels(client, undefined, {
        limit: 100,
        after: cursor,
      });
      for (const l of page.nodes) present.add(l.name);
      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor ?? undefined;
      if (!cursor) break;
    }
    const missing = required.filter((n) => !present.has(n));
    if (missing.length === 0) {
      return {
        ...base,
        status: "ok",
        severity: "info",
        message: "All required labels are present",
        observed_state: `present=${required.length}/${required.length}`,
      };
    }
    return {
      ...base,
      status: "warning",
      severity: "warning",
      message: `${missing.length} required label(s) missing: ${missing.join(", ")}`,
      fix: "Create the missing labels via `linear labels create` or update the required-labels config.",
      observed_state: `missing=[${missing.join(", ")}]`,
    };
  } catch (e) {
    return {
      ...base,
      status: "error",
      severity: "error",
      message: "Label-list query failed",
      detail: (e as Error).message,
    };
  }
}

/**
 * Verify the resolved `scope.label` actually exists as a Linear label.
 * Returns `null` (check skipped) when no scope is configured — the
 * firehose mode is intentional and not a warning. A missing label is a
 * warning, not an error: the next write or `linear adopt --all` will
 * create it idempotently.
 */
async function checkScopeLabelExists(
  client: GraphQLClient,
  scope: ActiveScope,
): Promise<DoctorCheck | null> {
  if (!scope.label) return null;
  const base = {
    name: "scope_label_exists",
    category: "scope",
    expected_state: `label '${scope.label}' exists in the workspace`,
    commands: ["linear labels list", "linear adopt --all"],
  };
  try {
    const found = await client.request<GetLabelsQuery>(GetLabelsDocument, {
      first: 5,
      filter: { name: { eqIgnoreCase: scope.label } },
    });
    const hit = found.issueLabels.nodes.some(
      (l) => l.name.toLowerCase() === scope.label?.toLowerCase(),
    );
    if (hit) {
      return {
        ...base,
        status: "ok",
        severity: "info",
        message: `Scope label '${scope.label}' exists`,
        observed_state: "label_present=true",
      };
    }
    return {
      ...base,
      status: "warning",
      severity: "warning",
      message: `Scope label '${scope.label}' does not yet exist in Linear`,
      detail:
        "Label creation is deferred until the first write — read-side scope filters return zero results until then.",
      fix: "Run `linear adopt --all` to populate, or `linear create` once to materialize the label.",
      observed_state: "label_present=false",
    };
  } catch (e) {
    return {
      ...base,
      status: "error",
      severity: "error",
      message: "Could not query labels for scope.label",
      detail: (e as Error).message,
    };
  }
}

/**
 * Compare the configured `scope.label` against what `deriveScopeLabel()`
 * would produce *right now* from the current git remote. Catches the
 * "remote URL was edited" case where the per-repo config no longer
 * matches the repo it lives in. Informational — no auto-action.
 */
function checkScopeDrift(scope: ActiveScope): DoctorCheck | null {
  if (!scope.label) return null;
  const base = {
    name: "scope_drift",
    category: "scope",
    expected_state:
      "scope.label matches the label `linear` would derive from the current git remote",
    commands: ["git remote get-url origin", "linear config get scope.label"],
  };
  const derived = deriveScopeLabel();
  if (!derived) {
    return {
      ...base,
      status: "ok",
      severity: "info",
      message: "No git context to compare against (scope drift check skipped)",
      observed_state: "derived=null",
    };
  }
  if (derived.label === scope.label) {
    return {
      ...base,
      status: "ok",
      severity: "info",
      message: `Scope label matches git derivation (source: ${derived.source})`,
      observed_state: `scope=${scope.label} derived=${derived.label}`,
    };
  }
  return {
    ...base,
    status: "warning",
    severity: "warning",
    message: `scope.label is '${scope.label}' but git would now derive '${derived.label}'`,
    detail:
      "The git remote (or repo basename) changed after the local scope was written. Existing reads/writes continue to use the configured label.",
    fix: `Run \`linear config set --local scope.label ${derived.label}\` to adopt the new derivation, or keep the existing label if it is intentional.`,
    observed_state: `scope=${scope.label} derived=${derived.label}`,
  };
}

/**
 * If `scope.default_project` is set, probe for any open issue in that
 * project missing the scope label. Cheap one-issue limit — only need to
 * know "is there at least one uncovered candidate?". Suggests
 * `linear adopt` as the fix.
 */
async function checkScopeCoverage(
  client: GraphQLClient,
  scope: ActiveScope,
  projectContext?: ScopeProjectContext,
): Promise<DoctorCheck | null> {
  if (!scope.label || (!scope.project && !projectContext)) return null;
  const projectName = projectContext?.name ?? scope.project ?? "(unknown)";
  const base = {
    name: "scope_coverage",
    category: "scope",
    expected_state: `every non-terminal issue in scope.default_project '${projectName}' carries '${scope.label}'`,
    commands: ["linear adopt --dry-run", "linear adopt --all"],
  };
  if (projectContext?.resolutionError) {
    return {
      ...base,
      status: "error",
      severity: "error",
      message: `Could not resolve scope.default_project '${projectName}'`,
      detail: projectContext.resolutionError,
      fix: "Update or unset `scope.default_project`, then rerun `linear doctor`.",
      observed_state: `project=${projectName} resolution=failed`,
    };
  }

  const projectId = projectContext?.id ?? scope.project;
  if (!projectId) return null;
  try {
    const candidates = await findUnscopedCandidates(client, {
      scopeLabel: scope.label,
      projectId,
      limit: 1,
    });
    if (candidates.length === 0) {
      return {
        ...base,
        status: "ok",
        severity: "info",
        message:
          "All non-terminal issues in scope.default_project carry the scope label",
        observed_state: "uncovered_count=0",
      };
    }
    return {
      ...base,
      status: "warning",
      severity: "warning",
      message: `Some open issues in scope.default_project are missing '${scope.label}'`,
      detail:
        "Untagged work in this project is invisible to scoped reads (e.g. `linear next`).",
      fix: "Run `linear adopt --dry-run` to inspect, then `linear adopt --all` to backfill.",
      observed_state: "uncovered_count>=1",
    };
  } catch (e) {
    return {
      ...base,
      status: "error",
      severity: "error",
      message: "Scope-coverage query failed",
      detail: (e as Error).message,
    };
  }
}

/**
 * Hygiene check: completed/canceled/duplicate issues that have not yet been
 * archived. Warns above CLOSED_NOT_ARCHIVED_WARN_THRESHOLD. lin-hqiz.
 */
async function checkClosedNotArchived(
  client: GraphQLClient,
): Promise<DoctorCheck> {
  const base = {
    name: "closed_not_archived",
    category: "hygiene",
    expected_state: `< ${CLOSED_NOT_ARCHIVED_WARN_THRESHOLD} closed-but-not-archived issues`,
    commands: [
      "linear issues list --status closed --all",
      "linear issues archive <id>",
    ],
  };
  try {
    const count = await pageCount(async (cursor) => {
      const r = await client.request<CountClosedNotArchivedQuery>(
        CountClosedNotArchivedDocument,
        { first: 100, after: cursor },
      );
      return {
        count: r.issues.nodes.length,
        hasNext: r.issues.pageInfo.hasNextPage,
        endCursor: r.issues.pageInfo.endCursor ?? null,
      };
    });
    if (count < CLOSED_NOT_ARCHIVED_WARN_THRESHOLD) {
      return {
        ...base,
        status: "ok",
        severity: "info",
        message: `${count} closed-but-not-archived issue(s) (under threshold)`,
        observed_state: `closed_not_archived_count=${count}`,
      };
    }
    return {
      ...base,
      status: "warning",
      severity: "warning",
      message: `${count} closed issue(s) not yet archived`,
      detail:
        "Archive completed work to keep the active board uncluttered. Linear's auto-archive setting (Settings → Workspace) can automate this.",
      fix: "Archive in bulk: list closed issues with `linear issues list --status closed --all` then `linear issues archive <id>`.",
      observed_state: `closed_not_archived_count=${count}`,
    };
  } catch (e) {
    return {
      ...base,
      status: "error",
      severity: "error",
      message: "closed-not-archived query failed",
      detail: (e as Error).message,
    };
  }
}

/**
 * Hygiene check: open issues whose parent has been archived (Linear
 * preserves parentId after archive, so children can be left stranded
 * with a tombstone parent). lin-hqiz.
 */
async function checkBrokenParentEdges(
  client: GraphQLClient,
): Promise<DoctorCheck> {
  const base = {
    name: "broken_parent_edges",
    category: "hygiene",
    expected_state:
      "0 open issues whose parent has been archived (no tombstone edges)",
    commands: ["linear issues list --has-blockers"],
  };
  try {
    const count = await pageCount(async (cursor) => {
      const r = await client.request<CountBrokenParentEdgesQuery>(
        CountBrokenParentEdgesDocument,
        { first: 100, after: cursor },
      );
      return {
        count: r.issues.nodes.length,
        hasNext: r.issues.pageInfo.hasNextPage,
        endCursor: r.issues.pageInfo.endCursor ?? null,
      };
    });
    if (count === 0) {
      return {
        ...base,
        status: "ok",
        severity: "info",
        message: "No open issues whose parent has been archived",
        observed_state: "broken_parent_count=0",
      };
    }
    return {
      ...base,
      status: "warning",
      severity: "warning",
      message: `${count} open issue(s) whose parent has been archived`,
      detail:
        "Linear preserves the parentId reference after archive, so a child can end up with a tombstone parent — confusing for tree views and reports.",
      fix: "Reassign the children to a live parent (`linear issues update <child> --parent <new-parent>`) or close them out.",
      observed_state: `broken_parent_count=${count}`,
    };
  } catch (e) {
    return {
      ...base,
      status: "error",
      severity: "error",
      message: "broken-parent-edges query failed",
      detail: (e as Error).message,
    };
  }
}

/**
 * Hygiene check: stale non-terminal issues scoped to the configured
 * `team.default` (skipped when no default team is set). Complements the
 * workspace-wide `stale` check by surfacing what's neglected inside the
 * user's primary team, which is the hygiene smell hygiene-keeper agents
 * actually care about. lin-hqiz.
 */
async function checkStaleByTeamDefault(
  client: GraphQLClient,
  staleDays: number,
  defaultTeam?: DefaultTeamContext,
): Promise<DoctorCheck | null> {
  if (!defaultTeam) return null;
  const teamName = defaultTeam.name;
  const base = {
    name: "stale_by_team_default",
    category: "hygiene",
    expected_state: `0 non-terminal issues in team.default older than ${staleDays} days`,
    commands: [
      `linear issues stale --days ${staleDays}`,
      "linear config get team.default",
    ],
  };
  if (defaultTeam.resolutionError) {
    // Stale config (team.default points at a deleted/renamed team) is a
    // hygiene smell, not a workspace-health failure — downgrade to
    // warning so `overall_ok` reflects the actual workspace state.
    return {
      ...base,
      status: "warning",
      severity: "warning",
      message: `Could not resolve team.default '${teamName}'`,
      detail: defaultTeam.resolutionError,
      fix: "Run `linear teams list` and `linear config set team.default <key>` with a valid team key.",
    };
  }
  if (!defaultTeam.id) return null;
  const teamId = defaultTeam.id;
  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString();
  try {
    const count = await pageCount(async (cursor) => {
      const r = await client.request<CountStaleIssuesInTeamQuery>(
        CountStaleIssuesInTeamDocument,
        { teamId, cutoff, first: 100, after: cursor },
      );
      return {
        count: r.issues.nodes.length,
        hasNext: r.issues.pageInfo.hasNextPage,
        endCursor: r.issues.pageInfo.endCursor ?? null,
      };
    });
    if (count === 0) {
      return {
        ...base,
        status: "ok",
        severity: "info",
        message: `No stale issues in team.default (${teamName})`,
        observed_state: `team=${teamName} stale_count=0`,
      };
    }
    return {
      ...base,
      status: "warning",
      severity: "warning",
      message: `${count} stale non-terminal issue(s) in team.default (${teamName})`,
      detail: `Issues in ${teamName} that have gone quiet for ${staleDays}+ days.`,
      fix: `Triage with \`linear issues stale --days ${staleDays}\` (auto-scoped to team.default).`,
      observed_state: `team=${teamName} stale_count=${count}`,
    };
  } catch (e) {
    return {
      ...base,
      status: "error",
      severity: "error",
      message: "Team-scoped stale-issue query failed",
      detail: (e as Error).message,
    };
  }
}

export interface DefaultTeamContext {
  name: string;
  id?: string;
  resolutionError?: string;
}

export interface ScopeProjectContext {
  name: string;
  id?: string;
  resolutionError?: string;
}

export interface RunDoctorOpts {
  client: GraphQLClient;
  /** Team-default resolution is performed by the command/resolver layer. */
  defaultTeam?: DefaultTeamContext;
  /** Defaults to `process.cwd()`. Also used to locate `.claude/settings.json`. */
  cwd?: string;
  /**
   * Home directory used to locate `~/.claude/settings.json` for the
   * integration-health checks. Defaults to the OS home dir; injectable
   * so tests don't depend on the developer's real `~/.claude/`.
   */
  home?: string;
  /**
   * Override the PATH string the `cli_in_path` check searches. Defaults
   * to `process.env.PATH`. Injectable for deterministic tests.
   */
  pathEnv?: string;
  /** Defaults to `2026.4.9` (package version, injected by command layer). */
  cliVersion: string;
  /** Defaults to 30. */
  staleDays?: number;
  /** Defaults to `[]` (no convention enforced). */
  requiredLabels?: string[];
  /** Optionally restrict to a single check by name. */
  only?: CheckName;
  /**
   * Default `false` means only warnings/errors are kept in the returned
   * `checks` array (with `suppressed_count` tracking the hidden ok-checks).
   * Pass `true` to keep every check.
   */
  verbose?: boolean;
  /**
   * Optional resolved scope (label + team + project) for the scope checks.
   * Defaults to `getActiveScope()` so tests can inject deterministic
   * values without touching real config files.
   */
  scope?: ActiveScope;
  /** Project-name resolution context supplied by the command layer. */
  scopeProject?: ScopeProjectContext;
  /**
   * Set of suppressed check slugs (e.g. `{"closed-not-archived"}`). When a
   * check would emit a WARNING and its slug is in this set, the check is
   * omitted from `checks` but counted in `suppressed_count`. Errors and ok
   * checks always show. Defaults to `getSuppressedDoctorChecks()` so tests
   * can inject deterministic values without touching real config files.
   * lin-k5nx.
   */
  suppress?: Set<string>;
}

export async function runDoctor(opts: RunDoctorOpts): Promise<DoctorResult> {
  const allChecks: DoctorCheck[] = [];
  const filter = opts.only;
  const staleDays = opts.staleDays ?? DEFAULT_DOCTOR_STALE_DAYS;
  const required = opts.requiredLabels ?? [];

  if (!filter || filter === "auth") {
    allChecks.push(await checkAuth(opts.client));
  }
  if (!filter || filter === "stale") {
    allChecks.push(await checkStale(opts.client, staleDays));
  }
  if (!filter || filter === "unassigned") {
    allChecks.push(await checkUnassigned(opts.client));
  }
  if (!filter || filter === "labels") {
    allChecks.push(await checkLabels(opts.client, required));
  }

  const scope = opts.scope ?? getActiveScope();
  if (!filter || filter === "scope_label_exists") {
    const c = await checkScopeLabelExists(opts.client, scope);
    if (c) allChecks.push(c);
  }
  if (!filter || filter === "scope_drift") {
    const c = checkScopeDrift(scope);
    if (c) allChecks.push(c);
  }
  if (!filter || filter === "scope_coverage") {
    const c = await checkScopeCoverage(opts.client, scope, opts.scopeProject);
    if (c) allChecks.push(c);
  }

  // lin-hqiz: hygiene-category checks beyond the auth/stale/orphans
  // baseline. closed_not_archived and broken_parent_edges run unconditionally;
  // stale_by_team_default only emits a check when team.default is set
  // (returns null otherwise so the JSON shape stays clean).
  if (!filter || filter === "closed_not_archived") {
    allChecks.push(await checkClosedNotArchived(opts.client));
  }
  if (!filter || filter === "broken_parent_edges") {
    allChecks.push(await checkBrokenParentEdges(opts.client));
  }
  if (!filter || filter === "stale_by_team_default") {
    const c = await checkStaleByTeamDefault(
      opts.client,
      staleDays,
      opts.defaultTeam,
    );
    if (c) allChecks.push(c);
  }

  // lin-i79e: integration-health checks (Claude plugin/settings/hooks, CLI
  // on PATH). These are synchronous filesystem/PATH probes composed by the
  // doctor agent service. They share the same DoctorCheck/ZFC shape as the
  // workspace checks above, so the command layer's --agent strip applies
  // uniformly. `resolveAgentChecks` returns [] for non-agent `only` names,
  // so passing the workspace filter through here is harmless.
  for (const c of resolveAgentChecks({
    only: filter,
    cwd: opts.cwd,
    home: opts.home,
    pathEnv: opts.pathEnv,
  })) {
    allChecks.push(c);
  }

  // lin-ktsk: guarantee every check carries non-empty ZFC fields
  // (observed_state, expected_state, explanation, commands, severity) on
  // every path. The checks above populate these inline but inconsistently;
  // `enrichCheck` backfills any blanks so --agent output is uniform.
  const enriched = allChecks.map(enrichCheck);

  // overall_ok is computed before any suppression. Errors are never
  // suppressed (suppression only hides warnings), so this never changes
  // when a warning is hidden — but computing it here keeps it independent
  // of the visibility/suppression filters below.
  const overall_ok = enriched.every((c) => c.status !== "error");

  // lin-k5nx: per-check warning suppression. A check whose slug is in the
  // suppress set AND whose status is `warning` is omitted but counted.
  // Errors and ok checks always pass through.
  const suppress = opts.suppress ?? getSuppressedDoctorChecks();
  let warningSuppressedCount = 0;
  const afterSuppress = enriched.filter((c) => {
    if (
      c.status === "warning" &&
      suppress.has(checkNameToSuppressSlug(c.name))
    ) {
      warningSuppressedCount += 1;
      return false;
    }
    return true;
  });

  // Default (non-verbose) view hides ok-checks; verbose keeps them. The
  // suppressed_count field reports *both* hidden ok-checks and suppressed
  // warnings so `linear doctor` can surface a single "N suppressed" note.
  const visible = opts.verbose
    ? afterSuppress
    : afterSuppress.filter((c) => c.status !== "ok");
  const okHiddenCount = afterSuppress.length - visible.length;
  const suppressed_count = okHiddenCount + warningSuppressedCount;

  return {
    path: opts.cwd ?? process.cwd(),
    checks: visible,
    overall_ok,
    cli_version: opts.cliVersion,
    timestamp: new Date().toISOString(),
    platform: { key: "linear" },
    suppressed_count,
  };
}
