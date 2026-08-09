import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getGitTopLevel } from "./git-remote.js";

export type ConfigMap = Record<string, string>;

const DIR_NAME = ".linear";
const FILE_NAME = "config.json";
const LOCAL_DIR_NAME = ".linear";
const LOCAL_FILE_NAME = "config.json";
const REDACTED_CONFIG_VALUE = "[REDACTED]";
const SENSITIVE_CONFIG_KEYS = new Set(["linear.api_token"]);

/**
 * Which physical config file a read or write targets.
 *
 *   - "global" → `~/.linear/config.json`   (per-user; legacy single layer)
 *   - "local"  → `<repo-root>/.linear/config.json` (per-repo; added for the
 *               implicit scope feature)
 *
 * The merged view applies precedence env > local > global > default; callers
 * who want to pin to one layer pass `{ layer }`.
 */
export type ConfigLayer = "local" | "global";

/**
 * Per-key env var override map. Certain config keys can be overridden by
 * setting the corresponding env var, which takes precedence over the
 * on-disk value. Keep this conservative — env overrides surprise readers,
 * so opt in per-key.
 */
const ENV_OVERRIDES: Record<string, string> = {
  "linear.api_token": "LINEAR_API_TOKEN",
  "linear.endpoint": "LINEAR_ENDPOINT",
  "team.default": "LINEAR_TEAM",
  "linear.last_seen_version": "LINEAR_LAST_SEEN_VERSION",
};

/**
 * Config key under which the `upgrade` family records the last CLI version
 * the user has acknowledged. Linear keeps it in `~/.linear/config.json`.
 * Overridable via `LINEAR_LAST_SEEN_VERSION` for tests / scripted runs.
 */
export const LAST_SEEN_VERSION_KEY = "linear.last_seen_version";

export type ValueSource = "env" | "local" | "global" | "default";

export interface ResolvedValue {
  key: string;
  value: string;
  source: ValueSource;
}

/**
 * Raised when a `local`-layer write is attempted from a cwd that is not
 * inside a git repository. Callers (typically the `linear config` command)
 * should catch this and either fall back to global or surface a clear
 * error to the user.
 */
export class LocalConfigUnavailableError extends Error {
  constructor() {
    super(
      "local config requires a git repository (no .git toplevel from current directory)",
    );
    this.name = "LocalConfigUnavailableError";
  }
}

export function getGlobalConfigDir(): string {
  return path.join(os.homedir(), DIR_NAME);
}

export function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), FILE_NAME);
}

/**
 * Returns the per-repo config file path when invoked from inside a git
 * repository, otherwise `null`. The directory is *not* created; callers
 * that need it use `writeAll(.., "local")` which creates the parent
 * lazily on first write.
 */
export function findLocalConfigPath(): string | null {
  const top = getGitTopLevel();
  if (!top) return null;
  return path.join(top, LOCAL_DIR_NAME, LOCAL_FILE_NAME);
}

/**
 * Legacy exports kept so callers that target the global file by name
 * keep working without churn. New code should prefer the layer-aware
 * `getConfigDir(layer)` / `getConfigPath(layer)`.
 */
export function getConfigDir(layer: ConfigLayer = "global"): string {
  if (layer === "local") {
    const top = getGitTopLevel();
    if (!top) throw new LocalConfigUnavailableError();
    return path.join(top, LOCAL_DIR_NAME);
  }
  return getGlobalConfigDir();
}

export function getConfigPath(layer: ConfigLayer = "global"): string {
  return path.join(getConfigDir(layer), FILE_NAME);
}

function ensureDir(layer: ConfigLayer): void {
  const dir = getConfigDir(layer);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function readLayer(layer: ConfigLayer): ConfigMap {
  let file: string | null;
  if (layer === "local") {
    file = findLocalConfigPath();
    if (!file) return {};
  } else {
    file = getGlobalConfigPath();
  }
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8");
  if (raw.trim() === "") return {};
  return JSON.parse(raw) as ConfigMap;
}

/**
 * Read the raw key/value map for a single layer.
 *
 * Default layer = "global", matching pre-scope behavior so existing
 * callers continue to read `~/.linear/config.json`.
 */
export function readAll(layer: ConfigLayer = "global"): ConfigMap {
  return readLayer(layer);
}

function writeAll(pairs: ConfigMap, layer: ConfigLayer): void {
  ensureDir(layer);
  const file = getConfigPath(layer);
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(pairs, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
}

export function validateConfigKey(key: string): string | null {
  if (key === "") return "key cannot be empty";
  if (key.trim() === "") return "key cannot be only whitespace";
  if (key.includes("=")) return "key cannot contain '='";
  return null;
}

export interface LayerOpts {
  layer?: ConfigLayer;
}

export function setConfig(
  key: string,
  value: string,
  opts: LayerOpts = {},
): {
  key: string;
  value: string;
  action: "set" | "updated";
  layer: ConfigLayer;
} {
  const layer = opts.layer ?? "global";
  const pairs = readLayer(layer);
  const action = key in pairs ? "updated" : "set";
  pairs[key] = value;
  writeAll(pairs, layer);
  return {
    key,
    value: redactSensitiveConfigValue(key, value),
    action,
    layer,
  };
}

export function setManyConfig(
  pairs: Array<{ key: string; value: string }>,
  opts: LayerOpts = {},
): Array<{
  key: string;
  value: string;
  action: "set" | "updated";
  layer: ConfigLayer;
}> {
  const layer = opts.layer ?? "global";
  const existing = readLayer(layer);
  const results: Array<{
    key: string;
    value: string;
    action: "set" | "updated";
    layer: ConfigLayer;
  }> = [];
  for (const { key, value } of pairs) {
    const action = key in existing ? "updated" : "set";
    existing[key] = value;
    results.push({
      key,
      value: redactSensitiveConfigValue(key, value),
      action,
      layer,
    });
  }
  writeAll(existing, layer);
  return results;
}

export interface GetConfigResult {
  key: string;
  value: string | null;
  found: boolean;
  source: ValueSource;
}

/**
 * Resolve a config key.
 *
 *   - When `opts.layer` is given, reads only that layer (env still wins
 *     for keys in `ENV_OVERRIDES` since env precedence is unconditional).
 *   - When omitted, applies the full precedence: env > local > global >
 *     default.
 */
export function getConfig(
  key: string,
  env?: NodeJS.ProcessEnv,
  opts: LayerOpts = {},
): GetConfigResult {
  const envName = ENV_OVERRIDES[key];
  const effEnv = env ?? process.env;
  if (envName && effEnv[envName] !== undefined && effEnv[envName] !== "") {
    return {
      key,
      value: effEnv[envName] ?? null,
      found: true,
      source: "env",
    };
  }

  if (opts.layer) {
    const pairs = readLayer(opts.layer);
    if (key in pairs) {
      return { key, value: pairs[key], found: true, source: opts.layer };
    }
    return { key, value: null, found: false, source: "default" };
  }

  const local = readLayer("local");
  if (key in local) {
    return { key, value: local[key], found: true, source: "local" };
  }
  const global = readLayer("global");
  if (key in global) {
    return { key, value: global[key], found: true, source: "global" };
  }
  return { key, value: null, found: false, source: "default" };
}

/** Return the configured Linear GraphQL endpoint, if one is set. */
export function getLinearEndpoint(env?: NodeJS.ProcessEnv): string | undefined {
  const result = getConfig("linear.endpoint", env);
  return result.found && result.value ? result.value : undefined;
}

/**
 * Resolve the user's default team key.
 *
 * Precedence:
 *   1. `LINEAR_TEAM` env var (via `team.default` ENV_OVERRIDES).
 *   2. `scope.team` in the local layer (per-repo override).
 *   3. `team.default` in the local layer.
 *   4. `team.default` in the global layer.
 *
 * Returns `null` when nothing is set. Callers pass the result through
 * `resolveTeamId` which handles key/name/UUID disambiguation.
 */
export function getDefaultTeam(env?: NodeJS.ProcessEnv): string | null {
  const effEnv = env ?? process.env;
  const envName = ENV_OVERRIDES["team.default"];
  if (envName && effEnv[envName] !== undefined && effEnv[envName] !== "") {
    return effEnv[envName] ?? null;
  }

  const scopeTeam = readLayer("local")["scope.team"];
  if (scopeTeam) return scopeTeam;

  const r = getConfig("team.default", env);
  return r.found ? r.value : null;
}

/**
 * Where a resolved default-team value came from, for provenance hints like
 * `(team: ENG [from scope.team])`. `null` when nothing is set anywhere.
 */
export type DefaultTeamSource =
  | "LINEAR_TEAM"
  | "scope.team"
  | "team.default"
  | null;

export interface DefaultTeamResult {
  value: string | null;
  source: DefaultTeamSource;
}

/**
 * Provenance-aware variant of {@link getDefaultTeam}: returns the resolved
 * value AND the layer/key it came from, so `issues create` can tell the user
 * *why* a team was chosen when `--team` was omitted (surfaces the resolution
 * source). Precedence is identical to `getDefaultTeam`.
 */
export function getDefaultTeamWithSource(
  env?: NodeJS.ProcessEnv,
): DefaultTeamResult {
  const effEnv = env ?? process.env;
  const envName = ENV_OVERRIDES["team.default"];
  if (envName && effEnv[envName] !== undefined && effEnv[envName] !== "") {
    return { value: effEnv[envName] ?? null, source: "LINEAR_TEAM" };
  }

  const scopeTeam = readLayer("local")["scope.team"];
  if (scopeTeam) return { value: scopeTeam, source: "scope.team" };

  const r = getConfig("team.default", env);
  if (r.found) return { value: r.value, source: "team.default" };
  return { value: null, source: null };
}

export function unsetConfig(key: string, opts: LayerOpts = {}): boolean {
  const layer = opts.layer ?? "global";
  const pairs = readLayer(layer);
  if (!(key in pairs)) return false;
  delete pairs[key];
  writeAll(pairs, layer);
  return true;
}

/**
 * List keys present in a single layer, sorted alphabetically. Known secret
 * values are redacted because this projection is emitted by a bulk command;
 * `getConfig` remains the explicit raw-value API.
 *
 * Default layer = "global" so the legacy `linear config list` text view
 * matches its pre-scope shape; pass `{ layer: "local" }` to list a
 * specific repo's config.
 */
export function listConfig(opts: LayerOpts = {}): ConfigMap {
  const layer = opts.layer ?? "global";
  const pairs = readLayer(layer);
  const sorted: ConfigMap = {};
  for (const k of Object.keys(pairs).sort()) {
    sorted[k] = redactSensitiveConfigValue(k, pairs[k]);
  }
  return sorted;
}

function redactSensitiveConfigValue(key: string, value: string): string {
  return SENSITIVE_CONFIG_KEYS.has(key) ? REDACTED_CONFIG_VALUE : value;
}

/**
 * Returns every effective config key with its provenance. Merges env +
 * local + global layers, with precedence env > local > global. The
 * `source` field tells callers (and the `linear config show` table) which
 * layer the value ultimately came from. Known secret values are redacted
 * without changing that provenance.
 */
export function showConfig(env?: NodeJS.ProcessEnv): ResolvedValue[] {
  const local = readLayer("local");
  const global = readLayer("global");
  const effEnv = env ?? process.env;

  const keys = new Set<string>([...Object.keys(local), ...Object.keys(global)]);
  for (const [k, envName] of Object.entries(ENV_OVERRIDES)) {
    if (effEnv[envName] !== undefined && effEnv[envName] !== "") {
      keys.add(k);
    }
  }

  const result: ResolvedValue[] = [];
  for (const key of [...keys].sort()) {
    const envName = ENV_OVERRIDES[key];
    if (envName && effEnv[envName] !== undefined && effEnv[envName] !== "") {
      result.push({
        key,
        value: redactSensitiveConfigValue(key, effEnv[envName] ?? ""),
        source: "env",
      });
      continue;
    }
    if (key in local) {
      result.push({
        key,
        value: redactSensitiveConfigValue(key, local[key]),
        source: "local",
      });
      continue;
    }
    if (key in global) {
      result.push({
        key,
        value: redactSensitiveConfigValue(key, global[key]),
        source: "global",
      });
    }
  }
  return result;
}

/**
 * Config namespace for suppressing individual doctor warnings (lin-k5nx).
 * Users set keys like `doctor.suppress.closed-not-archived` = `"true"` to
 * hide a specific WARNING from `linear doctor`. The suppression prefix is
 * `doctor.suppress.`.
 */
export const DOCTOR_SUPPRESS_PREFIX = "doctor.suppress.";

/**
 * Convert a doctor check name into its config-friendly suppression slug.
 * Linear check names are already lower-snake (e.g. `closed_not_archived`);
 * the slug normalizes underscores to hyphens so the config key reads
 * `doctor.suppress.closed-not-archived` (e.g. "Git Hooks" → "git-hooks").
 */
export function checkNameToSuppressSlug(name: string): string {
  let slug = name.toLowerCase().replace(/[\s_]+/g, "-");
  while (slug.includes("--")) slug = slug.replace(/--/g, "-");
  return slug.replace(/^-+|-+$/g, "");
}

/**
 * Read the merged set of suppressed doctor check slugs across the local and
 * global layers. A key counts as suppressing when its value is the string
 * `"true"` (case-insensitive). Returns a `Set` of slugs (e.g.
 * `{"closed-not-archived"}`); empty when nothing is suppressed.
 *
 * Local-layer keys win over global by virtue of being merged last, matching
 * the env > local > global precedence the rest of the store uses (env is not
 * consulted here — suppression is a config-file feature, not env-driven).
 */
export function getSuppressedDoctorChecks(): Set<string> {
  const suppressed = new Set<string>();
  const effective = {
    ...readLayer("global"),
    ...readLayer("local"),
  };
  for (const [key, value] of Object.entries(effective)) {
    if (
      key.startsWith(DOCTOR_SUPPRESS_PREFIX) &&
      value.toLowerCase() === "true"
    ) {
      const slug = key.slice(DOCTOR_SUPPRESS_PREFIX.length);
      if (slug) suppressed.add(slug);
    }
  }
  return suppressed;
}

/**
 * Read the last CLI version the user has acknowledged via `linear upgrade ack`
 * (or had auto-recorded). Returns `""` when nothing is stored yet — the
 * first-run sentinel the `upgrade` service treats as "no previous version".
 *
 * Applies full precedence (env > local > global), so `LINEAR_LAST_SEEN_VERSION`
 * wins when set.
 */
export function getLastSeenVersion(env?: NodeJS.ProcessEnv): string {
  const r = getConfig(LAST_SEEN_VERSION_KEY, env);
  return r.found && r.value ? r.value : "";
}

/**
 * Record `version` as the last-seen CLI version. Writes to the global layer
 * by default (the per-user record) rather than a transient location.
 * Pass `{ layer: "local" }` to pin to a repo.
 */
export function setLastSeenVersion(
  version: string,
  opts: LayerOpts = {},
): void {
  setConfig(LAST_SEEN_VERSION_KEY, version, opts);
}
