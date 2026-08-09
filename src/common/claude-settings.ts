/**
 * Claude Code settings reader/parser — utility layer for the agent-doctor
 * integration-health checks (lin-i79e).
 *
 * Claude Code reads three settings files, in increasing specificity:
 *
 *   - `~/.claude/settings.json`            — global (per-user)
 *   - `<repo>/.claude/settings.json`       — project (committed/shared)
 *   - `<repo>/.claude/settings.local.json` — project-local (gitignored)
 *
 * These helpers walk that search path and match the marker strings we manage
 * for Linear: the hook commands are `linear prime` /
 * `linear prime --stealth` (written by `linear setup claude`), and the
 * plugin-marketplace key we look for contains `linear`.
 *
 * Everything here is read-only and pure-ish (it touches the filesystem but
 * mutates nothing). Missing files are not errors — a missing
 * `.claude/` directory simply yields "no settings", which the doctor checks
 * treat as an OK/advisory state rather than a failure.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Hook events Claude Code fires that linear's `prime` hook targets.
 * SessionStart fires on startup, resume, clear, and after compaction;
 * PreCompact fires immediately before context compaction. Mirrors
 * `CLAUDE_HOOK_EVENTS` in setup-service.ts.
 */
export const CLAUDE_HOOK_EVENTS = ["SessionStart", "PreCompact"] as const;
export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

/**
 * The exact `linear prime` command variants we recognize as a valid
 * linear hook. Mirrors the two strings setup-service.ts writes
 * (`linear prime`, `linear prime --stealth`) plus the JSON-hook variants
 * a future `linear prime --hook-json` mode may emit, so detection stays
 * forward-compatible without a destructive migration.
 */
export const LINEAR_PRIME_COMMANDS = [
  "linear prime",
  "linear prime --stealth",
  "linear prime --memories-only",
  "linear prime --hook-json",
  "linear prime --stealth --hook-json",
] as const;

/** Logical scope of a settings file. */
export type ClaudeSettingsScope = "global" | "project" | "project-local";

/** One hook command entry inside a settings file. */
interface HookCommand {
  type?: string;
  command?: string;
}

/** One hook matcher entry (a `{ matcher, hooks[] }` object). */
interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
}

/** Parsed shape of a Claude Code settings file (only fields we read). */
export interface ClaudeSettings {
  hooks?: Record<string, HookEntry[]>;
  enabledPlugins?: Record<string, unknown>;
  /** MCP servers keyed by logical name (e.g. `linear`). */
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A discovered settings file plus its parse outcome. */
export interface ClaudeSettingsFile {
  scope: ClaudeSettingsScope;
  /** Human-friendly label, e.g. `~/.claude/settings.json`. */
  label: string;
  /** Absolute path on disk. */
  path: string;
  /** True if the file exists on disk. */
  exists: boolean;
  /** True if the file exists AND parses as valid JSON. */
  valid: boolean;
  /** Parse error message when `exists && !valid`. */
  error?: string;
  /** Parsed settings object when `valid`. */
  settings?: ClaudeSettings;
}

/**
 * Resolve the absolute path of a settings file for a given scope.
 * `cwd` defaults to `process.cwd()`; `home` defaults to `os.homedir()`
 * (both injectable for deterministic tests).
 */
export function claudeSettingsPath(
  scope: ClaudeSettingsScope,
  opts: { cwd?: string; home?: string } = {},
): string {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? os.homedir();
  switch (scope) {
    case "global":
      return path.join(home, ".claude", "settings.json");
    case "project":
      return path.join(cwd, ".claude", "settings.json");
    case "project-local":
      return path.join(cwd, ".claude", "settings.local.json");
  }
}

function labelFor(scope: ClaudeSettingsScope): string {
  switch (scope) {
    case "global":
      return "~/.claude/settings.json";
    case "project":
      return ".claude/settings.json";
    case "project-local":
      return ".claude/settings.local.json";
  }
}

/**
 * Read and parse a single Claude settings file. Never throws — a missing
 * file yields `{ exists: false, valid: false }`, a malformed file yields
 * `{ exists: true, valid: false, error }`, and a well-formed file yields
 * `{ exists: true, valid: true, settings }`.
 */
export function readClaudeSettingsFile(
  scope: ClaudeSettingsScope,
  opts: { cwd?: string; home?: string } = {},
): ClaudeSettingsFile {
  const filePath = claudeSettingsPath(scope, opts);
  const base: ClaudeSettingsFile = {
    scope,
    label: labelFor(scope),
    path: filePath,
    exists: false,
    valid: false,
  };
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return base;
  }
  // File exists. Empty/whitespace-only content is treated as a valid empty
  // settings object (Claude Code tolerates this), mirroring setup-service.
  if (!raw.trim()) {
    return { ...base, exists: true, valid: true, settings: {} };
  }
  try {
    const parsed = JSON.parse(raw) as ClaudeSettings;
    return { ...base, exists: true, valid: true, settings: parsed };
  } catch (e) {
    return {
      ...base,
      exists: true,
      valid: false,
      error: (e as Error).message,
    };
  }
}

/**
 * Read all three Claude settings files (global, project, project-local)
 * and return them in a stable order. Files that don't exist are still
 * present in the array with `exists: false` so callers can report on the
 * full search path.
 */
export function readAllClaudeSettings(
  opts: { cwd?: string; home?: string } = {},
): ClaudeSettingsFile[] {
  return (["global", "project", "project-local"] as const).map((scope) =>
    readClaudeSettingsFile(scope, opts),
  );
}

/**
 * Validate a raw JSON string. Returns `true` iff it parses. Useful for
 * callers that already hold the file contents and only want a boolean.
 */
export function isValidJson(raw: string): boolean {
  if (!raw.trim()) return true;
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return which linear-prime hook events are present in a parsed settings
 * object. An event counts as present when at least one of its hook
 * entries carries a command string in `LINEAR_PRIME_COMMANDS`.
 */
export function linearHookEvents(
  settings: ClaudeSettings | undefined,
): Set<ClaudeHookEvent> {
  const found = new Set<ClaudeHookEvent>();
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== "object") return found;
  for (const event of CLAUDE_HOOK_EVENTS) {
    const entries = hooks[event];
    if (!Array.isArray(entries)) continue;
    const hit = entries.some((entry) =>
      (entry?.hooks ?? []).some(
        (h) =>
          typeof h?.command === "string" &&
          (LINEAR_PRIME_COMMANDS as readonly string[]).includes(h.command),
      ),
    );
    if (hit) found.add(event);
  }
  return found;
}

/**
 * Does the parsed settings object enable a linear Claude plugin? Scans
 * `enabledPlugins` for any key
 * containing `linear` whose value is the boolean `true`. Linear has no
 * published marketplace plugin yet (2026-05), so this is forward-looking
 * detection — never a hard failure.
 */
export function hasLinearPlugin(settings: ClaudeSettings | undefined): boolean {
  const enabled = settings?.enabledPlugins;
  if (!enabled || typeof enabled !== "object") return false;
  for (const [key, value] of Object.entries(enabled)) {
    if (key.toLowerCase().includes("linear") && value === true) {
      return true;
    }
  }
  return false;
}

/**
 * Does the parsed settings object configure a `linear` MCP server? Scans
 * `mcpServers`
 * for any key containing `linear` (case-insensitive). The value is not
 * inspected — presence of the key is what Claude Code keys MCP wiring on.
 */
export function hasLinearMCP(settings: ClaudeSettings | undefined): boolean {
  const servers = settings?.mcpServers;
  if (!servers || typeof servers !== "object") return false;
  for (const key of Object.keys(servers)) {
    if (key.toLowerCase().includes("linear")) return true;
  }
  return false;
}

/**
 * Detect whether a `linear` MCP server is configured in the user's global
 * Claude settings (`~/.claude/settings.json`).
 * Read-only, never throws, and a missing/malformed file simply reports
 * "not active" (false). `home` is injectable for deterministic tests.
 */
export function isMCPActive(opts: { home?: string } = {}): boolean {
  const file = readClaudeSettingsFile("global", opts);
  return file.valid && hasLinearMCP(file.settings);
}
