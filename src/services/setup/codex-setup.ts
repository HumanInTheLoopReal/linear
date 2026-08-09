/**
 * Native-hooks leg of `linear setup codex`.
 *
 * The codex recipe in setup-service.ts installs the AGENTS.md managed section
 * and the agent-skill files. This module writes the two pieces left over:
 *
 *   1. `<root>/.codex/config.toml` carrying a `[features] hooks = true` flag.
 *      Parsed line by line so the CLI needs no TOML dependency.
 *   2. `<root>/.codex/hooks.json` carrying the four managed hook entries
 *      (SessionStart, PreCompact, PostCompact, UserPromptSubmit), each wired
 *      to `linear codex-hook <event>` and merged into whatever hooks the user
 *      already has.
 *
 * Both files are always written. There is no installed-plugin check that would
 * let this step be skipped.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Env var that overrides the Codex config root (`~/.codex` by default).
 * Defined locally to keep this module free of a circular import back into
 * setup-service.ts (which imports this module). Matches the
 * `CODEX_HOME_ENV_VAR` re-exported from setup-service.ts.
 */
const CODEX_HOME_ENV_VAR = "CODEX_HOME";

const CODEX_CONFIG_DIR = ".codex";
const CODEX_CONFIG_FILE = "config.toml";
const CODEX_HOOKS_FILE = "hooks.json";

/** Prefix every managed hook command shares — used to detect/strip our entries. */
export const CODEX_HOOK_COMMAND_PREFIX = "linear codex-hook ";

// ──────────────────────────────────────────────────────────────────────
// Path resolution (mirrors codexConfigRoot / codexConfigPath / codexHooksPath)
// ──────────────────────────────────────────────────────────────────────

function codexHomeDir(home: string): string {
  const env = process.env[CODEX_HOME_ENV_VAR];
  if (env && env.trim().length > 0) return env;
  return path.join(home, CODEX_CONFIG_DIR);
}

function codexConfigRoot(opts: { cwd: string; global: boolean }): string {
  if (opts.global) return codexHomeDir(os.homedir());
  return path.join(opts.cwd, CODEX_CONFIG_DIR);
}

export function codexConfigPath(opts: {
  cwd: string;
  global: boolean;
}): string {
  return path.join(codexConfigRoot(opts), CODEX_CONFIG_FILE);
}

export function codexHooksPath(opts: { cwd: string; global: boolean }): string {
  return path.join(codexConfigRoot(opts), CODEX_HOOKS_FILE);
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (dir && dir !== "." && dir !== "/") {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
}

// ──────────────────────────────────────────────────────────────────────
// config.toml [features] hooks = true (line-based, mirrors Go upsert/remove)
// ──────────────────────────────────────────────────────────────────────

function codexConfigLineKey(trimmed: string): string {
  if (trimmed === "" || trimmed.startsWith("#")) return "";
  const idx = trimmed.indexOf("=");
  if (idx === -1) return "";
  return trimmed.slice(0, idx).trim();
}

/**
 * Insert/normalize `hooks = true` inside the `[features]` table. Removes the
 * deprecated `codex_hooks` key, updates an existing `hooks = ...` line, and
 * creates the `[features]` table when absent. Line-based rather than a TOML
 * parse-and-serialize so the user's comments, key order, and formatting
 * survive the edit.
 */
export function upsertCodexHooksFeature(content: string): string {
  let lines = content.split("\n");
  let inFeatures = false;
  let featuresSeen = false;
  let flagSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inFeatures = trimmed === "[features]";
      if (inFeatures) featuresSeen = true;
      continue;
    }
    const key = codexConfigLineKey(trimmed);
    if (inFeatures && key === "codex_hooks") {
      lines[i] = "";
      continue;
    }
    if (inFeatures && key === "hooks") {
      lines[i] = "hooks = true";
      flagSeen = true;
    }
  }

  if (featuresSeen && !flagSeen) {
    const out: string[] = [];
    let inserted = false;
    inFeatures = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        if (inFeatures && !inserted) {
          out.push("hooks = true");
          inserted = true;
        }
        inFeatures = trimmed === "[features]";
      }
      if (line.trim() !== "") out.push(line);
    }
    if (inFeatures && !inserted) out.push("hooks = true");
    lines = out;
  }

  let next = lines.join("\n").replace(/\n+$/, "");
  if (!featuresSeen) {
    if (next.trim() !== "") next += "\n\n";
    next += "[features]\nhooks = true";
  }
  return `${next}\n`;
}

/** Strip `hooks` / `codex_hooks` keys from the `[features]` table. */
export function removeCodexHooksFeature(content: string): string {
  const out: string[] = [];
  let inFeatures = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inFeatures = trimmed === "[features]";
      out.push(line);
      continue;
    }
    const key = codexConfigLineKey(trimmed);
    if (inFeatures && (key === "hooks" || key === "codex_hooks")) continue;
    out.push(line);
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

/** True iff the `[features]` table sets `hooks = true`. */
export function codexHooksFeatureEnabled(content: string): boolean {
  let inFeatures = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inFeatures = trimmed === "[features]";
      continue;
    }
    if (inFeatures && codexConfigLineKey(trimmed) === "hooks") {
      const idx = trimmed.indexOf("=");
      return idx !== -1 && trimmed.slice(idx + 1).trim() === "true";
    }
  }
  return false;
}

function installCodexFeatureFlag(opts: { cwd: string; global: boolean }): void {
  const configPath = codexConfigPath(opts);
  ensureParentDir(configPath);
  let current = "";
  if (fs.existsSync(configPath)) current = fs.readFileSync(configPath, "utf8");
  fs.writeFileSync(configPath, upsertCodexHooksFeature(current), {
    mode: 0o644,
  });
}

function removeCodexFeatureFlag(opts: { cwd: string; global: boolean }): void {
  const configPath = codexConfigPath(opts);
  if (!fs.existsSync(configPath)) return;
  const current = fs.readFileSync(configPath, "utf8");
  fs.writeFileSync(configPath, removeCodexHooksFeature(current), {
    mode: 0o644,
  });
}

function codexConfigHasHooksFeature(opts: {
  cwd: string;
  global: boolean;
}): boolean {
  const configPath = codexConfigPath(opts);
  if (!fs.existsSync(configPath)) return false;
  return codexHooksFeatureEnabled(fs.readFileSync(configPath, "utf8"));
}

// ──────────────────────────────────────────────────────────────────────
// hooks.json managed entries (JSON upsert/remove, mirrors Go map mutation)
// ──────────────────────────────────────────────────────────────────────

interface HookCommand {
  type: string;
  command: string;
  statusMessage: string;
}
interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}
type HooksMap = Record<string, unknown>;
type CodexHooksConfig = Record<string, unknown>;

function codexHookEntry(
  matcher: string,
  command: string,
  status: string,
): HookEntry {
  const entry: HookEntry = {
    hooks: [{ type: "command", command, statusMessage: status }],
  };
  if (matcher !== "") entry.matcher = matcher;
  return entry;
}

/** The four managed hook events — mirrors the rebranded asset hooks.json. */
function codexManagedHooks(): Record<string, HookEntry[]> {
  return {
    SessionStart: [
      codexHookEntry(
        "startup|resume|clear",
        "linear codex-hook SessionStart",
        "Loading Linear context",
      ),
    ],
    PreCompact: [
      codexHookEntry(
        "manual|auto",
        "linear codex-hook PreCompact",
        "Checking Linear context",
      ),
    ],
    PostCompact: [
      codexHookEntry(
        "manual|auto",
        "linear codex-hook PostCompact",
        "Scheduling Linear context refresh",
      ),
    ],
    UserPromptSubmit: [
      codexHookEntry(
        "",
        "linear codex-hook UserPromptSubmit",
        "Refreshing Linear context",
      ),
    ],
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True iff a hook entry is one we manage (its command starts with our prefix). */
function codexHookEntryManaged(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  for (const command of asArray(entry.hooks)) {
    if (!isRecord(command)) continue;
    const commandString = command.command;
    if (
      typeof commandString === "string" &&
      commandString.startsWith(CODEX_HOOK_COMMAND_PREFIX)
    ) {
      return true;
    }
  }
  return false;
}

function removeCodexManagedHookEvent(hooks: HooksMap, event: string): void {
  const entries = asArray(hooks[event]);
  const filtered = entries.filter((entry) => !codexHookEntryManaged(entry));
  if (filtered.length === 0) {
    delete hooks[event];
  } else {
    hooks[event] = filtered;
  }
}

/** Insert the managed hook entries, replacing any prior managed ones (dedup). */
export function upsertCodexManagedHooks(config: CodexHooksConfig): void {
  let hooks = config.hooks;
  if (!isRecord(hooks)) {
    hooks = {};
    config.hooks = hooks;
  }
  const hooksMap = hooks as HooksMap;
  for (const [event, entries] of Object.entries(codexManagedHooks())) {
    removeCodexManagedHookEvent(hooksMap, event);
    hooksMap[event] = [...asArray(hooksMap[event]), ...entries];
  }
}

/** Strip every managed hook entry; drop the `hooks` key when it empties out. */
export function removeCodexManagedHooks(config: CodexHooksConfig): void {
  const hooks = config.hooks;
  if (!isRecord(hooks)) return;
  const hooksMap = hooks as HooksMap;
  for (const event of Object.keys(codexManagedHooks())) {
    removeCodexManagedHookEvent(hooksMap, event);
  }
  if (Object.keys(hooksMap).length === 0) delete config.hooks;
}

function codexHookEntriesContain(entries: unknown[], want: unknown): boolean {
  const wantJSON = JSON.stringify(want);
  return entries.some((entry) => JSON.stringify(entry) === wantJSON);
}

/** True iff every managed hook entry is present in the config (mirrors Go). */
export function codexManagedHooksCurrent(config: CodexHooksConfig): boolean {
  const hooks = config.hooks;
  if (!isRecord(hooks)) return false;
  const hooksMap = hooks as HooksMap;
  for (const [event, want] of Object.entries(codexManagedHooks())) {
    for (const wantEntry of want) {
      if (!codexHookEntriesContain(asArray(hooksMap[event]), wantEntry)) {
        return false;
      }
    }
  }
  return true;
}

function installCodexHooksJSON(opts: { cwd: string; global: boolean }): void {
  const hooksPath = codexHooksPath(opts);
  ensureParentDir(hooksPath);
  let current: CodexHooksConfig = {};
  if (fs.existsSync(hooksPath)) {
    const data = fs.readFileSync(hooksPath, "utf8");
    if (data.trim().length > 0) {
      current = JSON.parse(data) as CodexHooksConfig;
    }
  }
  upsertCodexManagedHooks(current);
  fs.writeFileSync(hooksPath, `${JSON.stringify(current, null, 2)}\n`, {
    mode: 0o644,
  });
}

function removeCodexHooksJSON(opts: { cwd: string; global: boolean }): void {
  const hooksPath = codexHooksPath(opts);
  if (!fs.existsSync(hooksPath)) return;
  const data = fs.readFileSync(hooksPath, "utf8");
  let current: CodexHooksConfig = {};
  if (data.trim().length > 0) current = JSON.parse(data) as CodexHooksConfig;
  removeCodexManagedHooks(current);
  if (Object.keys(current).length === 0) {
    fs.rmSync(hooksPath, { force: true });
    return;
  }
  fs.writeFileSync(hooksPath, `${JSON.stringify(current, null, 2)}\n`, {
    mode: 0o644,
  });
}

function codexHooksJSONCurrent(opts: {
  cwd: string;
  global: boolean;
}): boolean {
  const hooksPath = codexHooksPath(opts);
  if (!fs.existsSync(hooksPath)) return false;
  try {
    const current = JSON.parse(
      fs.readFileSync(hooksPath, "utf8"),
    ) as CodexHooksConfig;
    return codexManagedHooksCurrent(current);
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Public install/check/remove trio (composed by setup-service codex recipe)
// ──────────────────────────────────────────────────────────────────────

export interface CodexHooksConfigOutcome {
  /** config.toml path that carries the `[features] hooks = true` flag. */
  config_path: string;
  /** hooks.json path that carries the managed hook entries. */
  hooks_path: string;
  action: "installed" | "checked" | "removed";
  /**
   * install: always true (we just wrote both files).
   * check:   true iff the feature flag is enabled AND hooks.json is current.
   * remove:  true iff anything existed pre-remove (cleanup happened).
   */
  installed: boolean;
}

export function installCodexNativeHooks(opts: {
  cwd: string;
  global: boolean;
}): CodexHooksConfigOutcome {
  installCodexFeatureFlag(opts);
  installCodexHooksJSON(opts);
  return {
    config_path: codexConfigPath(opts),
    hooks_path: codexHooksPath(opts),
    action: "installed",
    installed: true,
  };
}

export function checkCodexNativeHooks(opts: {
  cwd: string;
  global: boolean;
}): CodexHooksConfigOutcome {
  const featureOk = codexConfigHasHooksFeature(opts);
  const hooksOk = codexHooksJSONCurrent(opts);
  return {
    config_path: codexConfigPath(opts),
    hooks_path: codexHooksPath(opts),
    action: "checked",
    installed: featureOk && hooksOk,
  };
}

export function removeCodexNativeHooks(opts: {
  cwd: string;
  global: boolean;
}): CodexHooksConfigOutcome {
  const featureExisted = codexConfigHasHooksFeature(opts);
  const hooksExisted = codexHooksJSONCurrent(opts);
  // Remove hooks first so a partial failure leaves the feature flag pointing
  // at nothing rather than the inverse.
  removeCodexHooksJSON(opts);
  removeCodexFeatureFlag(opts);
  return {
    config_path: codexConfigPath(opts),
    hooks_path: codexHooksPath(opts),
    action: "removed",
    installed: featureExisted || hooksExisted,
  };
}
