/**
 * `linear doctor` — *integration-health* checks (lin-i79e).
 *
 * Where doctor-service.ts probes the **workspace** (auth, stale work,
 * labels, scope), this module probes the **agent integration**: is the
 * linear Claude plugin present, are the SessionStart/PreCompact hooks
 * wired into `.claude/settings.json` (project + global), are the
 * `.claude/settings.json` files well-formed, and is the `linear` CLI on
 * PATH so those hooks can actually run.
 *
 * Notes on the integration checks:
 *
 *   - **Plugin**: linear has no published marketplace plugin yet (2026-05),
 *     so there is no version-fetch. Detection logic (enabledPlugins scan)
 *     is kept for forward-compatibility and never hard-fails.
 *   - **MCP**: linear's API is GraphQL, not MCP-modeled, so there is no MCP
 *     check. Hook detection (which is CLI-agnostic) is kept.
 *   - **Command names**: the checks use `linear prime`, `linear` in PATH,
 *     and `linear setup claude`.
 *
 * Every check returns the same `DoctorCheck` shape doctor-service.ts uses,
 * including the ZFC enrichment fields (`observed_state`, `expected_state`,
 * `explanation`, `commands`, `severity`). The command layer strips those
 * fields unless `--agent` is set — exactly as it does for the existing
 * workspace checks, so there is one enrichment model, not two.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CLAUDE_HOOK_EVENTS,
  type ClaudeHookEvent,
  type ClaudeSettingsFile,
  hasLinearPlugin,
  linearHookEvents,
  readAllClaudeSettings,
} from "../common/claude-settings.js";
import type { DoctorCheck } from "../common/doctor-types.js";

/** Category constant for the integration-health slice. */
export const CATEGORY_INTEGRATION = "integration";

/**
 * Options every integration check accepts. `cwd`/`home` are injectable so
 * tests don't depend on the developer's real `~/.claude/` directory.
 * `cliName`/`pathEnv` let the PATH check be exercised deterministically.
 */
export interface AgentCheckOpts {
  cwd?: string;
  home?: string;
  /** Override the `linear` CLI binary name (default: "linear"). */
  cliName?: string;
  /** Override the PATH string to search (default: process.env.PATH). */
  pathEnv?: string;
  /** Override the path delimiter (default: path.delimiter). */
  pathDelimiter?: string;
}

/** Stable names of the integration-health checks, in display order. */
export const AGENT_CHECK_NAMES = [
  "claude_plugin",
  "claude_settings",
  "claude_hooks",
  "cli_in_path",
] as const;
export type AgentCheckName = (typeof AGENT_CHECK_NAMES)[number];

/** Type guard for integration-health check names. */
export function isAgentCheckName(value: string): value is AgentCheckName {
  return (AGENT_CHECK_NAMES as readonly string[]).includes(value);
}

/**
 * claude_plugin — is a linear Claude Code plugin enabled?
 *
 * Linear has no published marketplace plugin yet, so the expected steady
 * state is "not installed" and that is reported as OK (advisory), never a
 * warning. If a future plugin *is* enabled in any settings file, we report
 * that too.
 */
export function checkClaudePlugin(opts: AgentCheckOpts = {}): DoctorCheck {
  const files = readAllClaudeSettings(opts);
  const base = {
    name: "claude_plugin",
    category: CATEGORY_INTEGRATION,
    expected_state:
      "a linear Claude plugin is enabled, or none is (plugin ecosystem TBD)",
    commands: ["linear setup claude"],
  };
  const enabledIn = files.filter((f) => f.valid && hasLinearPlugin(f.settings));
  if (enabledIn.length > 0) {
    return {
      ...base,
      status: "ok",
      severity: "info",
      message: `linear Claude plugin enabled (${enabledIn.map((f) => f.label).join(", ")})`,
      observed_state: `plugin_enabled_in=[${enabledIn.map((f) => f.label).join(", ")}]`,
    };
  }
  return {
    ...base,
    status: "ok",
    severity: "info",
    message: "No linear Claude plugin enabled (none published yet)",
    detail:
      "Linear has no marketplace plugin as of 2026-05; SessionStart/PreCompact hooks provide the integration instead.",
    observed_state: "plugin_enabled=false",
    explanation:
      "Linear does not yet publish a Claude Code marketplace plugin. The agent integration is delivered through `linear prime` hooks wired into .claude/settings.json rather than a plugin, so the absence of a plugin is expected and not a problem.",
  };
}

/**
 * claude_settings — are the discovered `.claude/settings.json` files valid
 * JSON? A malformed settings file silently breaks hook + plugin loading,
 * so this is the one integration check that escalates to `error`.
 */
export function checkClaudeSettings(opts: AgentCheckOpts = {}): DoctorCheck {
  const files = readAllClaudeSettings(opts);
  const base = {
    name: "claude_settings",
    category: CATEGORY_INTEGRATION,
    expected_state: "every discovered .claude/settings.json is valid JSON",
    commands: ["linear setup claude"],
  };
  const present = files.filter((f) => f.exists);
  const malformed = present.filter((f) => !f.valid);
  if (present.length === 0) {
    return {
      ...base,
      status: "ok",
      severity: "info",
      message: "No Claude Code settings files found",
      observed_state: "settings_files=0",
      explanation:
        "No .claude/settings.json files exist (global, project, or project-local). Claude integration is simply not configured here, which is fine for non-Claude workflows.",
    };
  }
  if (malformed.length > 0) {
    return {
      ...base,
      status: "error",
      severity: "error",
      message: `${malformed.length} malformed settings file(s)`,
      detail: malformed.map((f) => `${f.label}: ${f.error}`).join("\n"),
      fix: "Fix the JSON syntax in the listed file(s); malformed settings break hooks and plugin detection.",
      observed_state: `malformed=[${malformed.map((f) => f.label).join(", ")}]`,
      explanation:
        "One or more .claude/settings.json files are not valid JSON. Claude Code refuses to load malformed settings, so any linear prime hooks or plugin entries inside them are silently ignored, breaking the agent integration entirely.",
    };
  }
  return {
    ...base,
    status: "ok",
    severity: "info",
    message: `${present.length} settings file(s) valid`,
    observed_state: `valid=${present.length}/${present.length}`,
  };
}

/**
 * claude_hooks — are the SessionStart/PreCompact `linear prime` hooks
 * wired into any `.claude/settings.json` (project or global)?
 *
 * linear checks BOTH events (SessionStart and PreCompact). Reporting:
 *
 *   - no settings files at all       → ok / advisory ("not configured")
 *   - SessionStart + PreCompact both → ok
 *   - SessionStart only              → warning (PreCompact missing)
 *   - PreCompact only / neither      → warning (SessionStart missing)
 */
export function checkClaudeHooks(opts: AgentCheckOpts = {}): DoctorCheck {
  const files = readAllClaudeSettings(opts);
  const base = {
    name: "claude_hooks",
    category: CATEGORY_INTEGRATION,
    expected_state:
      "SessionStart and PreCompact hooks run `linear prime` in a .claude/settings.json",
    commands: ["linear setup claude --project", "linear setup claude --global"],
  };
  const present = files.filter((f) => f.exists && f.valid);
  if (present.length === 0) {
    return {
      ...base,
      status: "ok",
      severity: "info",
      message: "No Claude settings to check for hooks",
      observed_state: "settings_files=0",
      explanation:
        "No readable .claude/settings.json files exist, so there is nothing to wire hooks into. Run `linear setup claude` to enable the agent integration in Claude Code.",
    };
  }

  const found = new Set<ClaudeHookEvent>();
  const eventsByFile: string[] = [];
  for (const f of present) {
    const evts = linearHookEvents(f.settings);
    for (const e of evts) found.add(e);
    if (evts.size > 0) {
      eventsByFile.push(`${f.label}:[${[...evts].join(",")}]`);
    }
  }

  const missing = CLAUDE_HOOK_EVENTS.filter((e) => !found.has(e));
  const observed =
    found.size > 0
      ? `hooks=[${[...found].join(",")}] in ${eventsByFile.join(" ")}`
      : "hooks=[] (no linear prime hooks found)";

  if (missing.length === 0) {
    return {
      ...base,
      status: "ok",
      severity: "info",
      message: "SessionStart and PreCompact hooks present",
      observed_state: observed,
    };
  }
  return {
    ...base,
    status: "warning",
    severity: "warning",
    message: `Missing linear prime hook event(s): ${missing.join(", ")}`,
    detail:
      "SessionStart injects workspace context on new/resumed sessions; PreCompact refreshes it before compaction. Without both, agents lose the linear workflow context.",
    fix: "Run `linear setup claude --project` (and `--global` for all repos) to wire both hooks.",
    observed_state: observed,
    explanation: `The .claude/settings.json files are present but do not wire every linear prime hook event. Missing: ${missing.join(", ")}. Claude Code will not refresh the linear workspace context at those moments, so the agent operates without the latest issue/scope state.`,
  };
}

/**
 * Look up an executable by name on PATH without spawning a subprocess —
 * walk the PATH entries and test each candidate for executability. Pure
 * filesystem access keeps this deterministic and injectable for tests.
 */
function isOnPath(
  cliName: string,
  pathEnv: string,
  delimiter: string,
): boolean {
  if (!pathEnv) return false;
  const exeSuffixes =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .map((s) => s.toLowerCase())
      : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const suffix of exeSuffixes) {
      const candidate = path.join(dir, cliName + suffix);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // not here / not executable — keep scanning
      }
    }
  }
  return false;
}

/**
 * cli_in_path — is the `linear` CLI resolvable on PATH? The Claude hooks
 * invoke `linear prime`, so if `linear` is not on PATH the hooks fail
 * silently.
 */
export function checkCliInPath(opts: AgentCheckOpts = {}): DoctorCheck {
  const cliName = opts.cliName ?? "linear";
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  const delimiter = opts.pathDelimiter ?? path.delimiter;
  const base = {
    name: "cli_in_path",
    category: CATEGORY_INTEGRATION,
    expected_state: `'${cliName}' executable is resolvable on PATH`,
    commands: [`which ${cliName}`, "npm install -g @humanintheloop/linear"],
  };
  if (isOnPath(cliName, pathEnv, delimiter)) {
    return {
      ...base,
      status: "ok",
      severity: "info",
      message: `'${cliName}' command available on PATH`,
      observed_state: `cli_in_path=true name=${cliName}`,
    };
  }
  return {
    ...base,
    status: "warning",
    severity: "warning",
    message: `'${cliName}' command not found on PATH`,
    detail: `Claude hooks execute '${cliName} prime' and will fail silently without '${cliName}' on PATH.`,
    fix: `Install ${cliName} globally (e.g. \`npm install -g @humanintheloop/linear\`) or add it to your PATH.`,
    observed_state: `cli_in_path=false name=${cliName}`,
    explanation: `The '${cliName}' executable is not resolvable on the current PATH. Claude Code hooks invoke '${cliName} prime' to load workspace context, so those hooks will fail silently and the agent will start without linear context until '${cliName}' is on PATH.`,
  };
}

/**
 * Re-export of the discovered-files helper so callers
 * can surface the search path without re-reading the filesystem.
 */
export function discoverClaudeSettings(
  opts: AgentCheckOpts = {},
): ClaudeSettingsFile[] {
  return readAllClaudeSettings(opts);
}

/** Default home/cwd resolution helper (kept for symmetry with callers). */
export function defaultAgentCheckOpts(): AgentCheckOpts {
  return { cwd: process.cwd(), home: os.homedir() };
}

const AGENT_CHECKS: Record<
  AgentCheckName,
  (opts: AgentCheckOpts) => DoctorCheck
> = {
  claude_plugin: checkClaudePlugin,
  claude_settings: checkClaudeSettings,
  claude_hooks: checkClaudeHooks,
  cli_in_path: checkCliInPath,
};

/**
 * Run one integration-health check, or the complete ordered set. A non-agent
 * `only` value returns an empty list so the workspace doctor can handle it.
 */
export function resolveAgentChecks(
  opts: AgentCheckOpts & { only?: string } = {},
): DoctorCheck[] {
  const { only, ...checkOpts } = opts;
  if (only) {
    return isAgentCheckName(only) ? [AGENT_CHECKS[only](checkOpts)] : [];
  }
  return AGENT_CHECK_NAMES.map((name) => AGENT_CHECKS[name](checkOpts));
}
