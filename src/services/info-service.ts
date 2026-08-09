/**
 * `linear info` — workspace + CLI health snapshot.
 *
 * Answers the *workspace-shape* question: "what am I authenticated to,
 * and how much work does it contain?".
 *
 * Composition (Linear-Composite tier):
 *   - `viewer` + `organization` → user identity + workspace identity
 *   - `issues` filtered by terminal state types → non-terminal count
 *
 * The `--whats-new` flag emits a hardcoded blurb.
 *
 * Note: open-count pagination uses the same 100/page × 50-page guard as
 * `doctor` / `preflight`. For workspaces above ~5000 open issues the count
 * will saturate at the guard; that's preferable to a multi-second info call.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import {
  CountOpenIssuesDocument,
  type CountOpenIssuesQuery,
  GetViewerWithOrgDocument,
  type GetViewerWithOrgQuery,
} from "../gql/graphql.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export interface InfoViewer {
  id: string;
  name: string;
  email: string;
}

export interface InfoOrganization {
  id: string;
  name: string;
  url_key: string;
}

export interface InfoCounts {
  open: number;
  /** True when the workspace exceeds the pagination guard; `open` is then a lower bound. */
  open_saturated: boolean;
}

export interface InfoResult {
  cli_version: string;
  platform: { key: "linear" };
  workspace: InfoOrganization | null;
  viewer: InfoViewer | null;
  counts: InfoCounts;
  whats_new?: string;
  errors?: string[];
}

export interface RunInfoOpts {
  client: GraphQLClient;
  cliVersion: string;
  /** When true, include the local "what's new" blurb in the payload. */
  whatsNew?: boolean;
}

const WHATS_NEW_NOTE = [
  "linear is a CLI for Linear.app — human-readable text by default, with `--json` for agents. Recent commands worth knowing about:",
  "  • `linear doctor` — workspace health (auth/stale/unassigned/labels).",
  "  • `linear preflight` — fast pre-PR probe.",
  "  • `linear setup <recipe>` — install editor integration (cursor, claude, …).",
  "  • `linear where` — show on-disk linear locations and token source.",
  "  • `linear batch` — execute multiple ops from a script file.",
  "Run `linear usage --all` for the full surface area.",
].join("\n");

async function countOpenIssues(client: GraphQLClient): Promise<InfoCounts> {
  let total = 0;
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const r = await client.request<CountOpenIssuesQuery>(
      CountOpenIssuesDocument,
      { first: PAGE_SIZE, after: cursor },
    );
    total += r.issues.nodes.length;
    if (!r.issues.pageInfo.hasNextPage) {
      return { open: total, open_saturated: false };
    }
    cursor = r.issues.pageInfo.endCursor ?? undefined;
    if (!cursor) return { open: total, open_saturated: false };
  }
  return { open: total, open_saturated: true };
}

export async function runInfo(opts: RunInfoOpts): Promise<InfoResult> {
  const errors: string[] = [];

  let viewer: InfoViewer | null = null;
  let workspace: InfoOrganization | null = null;
  try {
    const r = await opts.client.request<GetViewerWithOrgQuery>(
      GetViewerWithOrgDocument,
    );
    viewer = {
      id: r.viewer.id,
      name: r.viewer.name,
      email: r.viewer.email,
    };
    if (r.viewer.organization) {
      workspace = {
        id: r.viewer.organization.id,
        name: r.viewer.organization.name,
        url_key: r.viewer.organization.urlKey,
      };
    }
  } catch (e) {
    errors.push(`viewer: ${(e as Error).message}`);
  }

  let counts: InfoCounts = { open: 0, open_saturated: false };
  try {
    counts = await countOpenIssues(opts.client);
  } catch (e) {
    errors.push(`counts: ${(e as Error).message}`);
  }

  const result: InfoResult = {
    cli_version: opts.cliVersion,
    platform: { key: "linear" },
    workspace,
    viewer,
    counts,
  };
  if (opts.whatsNew) result.whats_new = WHATS_NEW_NOTE;
  if (errors.length > 0) result.errors = errors;
  return result;
}
