/**
 * `linear preflight` — workspace pre-PR readiness checks.
 *
 * A quick pre-push readiness check targeting the Linear workspace the
 * agent is operating against:
 *
 *  - `Auth valid`: the configured token resolves a `viewer`.
 *  - `Stale issues`: count of non-terminal issues with `updatedAt` older
 *    than `--stale-days` (default 30). Reported as a warning, not a hard
 *    failure — a stale backlog is a smell, not a blocker.
 *  - `Triage queue`: count of issues sitting in any `triage`-type state.
 *    Reported as a warning if non-zero.
 *
 * Emits a stable `PreflightResult` JSON shape under `--check --json`. The
 * default (no `--check`) prints a human-readable checklist; this is the
 * only command in linear that intentionally emits non-JSON by default.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import {
  CountBrokenParentEdgesDocument,
  type CountBrokenParentEdgesQuery,
  CountClosedNotArchivedDocument,
  type CountClosedNotArchivedQuery,
  CountStaleIssuesDocument,
  type CountStaleIssuesQuery,
  CountTriageIssuesDocument,
  type CountTriageIssuesQuery,
} from "../gql/graphql.js";
import { validateToken } from "./auth-service.js";

export interface PreflightCheck {
  name: string;
  passed: boolean;
  skipped?: boolean;
  warning?: boolean;
  output?: string;
  command: string;
}

export interface PreflightResult {
  checks: PreflightCheck[];
  passed: boolean;
  summary: string;
}

export const DEFAULT_STALE_DAYS = 30;

const CHECK_AUTH = "Auth valid";
const CHECK_STALE = "No stale issues";
const CHECK_TRIAGE = "Triage queue clear";
const CHECK_CLOSED_NOT_ARCHIVED = "Closed issues archived";
const CHECK_BROKEN_PARENT = "No broken parent edges";

export const PREFLIGHT_CHECK_NAMES = [
  CHECK_AUTH,
  CHECK_STALE,
  CHECK_TRIAGE,
  CHECK_CLOSED_NOT_ARCHIVED,
  CHECK_BROKEN_PARENT,
] as const;

// lin-hqiz: keep this preflight threshold in line with doctor's
// CLOSED_NOT_ARCHIVED_WARN_THRESHOLD so the two commands agree on what
// "too many" means.
const CLOSED_NOT_ARCHIVED_WARN_THRESHOLD = 50;

const CHECK_SLUGS: Record<string, string> = {
  auth: CHECK_AUTH,
  stale: CHECK_STALE,
  triage: CHECK_TRIAGE,
  archived: CHECK_CLOSED_NOT_ARCHIVED,
  closed_not_archived: CHECK_CLOSED_NOT_ARCHIVED,
  parent: CHECK_BROKEN_PARENT,
  broken_parent_edges: CHECK_BROKEN_PARENT,
};

/**
 * Normalize a free-form skip token (case-insensitive name or short slug)
 * to a canonical check name. Returns `null` for unknown tokens so the
 * caller can surface a friendly error.
 */
export function resolveSkipName(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  if (CHECK_SLUGS[lower]) return CHECK_SLUGS[lower];
  for (const name of PREFLIGHT_CHECK_NAMES) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

export function formatChecklist(): string {
  const lines = [
    "Linear Workspace Readiness Checklist:",
    "",
    "[ ] Auth valid: linear auth status",
    "[ ] No stale issues (updatedAt > 30 days, non-terminal)",
    "[ ] Triage queue empty (no issues in triage state)",
    "[ ] Closed issues archived (< 50 closed-but-not-archived)",
    "[ ] No broken parent edges (no open issues with archived parent)",
    "",
    "Run 'linear preflight --check' to validate automatically.",
  ];
  return lines.join("\n");
}

async function pageCountIssues(
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

async function countStaleIssues(
  client: GraphQLClient,
  cutoff: string,
): Promise<number> {
  return pageCountIssues(async (cursor) => {
    const res = await client.request<CountStaleIssuesQuery>(
      CountStaleIssuesDocument,
      { cutoff, first: 100, after: cursor },
    );
    return {
      count: res.issues.nodes.length,
      hasNext: res.issues.pageInfo.hasNextPage,
      endCursor: res.issues.pageInfo.endCursor ?? null,
    };
  });
}

async function countTriageIssues(client: GraphQLClient): Promise<number> {
  return pageCountIssues(async (cursor) => {
    const res = await client.request<CountTriageIssuesQuery>(
      CountTriageIssuesDocument,
      { first: 100, after: cursor },
    );
    return {
      count: res.issues.nodes.length,
      hasNext: res.issues.pageInfo.hasNextPage,
      endCursor: res.issues.pageInfo.endCursor ?? null,
    };
  });
}

async function countClosedNotArchived(client: GraphQLClient): Promise<number> {
  return pageCountIssues(async (cursor) => {
    const res = await client.request<CountClosedNotArchivedQuery>(
      CountClosedNotArchivedDocument,
      { first: 100, after: cursor },
    );
    return {
      count: res.issues.nodes.length,
      hasNext: res.issues.pageInfo.hasNextPage,
      endCursor: res.issues.pageInfo.endCursor ?? null,
    };
  });
}

async function countBrokenParentEdges(client: GraphQLClient): Promise<number> {
  return pageCountIssues(async (cursor) => {
    const res = await client.request<CountBrokenParentEdgesQuery>(
      CountBrokenParentEdgesDocument,
      { first: 100, after: cursor },
    );
    return {
      count: res.issues.nodes.length,
      hasNext: res.issues.pageInfo.hasNextPage,
      endCursor: res.issues.pageInfo.endCursor ?? null,
    };
  });
}

async function runAuthCheck(client: GraphQLClient): Promise<PreflightCheck> {
  const command = "linear auth status";
  try {
    const viewer = await validateToken(client);
    return {
      name: CHECK_AUTH,
      passed: true,
      output: `Authenticated as ${viewer.name} <${viewer.email}>`,
      command,
    };
  } catch (e) {
    return {
      name: CHECK_AUTH,
      passed: false,
      output: (e as Error).message,
      command,
    };
  }
}

async function runStaleCheck(
  client: GraphQLClient,
  staleDays: number,
): Promise<PreflightCheck> {
  const command = `linear issues list --updated-before ${staleDays}d`;
  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString();
  try {
    const count = await countStaleIssues(client, cutoff);
    if (count === 0) {
      return {
        name: CHECK_STALE,
        passed: true,
        output: `No non-terminal issues older than ${staleDays} days`,
        command,
      };
    }
    return {
      name: CHECK_STALE,
      passed: false,
      warning: true,
      output: `${count} non-terminal issue(s) not updated in ${staleDays}+ days`,
      command,
    };
  } catch (e) {
    return {
      name: CHECK_STALE,
      passed: false,
      output: (e as Error).message,
      command,
    };
  }
}

async function runTriageCheck(client: GraphQLClient): Promise<PreflightCheck> {
  const command = "linear issues list --state triage";
  try {
    const count = await countTriageIssues(client);
    if (count === 0) {
      return {
        name: CHECK_TRIAGE,
        passed: true,
        output: "Triage queue empty",
        command,
      };
    }
    return {
      name: CHECK_TRIAGE,
      passed: false,
      warning: true,
      output: `${count} issue(s) sitting in triage state`,
      command,
    };
  } catch (e) {
    return {
      name: CHECK_TRIAGE,
      passed: false,
      output: (e as Error).message,
      command,
    };
  }
}

async function runClosedNotArchivedCheck(
  client: GraphQLClient,
): Promise<PreflightCheck> {
  const command = "linear issues list --status closed --all";
  try {
    const count = await countClosedNotArchived(client);
    if (count < CLOSED_NOT_ARCHIVED_WARN_THRESHOLD) {
      return {
        name: CHECK_CLOSED_NOT_ARCHIVED,
        passed: true,
        output: `${count} closed-but-not-archived issue(s) (under threshold)`,
        command,
      };
    }
    return {
      name: CHECK_CLOSED_NOT_ARCHIVED,
      passed: false,
      warning: true,
      output: `${count} closed issue(s) not yet archived (threshold: ${CLOSED_NOT_ARCHIVED_WARN_THRESHOLD})`,
      command,
    };
  } catch (e) {
    return {
      name: CHECK_CLOSED_NOT_ARCHIVED,
      passed: false,
      output: (e as Error).message,
      command,
    };
  }
}

async function runBrokenParentCheck(
  client: GraphQLClient,
): Promise<PreflightCheck> {
  const command = "linear orphans";
  try {
    const count = await countBrokenParentEdges(client);
    if (count === 0) {
      return {
        name: CHECK_BROKEN_PARENT,
        passed: true,
        output: "No open issues with archived parents",
        command,
      };
    }
    return {
      name: CHECK_BROKEN_PARENT,
      passed: false,
      warning: true,
      output: `${count} open issue(s) whose parent has been archived`,
      command,
    };
  } catch (e) {
    return {
      name: CHECK_BROKEN_PARENT,
      passed: false,
      output: (e as Error).message,
      command,
    };
  }
}

export interface RunPreflightChecksOpts {
  client: GraphQLClient;
  staleDays?: number;
  skip?: Set<string>;
}

/**
 * Run all preflight checks against the workspace. Skipped checks are
 * recorded with `skipped: true` so the JSON output preserves shape.
 * `passed` is true iff every non-skipped, non-warning check passed.
 */
export async function runPreflightChecks(
  opts: RunPreflightChecksOpts,
): Promise<PreflightResult> {
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const skip = opts.skip ?? new Set<string>();
  const checks: PreflightCheck[] = [];

  const definitions: {
    name: string;
    command: string;
    run: () => Promise<PreflightCheck>;
  }[] = [
    {
      name: CHECK_AUTH,
      command: "linear auth status",
      run: () => runAuthCheck(opts.client),
    },
    {
      name: CHECK_STALE,
      command: `linear issues list --updated-before ${staleDays}d`,
      run: () => runStaleCheck(opts.client, staleDays),
    },
    {
      name: CHECK_TRIAGE,
      command: "linear issues list --state triage",
      run: () => runTriageCheck(opts.client),
    },
    {
      name: CHECK_CLOSED_NOT_ARCHIVED,
      command: "linear issues list --status closed --all",
      run: () => runClosedNotArchivedCheck(opts.client),
    },
    {
      name: CHECK_BROKEN_PARENT,
      command: "linear orphans",
      run: () => runBrokenParentCheck(opts.client),
    },
  ];

  for (const def of definitions) {
    if (skip.has(def.name)) {
      checks.push({
        name: def.name,
        passed: false,
        skipped: true,
        warning: true,
        output: `${def.name} skipped via --skip`,
        command: def.command,
      });
      continue;
    }
    checks.push(await def.run());
  }

  let passCount = 0;
  let skipCount = 0;
  let warnCount = 0;
  let allPassed = true;
  for (const c of checks) {
    if (c.skipped) {
      skipCount += 1;
    } else if (c.warning) {
      warnCount += 1;
    } else if (c.passed) {
      passCount += 1;
    } else {
      allPassed = false;
    }
  }

  const runCount = checks.length - skipCount;
  let summary = `${passCount}/${runCount} checks passed`;
  if (warnCount > 0) summary += `, ${warnCount} warning(s)`;
  if (skipCount > 0) summary += ` (${skipCount} skipped)`;

  return { checks, passed: allPassed, summary };
}
