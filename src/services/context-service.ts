/**
 * `linear context` — show the effective Linear identity.
 *
 * Answers the *Linear-Composite* question: which workspace + which default
 * team does the configured token resolve to?
 *
 * Differs from `linear where`:
 *   • `where` is filesystem-first (offline by default); reports paths.
 *   • `context` is Linear-first (always online); reports identity.
 *
 * Composition:
 *   1. `viewer` + `organization` — workspace + user identity (1 round-trip
 *      via the shared `GetViewerWithOrg` document).
 *   2. teams lookup — if `team.default` is set in config, resolve it via
 *      `GetTeamByKey` to confirm validity. Soft-fails to `null` on miss.
 *
 * Errors bubble into a top-level `errors[]` instead of throwing, mirroring
 * `info`'s partial-failure pattern — a degraded `context` is more useful
 * than a hard error.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import { getConfigPath, getDefaultTeam } from "../common/config-store.js";
import {
  GetTeamByKeyDocument,
  type GetTeamByKeyQuery,
  GetViewerWithOrgDocument,
  type GetViewerWithOrgQuery,
} from "../gql/graphql.js";

export interface ContextViewer {
  id: string;
  name: string;
  email: string;
}

export interface ContextWorkspace {
  id: string;
  name: string;
  url_key: string;
}

export interface ContextTeam {
  /** The raw value read from `config get team.default`; null if unset. */
  configured: string | null;
  /** Linear team resolved from `configured`; null if unset or not found. */
  resolved: { id: string; key: string; name: string } | null;
  /** Populated when the configured key was set but did not resolve. */
  error?: string;
}

export interface ContextResult {
  cli_version: string;
  /** Always "linear" — kept stable so JSON consumers can rely on the field. */
  backend: "linear";
  config_path: string;
  workspace: ContextWorkspace | null;
  viewer: ContextViewer | null;
  default_team: ContextTeam;
  errors?: string[];
}

export interface RunContextOpts {
  client: GraphQLClient;
  cliVersion: string;
  /** Inject env for tests; production reads `process.env` via getConfig. */
  env?: NodeJS.ProcessEnv;
}

async function resolveDefaultTeam(
  client: GraphQLClient,
  key: string,
): Promise<NonNullable<ContextTeam["resolved"]> | { error: string }> {
  try {
    const r = await client.request<GetTeamByKeyQuery>(GetTeamByKeyDocument, {
      key,
    });
    const node = r.teams.nodes[0];
    if (!node) return { error: `no team with key "${key}"` };
    return { id: node.id, key: node.key, name: node.name };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function runContext(opts: RunContextOpts): Promise<ContextResult> {
  const errors: string[] = [];

  let viewer: ContextViewer | null = null;
  let workspace: ContextWorkspace | null = null;
  try {
    const r = await opts.client.request<GetViewerWithOrgQuery>(
      GetViewerWithOrgDocument,
    );
    viewer = { id: r.viewer.id, name: r.viewer.name, email: r.viewer.email };
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

  // Phase 9: prefer `scope.team` (local) over legacy `team.default`
  // (global). `getDefaultTeam` already encodes the precedence
  // env > scope.team(local) > team.default(global).
  const configured = getDefaultTeam(opts.env);
  let defaultTeam: ContextTeam = { configured, resolved: null };
  if (configured) {
    const r = await resolveDefaultTeam(opts.client, configured);
    if ("error" in r) {
      defaultTeam = { configured, resolved: null, error: r.error };
    } else {
      defaultTeam = { configured, resolved: r };
    }
  }

  const result: ContextResult = {
    cli_version: opts.cliVersion,
    backend: "linear",
    config_path: getConfigPath(),
    workspace,
    viewer,
    default_team: defaultTeam,
  };
  if (errors.length > 0) result.errors = errors;
  return result;
}
