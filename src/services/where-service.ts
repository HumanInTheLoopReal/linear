/**
 * `linear where` — surface every on-disk location linear reads or writes,
 * plus (optionally) the Linear workspace identity behind the configured token.
 *
 * The question is split in two:
 *
 *  1. local: where do the *side files* live (token, memory, audit log,
 *     snapshots)? Always answerable offline.
 *  2. remote: what workspace does the configured token resolve to? Opt-in
 *     via `--viewer`; offline by default.
 *
 * Output JSON keeps snake_case keys for stability. Callers that need a
 * "where is linear configured" probe should read this command's output
 * schema directly.
 */

import fs from "node:fs";
import type { GraphQLClient } from "../client/graphql-client.js";
import { getAuditPath } from "../common/audit-store.js";
import { resolveApiToken, type TokenSource } from "../common/auth.js";
import { findLocalConfigPath, getConfig } from "../common/config-store.js";
import { deriveScopeLabel } from "../common/git-remote.js";
import { getMemoryPath } from "../common/memory-store.js";
import { getTokenDir } from "../common/token-storage.js";
import { validateToken } from "./auth-service.js";
import { getSnapshotDir } from "./snapshot-service.js";

export interface WherePaths {
  token_dir: string;
  token_path: string;
  token_exists: boolean;
  memory_path: string;
  memory_exists: boolean;
  audit_path: string;
  audit_exists: boolean;
  snapshots_dir: string;
  snapshots_exists: boolean;
}

export interface WhereTokenInfo {
  /** `none` means no token was found in any source. */
  source: TokenSource | "none";
  resolved: boolean;
  /** Populated when token resolution failed; carries the error message. */
  error?: string;
}

export interface WhereViewer {
  id: string;
  name: string;
  email: string;
  organization?: { id: string; name: string; urlKey: string };
}

/**
 * Provenance for a single resolved scope value (team / project / label).
 *
 * Source/redirect reporting for `linear where`: each value records not
 * just what it resolved to but *where* that value came from, so an agent can
 * tell a per-repo override from an env hack from an unset default.
 *
 *   - `value`  — the resolved value, or `null` when nothing is set anywhere.
 *   - `source` — the layer the value came from: `env` > `local` > `global`,
 *                or `none` when unset. Comes straight from `getConfig`'s
 *                provenance (`default` is normalized to `none` here).
 *   - `key`    — the underlying config key (e.g. `scope.team`), so callers
 *                can render `[scope.team local]` or jump straight to
 *                `linear config get <key>`.
 */
export interface WhereScopeEntry {
  value: string | null;
  source: "env" | "local" | "global" | "none";
  key: string;
}

/**
 * Per-repo implicit-scope state, surfaced offline. `source` distinguishes:
 *   - `local`    — scope.label is set in `<repo>/.linear/config.json`
 *   - `global`   — scope.label is set in `~/.linear/config.json` (cross-repo
 *                  user default; rare but supported)
 *   - `env`      — overridden via `LINEAR_SCOPE_LABEL`
 *   - `derived`  — no config file set scope, but `deriveScopeLabel()` would
 *                  produce a value if a write triggered the bootstrap
 *   - `none`     — no scope active in any layer
 *
 * `resolved` carries the richer per-value provenance (team / project / label
 * each with its own source) used by the Scope section. The flat `label` /
 * `team` / `project` / `source` fields are retained for backward compatibility
 * with existing callers; new readers should prefer `resolved`.
 */
export interface WhereScope {
  label?: string;
  team?: string;
  project?: string;
  source: "local" | "global" | "env" | "derived" | "none";
  config_path?: string;
  resolved: {
    team: WhereScopeEntry;
    project: WhereScopeEntry;
    label: WhereScopeEntry;
  };
}

export interface WhereResult {
  cli_version: string;
  platform: { key: "linear" };
  cwd: string;
  paths: WherePaths;
  token: WhereTokenInfo;
  scope: WhereScope;
  viewer?: WhereViewer;
  viewer_error?: string;
}

export interface RunWhereOpts {
  cliVersion: string;
  /** Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * If true, hit the `viewer` query to confirm workspace identity. Default
   * `false` so `linear where` stays offline.
   */
  includeViewer?: boolean;
  /** Optional CLI flag value (--api-token); flows through `resolveApiToken`. */
  apiToken?: string;
  /**
   * Factory injected only by tests; production path constructs a client
   * via `createContext()` in the command layer.
   */
  makeClient?: (token: string) => GraphQLClient;
}

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Map a `getConfig` lookup to a per-value provenance entry. A value with no
 * source resolves to `none`; `default` collapses to `none` since it is not a
 * config-layer origin a user can edit.
 */
function toScopeEntry(
  lookup: { value?: string | null; source?: string },
  key: string,
): WhereScopeEntry {
  const value = lookup.value ?? null;
  const source: WhereScopeEntry["source"] = !value
    ? "none"
    : lookup.source === "env"
      ? "env"
      : lookup.source === "local"
        ? "local"
        : "global";
  return { value, source, key };
}

function gatherScope(env: NodeJS.ProcessEnv = process.env): WhereScope {
  const labelLookup = getConfig("scope.label", env);
  const teamLookup = getConfig("scope.team", env);
  const projectLookup = getConfig("scope.default_project", env);

  // Richer per-value provenance (team / project / label, each with its own
  // source) populated on every return path so the Scope section can render
  // `[scope.team local]`-style markers.
  const resolved = {
    team: toScopeEntry(teamLookup, "scope.team"),
    project: toScopeEntry(projectLookup, "scope.default_project"),
    label: toScopeEntry(labelLookup, "scope.label"),
  };

  if (labelLookup.value) {
    const source =
      labelLookup.source === "env"
        ? "env"
        : labelLookup.source === "local"
          ? "local"
          : "global";
    const result: WhereScope = { label: labelLookup.value, source, resolved };
    if (teamLookup.value) result.team = teamLookup.value;
    if (projectLookup.value) result.project = projectLookup.value;
    const localPath = findLocalConfigPath();
    if (localPath) result.config_path = localPath;
    return result;
  }

  const derived = deriveScopeLabel();
  if (derived) {
    return { label: derived.label, source: "derived", resolved };
  }
  return { source: "none", resolved };
}

function gatherPaths(): WherePaths {
  const tokenDir = getTokenDir();
  const tokenPath = `${tokenDir}/token`;
  const memoryPath = getMemoryPath();
  const auditPath = getAuditPath();
  const snapshotsDir = getSnapshotDir();
  return {
    token_dir: tokenDir,
    token_path: tokenPath,
    token_exists: safeExists(tokenPath),
    memory_path: memoryPath,
    memory_exists: safeExists(memoryPath),
    audit_path: auditPath,
    audit_exists: safeExists(auditPath),
    snapshots_dir: snapshotsDir,
    snapshots_exists: safeExists(snapshotsDir),
  };
}

export async function runWhere(opts: RunWhereOpts): Promise<WhereResult> {
  const paths = gatherPaths();

  let tokenInfo: WhereTokenInfo;
  let resolvedToken: string | undefined;
  try {
    const r = resolveApiToken({ apiToken: opts.apiToken });
    tokenInfo = { source: r.source, resolved: true };
    resolvedToken = r.token;
  } catch (e) {
    tokenInfo = {
      source: "none",
      resolved: false,
      error: (e as Error).message,
    };
  }

  const result: WhereResult = {
    cli_version: opts.cliVersion,
    platform: { key: "linear" },
    cwd: opts.cwd ?? process.cwd(),
    paths,
    token: tokenInfo,
    scope: gatherScope(),
  };

  if (opts.includeViewer && resolvedToken && opts.makeClient) {
    try {
      const client = opts.makeClient(resolvedToken);
      const viewer = await validateToken(client);
      result.viewer = {
        id: viewer.id,
        name: viewer.name,
        email: viewer.email,
      };
    } catch (e) {
      result.viewer_error = (e as Error).message;
    }
  } else if (opts.includeViewer && !resolvedToken) {
    result.viewer_error =
      "Cannot fetch viewer: no token resolved (see token.error).";
  }

  return result;
}
