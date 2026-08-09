/**
 * `linear setup` — install integration files for AI editors and coding
 * assistants.
 *
 * Four recipe shapes:
 *
 *   - **File recipes** (`kind: "file"`): write a single workflow template
 *     to a fixed project path. cursor → `.cursor/rules/linear.mdc`,
 *     windsurf → `.windsurf/rules.md`, cody → `.sourcegraph/rules.md`,
 *     kilocode → `.kilocode/rules.md`. Owns the whole file — install
 *     overwrites, remove unlinks.
 *   - **Multifile recipes** (`kind: "multifile"`): write a small set of
 *     sibling files (aider, junie, agent-skill). install/check/remove
 *     iterate the entries; remove also prunes deepest-first empty parent
 *     dirs the recipe declared.
 *   - **Hook recipes** (`kind: "hook"`): merge a `linear prime` command
 *     into a settings.json under either the project's `.<recipe>/` dir or
 *     the user's `~/.<recipe>/` (with `--global`). claude registers
 *     SessionStart + PreCompact; gemini registers SessionStart +
 *     PreCompress and also writes a GEMINI.md companion at the project
 *     cwd. Dedupes by command string so re-running is idempotent.
 *   - **Section recipes** (`kind: "section"`): merge a marker-bracketed
 *     managed block into a user-owned AGENTS.md. codex/factory/opencode/
 *     agents/mux each own their own BEGIN/END marker pair so multiple
 *     section recipes coexist in the same AGENTS.md without overwriting
 *     each other. codex is composite — it also installs the agent-skill
 *     multifile leg (router + references/resources + agents/openai.yaml).
 *     mux composes up to
 *     three layers — base AGENTS.md, project `.mux/AGENTS.md`
 *     (`--project`), and global `~/.mux/AGENTS.md` (`--global`); flags
 *     are additive, not mutually exclusive. The marker pair preserves
 *     user content outside the managed block, so the section round-trips
 *     safely.
 *
 * All paths are joined via `path.join` from the project's CWD (project
 * scope) or `os.homedir()` (global scope). Mux shell hook scripts
 * (.mux/init, .mux/tool_post, .mux/tool_env) are intentionally omitted —
 * they have no analog in linear's stateless model.
 *
 * `--stealth` opts the hook command into the stealth variant
 * (`linear prime --stealth`), which omits the git-ops session-close
 * protocol — useful when the agent is operating on a managed branch,
 * in a worktree without push rights, or behind a code-review gate.
 *
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENT_SKILL_OPENAI_YAML,
  AGENT_SKILL_SNAPSHOT,
  AGENT_SKILL_SUPPORT_FILES,
} from "../templates/agent-skill.js";
import { AGENTS_SNIPPET } from "../templates/agents-snippet.js";
import { AIDER_CONF_YML } from "../templates/aider/conf.js";
import { AIDER_LINEAR_MD } from "../templates/aider/linear.js";
import { AIDER_README_MD } from "../templates/aider/readme.js";
import { JUNIE_MCP_JSON } from "../templates/junie/mcp.js";
import {
  CURSOR_TEMPLATE,
  WORKFLOW_BODY,
  WORKFLOW_BODY_MINIMAL,
} from "../templates/workflow.js";
import {
  type CodexHooksConfigOutcome,
  checkCodexNativeHooks,
  installCodexNativeHooks,
  removeCodexNativeHooks,
} from "./setup/codex-setup.js";
import {
  runSectionRecipe,
  type SectionMarkers,
  type SectionOp,
  type SectionOutcome,
  type SectionRecipeCtx,
} from "./setup/section-recipe.js";

// Re-export the section-recipe primitives so downstream importers
// (commands, future recipe modules) can pick them up from either
// setup-service.ts (legacy import path) or setup/section-recipe.ts
// (the canonical home).
export {
  runSectionRecipe,
  type SectionMarkers,
  type SectionOp,
  type SectionOutcome,
  type SectionRecipeCtx,
};

const HOOK_COMMAND = "linear prime";
const HOOK_COMMAND_STEALTH = "linear prime --stealth";
/**
 * Compaction-event variant. A compacting session already received the
 * full brief at SessionStart, so PreCompact/PreCompress only re-inject
 * the dynamic tail (memories) instead of re-paying the full static
 * brief on every compaction. (TES-825)
 */
const HOOK_COMMAND_MEMORIES = "linear prime --memories-only";

/**
 * Every `linear prime` variant we manage in claude/gemini hooks. We
 * sweep all of them on remove/re-install so a stealth swap — or an
 * upgrade from the old full-brief-on-PreCompact install — leaves a
 * clean settings.json behind.
 */
const HOOK_COMMAND_VARIANTS = [
  HOOK_COMMAND,
  HOOK_COMMAND_STEALTH,
  HOOK_COMMAND_MEMORIES,
] as const;

const ALL_HOOK_COMMAND_VARIANTS = HOOK_COMMAND_VARIANTS;

function hookCommandFor(stealth: boolean): string {
  return stealth ? HOOK_COMMAND_STEALTH : HOOK_COMMAND;
}

/**
 * Per-event hook command: session-start events get the full brief,
 * compaction events (Claude `PreCompact`, Gemini `PreCompress`) get the
 * memories-only brief. Stealth only affects the full brief — the
 * memories tail carries no git-ops protocol to omit.
 */
function hookCommandForEvent(event: string, stealth: boolean): string {
  if (event === "PreCompact" || event === "PreCompress") {
    return HOOK_COMMAND_MEMORIES;
  }
  return hookCommandFor(stealth);
}

// Recipe taxonomy types live in ./setup/types.ts — the cross-cutting
// vocabulary every per-recipe module shares. Re-exported here so existing
// importers (`from "./setup-service.js"`) keep working unchanged.
export type {
  FileRecipeResult,
  MultiFileEntry,
  MultiFileEntryResult,
  MultiFileRecipeResult,
  RecipeDef,
  RecipeKind,
  RecipeListEntry,
} from "./setup/types.js";

import type {
  MultiFileEntry,
  RecipeDef,
  RecipeListEntry,
} from "./setup/types.js";

/**
 * Built-in recipe catalog. File recipes are dispatched generically via
 * `installFileRecipe()` / `checkFileRecipe()` / `removeFileRecipe()`;
 * hook and section recipes each have a dedicated install/check/remove
 * trio that the command layer dispatches on `recipe.name`.
 */
export const RECIPES: Record<string, RecipeDef> = {
  cursor: {
    name: "cursor",
    description: "Cursor IDE rules file",
    kind: "file",
    targetPath: ".cursor/rules/linear.mdc",
    template: CURSOR_TEMPLATE,
  },
  aider: {
    name: "aider",
    description:
      "Aider auto-load config (.aider.conf.yml) + workflow brief (.aider/LINEAR.md) + README (.aider/README.md)",
    kind: "multifile",
    files: [
      { targetPath: ".aider.conf.yml", template: AIDER_CONF_YML },
      { targetPath: ".aider/LINEAR.md", template: AIDER_LINEAR_MD },
      { targetPath: ".aider/README.md", template: AIDER_README_MD },
    ],
    // Deepest-first prune: .aider/ is the only dir to clear; the
    // root .aider.conf.yml is a file sibling, not a dir we own.
    emptyDirs: [".aider"],
  },
  factory: {
    name: "factory",
    description:
      "Factory Droid AGENTS.md managed section (preserves user content outside the LINEAR FACTORY SETUP markers)",
    kind: "section",
  },
  opencode: {
    name: "opencode",
    description:
      "OpenCode AGENTS.md managed section (preserves user content outside the LINEAR OPENCODE SETUP markers)",
    kind: "section",
  },
  junie: {
    name: "junie",
    description:
      "Junie guidelines file (.junie/guidelines.md) + MCP server config (.junie/mcp/mcp.json)",
    kind: "multifile",
    files: [
      { targetPath: ".junie/guidelines.md", template: WORKFLOW_BODY },
      { targetPath: ".junie/mcp/mcp.json", template: JUNIE_MCP_JSON },
    ],
    // Deepest-first prune: try `.junie/mcp` before `.junie`. If the
    // user has added other Junie files alongside (e.g. a custom
    // guidelines override), neither dir gets pruned.
    emptyDirs: [".junie/mcp", ".junie"],
  },
  windsurf: {
    name: "windsurf",
    description:
      "Windsurf editor workspace rule file (.windsurf/rules/linear.md — modern Wave 8+ format)",
    kind: "file",
    // Windsurf's modern format (Wave 8+): each rule is its own .md file
    // under .windsurf/rules/. The previous linear path used the legacy
    // single-file convention (.windsurfrules at root, or a flat
    // .windsurf/rules.md) which Windsurf still accepts for backward
    // compatibility but treats as deprecated.
    // Docs: https://docs.windsurf.com/windsurf/cascade/memories
    targetPath: ".windsurf/rules/linear.md",
    // Pre-correction installs used .windsurf/rules.md (treated 'rules'
    // as filename instead of directory). Sweep it on install/remove so
    // users transitioning to the corrected path don't end up with two
    // copies of the brief.
    legacyTargetPath: ".windsurf/rules.md",
    template: WORKFLOW_BODY,
  },
  cody: {
    name: "cody",
    description:
      "Sourcegraph Cody custom rule (.sourcegraph/linear.rule.md — Cody's *.rule.md convention)",
    kind: "file",
    // Sourcegraph Cody loads custom rules from .sourcegraph/*.rule.md
    // (each file owns one rule, with optional YAML frontmatter). The
    // earlier linear path .sourcegraph/rules.md neither matches the
    // *.rule.md glob Cody scans nor follows the per-rule-file
    // convention. Confirmed via Cody Sidekick extension docs and the
    // rules.so CLI's `cody` target which both ship to
    // .sourcegraph/*.rule.md.
    targetPath: ".sourcegraph/linear.rule.md",
    // Sweep the previous flat-file path on install/remove.
    legacyTargetPath: ".sourcegraph/rules.md",
    template: WORKFLOW_BODY,
  },
  kilocode: {
    name: "kilocode",
    description:
      "Kilo Code workspace rule file (.kilocode/rules/linear.md — recommended folder layout)",
    kind: "file",
    // Kilo Code recommends one rule file per concern under
    // .kilocode/rules/. The legacy `.kilocoderules` single file is
    // deprecated. Linear previously wrote to .kilocode/rules.md which
    // treats 'rules' as the filename, not the directory — Kilo's
    // loader doesn't read that path.
    // Docs: https://kilocode.ai/docs/advanced-usage/custom-rules
    targetPath: ".kilocode/rules/linear.md",
    legacyTargetPath: ".kilocode/rules.md",
    template: WORKFLOW_BODY,
  },
  "agent-skill": {
    name: "agent-skill",
    description:
      "Agent skill snapshot (router + references + resources + openai.yaml under .agents/skills/linear/) sourced from plugins/linear/skills/linear/",
    kind: "multifile",
    files: [
      {
        targetPath: ".agents/skills/linear/SKILL.md",
        template: AGENT_SKILL_SNAPSHOT,
      },
      {
        targetPath: ".agents/skills/linear/agents/openai.yaml",
        template: AGENT_SKILL_OPENAI_YAML,
      },
      ...AGENT_SKILL_SUPPORT_FILES,
    ],
    // Pruned deepest-first so the agents/ sub-dir disappears before
    // skills/linear/ does.
    emptyDirs: [
      ".agents/skills/linear/references",
      ".agents/skills/linear/resources",
      ".agents/skills/linear/agents",
      ".agents/skills/linear",
      ".agents/skills",
      ".agents",
    ],
  },
  claude: {
    name: "claude",
    description: "Claude Code hooks (SessionStart, PreCompact)",
    kind: "hook",
  },
  gemini: {
    name: "gemini",
    description: "Gemini CLI hooks (SessionStart, PreCompress) + GEMINI.md",
    kind: "hook",
  },
  codex: {
    name: "codex",
    description:
      "Codex CLI AGENTS.md section (project cwd, or $CODEX_HOME/~/.codex with --global)",
    kind: "section",
  },
  mux: {
    name: "mux",
    description:
      "Mux AGENTS.md section (base <cwd>/AGENTS.md + optional .mux/AGENTS.md with --project and ~/.mux/AGENTS.md with --global)",
    kind: "section",
  },
  agents: {
    name: "agents",
    description:
      "Generic AGENTS.md managed block pointing at `linear prime` (same snippet as `linear onboard`)",
    kind: "section",
  },
};

/** Recipe names known to require special handling (deferred follow-ups). */
export const DEFERRED_RECIPES = new Set<string>();

// User recipes (`.linear/recipes.json`) live in ./setup/user-recipes.ts.
// Re-exported here so the command layer (`setup --add`, `setup --remove`)
// keeps its existing import surface.
export {
  loadUserRecipes,
  saveUserRecipe,
  USER_RECIPES_DIR,
  USER_RECIPES_FILE,
  type UserRecipesFile,
} from "./setup/user-recipes.js";

import { loadUserRecipes } from "./setup/user-recipes.js";

export function listRecipes(cwd?: string): RecipeListEntry[] {
  const builtIn: RecipeListEntry[] = Object.values(RECIPES).map((r) => ({
    ...r,
    source: "built-in",
  }));
  if (!cwd) {
    return builtIn.sort((a, b) => a.name.localeCompare(b.name));
  }
  const userRecipes = loadUserRecipes(cwd);
  const byName = new Map<string, RecipeListEntry>(
    builtIn.map((r) => [r.name, r]),
  );
  for (const [name, recipe] of Object.entries(userRecipes)) {
    // User recipes shadow built-ins of the same name.
    byName.set(name, { ...recipe, source: "user" });
  }
  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function getRecipe(name: string, cwd?: string): RecipeDef | undefined {
  const normalized = name.toLowerCase();
  if (cwd) {
    const userRecipes = loadUserRecipes(cwd);
    if (normalized in userRecipes) return userRecipes[normalized];
  }
  return RECIPES[normalized];
}

// File recipe shared ops live in ./setup/file-recipe.ts. The trio
// (install/check/remove) handles every `kind: "file"` recipe — cursor,
// windsurf, cody, kilocode, junie, etc.
export {
  checkFileRecipe,
  ensureParentDir,
  installFileRecipe,
  removeFileRecipe,
} from "./setup/file-recipe.js";

import { ensureParentDir } from "./setup/file-recipe.js";

// Multifile shared ops live in ./setup/multifile-recipe.ts — the
// install/check/remove trio for every `kind: "multifile"` recipe
// (aider, junie, agent-skill).
export {
  checkMultiFileRecipe,
  installMultiFileRecipe,
  removeMultiFileRecipe,
} from "./setup/multifile-recipe.js";

import {
  checkMultiFileRecipe,
  installMultiFileRecipe,
  removeMultiFileRecipe,
} from "./setup/multifile-recipe.js";

// ──────────────────────────────────────────────────────────────────────
// Claude hook recipe: settings.json merge
//
// Registers SessionStart + PreCompact entries that run `linear prime`.
// The shape Claude Code expects is:
//
//   "hooks": {
//     "SessionStart": [
//       { "matcher": "", "hooks": [{ "type": "command", "command": "..." }] }
//     ],
//     "PreCompact": [ ... ]
//   }
//
// We merge into this structure rather than overwriting, deduping by command
// string so re-running `linear setup claude` is idempotent.
// ──────────────────────────────────────────────────────────────────────

export const CLAUDE_HOOK_EVENTS = ["SessionStart", "PreCompact"] as const;
export const CLAUDE_HOOK_COMMAND = HOOK_COMMAND;
export const CLAUDE_HOOK_COMMAND_STEALTH = HOOK_COMMAND_STEALTH;
export const CLAUDE_HOOK_COMMAND_MEMORIES = HOOK_COMMAND_MEMORIES;

export interface ClaudeHookResult {
  recipe: "claude";
  path: string;
  scope: "project" | "global";
  action: "installed" | "checked" | "removed";
  /** Which `linear prime` variant this run targets. */
  stealth: boolean;
  /** The SessionStart command string written to settings.json. */
  command: string;
  /** Per-event command map (compaction events get --memories-only). */
  commands: Record<string, string>;
  events_added?: string[];
  events_removed?: string[];
  installed?: boolean;
  /**
   * Path of the legacy `.claude/settings.local.json` we migrated stale
   * linear hooks out of, if any. Project-scope only.
   */
  legacy_migrated?: string;
}

function projectClaudeSettings(cwd: string): string {
  return path.join(cwd, ".claude", "settings.json");
}

// `.claude/settings.local.json` is treated as a *legacy* project hooks
// destination. The canonical Claude Code project hooks file is
// `.claude/settings.json` (committed/shared); `.local.json` is the
// per-developer, gitignored override Anthropic recommends for
// personal-only overrides. Linear writes to settings.json and sweeps
// stray `linear prime` entries out of settings.local.json on every
// `linear setup claude --project` so a user upgrading from a
// hypothetical pre-correction install doesn't end up double-firing the
// hook.
function legacyProjectClaudeSettings(cwd: string): string {
  return path.join(cwd, ".claude", "settings.local.json");
}

function globalClaudeSettings(home: string): string {
  return path.join(home, ".claude", "settings.json");
}

function resolveClaudeSettingsPath(opts: {
  cwd: string;
  global: boolean;
}): string {
  return opts.global
    ? globalClaudeSettings(os.homedir())
    : projectClaudeSettings(opts.cwd);
}

/**
 * Strip every linear-managed hook command from
 * `.claude/settings.local.json` (the legacy project location). Other
 * settings in the file are preserved verbatim. No-op when the file
 * doesn't exist, can't be parsed, or carries no managed hooks.
 *
 * Only runs at project scope — global Claude settings have always lived
 * at `.claude/settings.json`, no legacy to sweep.
 *
 * Returns the legacy path iff at least one hook command was removed,
 * so callers can surface "migrated X" to the user. Returns null
 * otherwise.
 */
function migrateLegacyClaudeSettings(cwd: string): string | null {
  const legacyPath = legacyProjectClaudeSettings(cwd);
  if (!fs.existsSync(legacyPath)) return null;
  let settings: ClaudeSettings;
  try {
    settings = readSettings(legacyPath);
  } catch {
    // Malformed legacy file — don't touch it, let the user resolve.
    return null;
  }
  if (!settings.hooks) return null;
  let removedAny = false;
  for (const event of CLAUDE_HOOK_EVENTS) {
    const arr = settings.hooks[event];
    if (!arr) continue;
    for (const variant of ALL_HOOK_COMMAND_VARIANTS) {
      if (removeHook(arr, variant)) removedAny = true;
    }
    settings.hooks[event] = arr.filter(
      (entry) => (entry.hooks ?? []).length > 0,
    );
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }
  if (!removedAny) return null;
  writeSettings(legacyPath, settings);
  return legacyPath;
}

interface HookCommand {
  type: "command";
  command: string;
}
interface HookEntry {
  matcher: string;
  hooks: HookCommand[];
}
interface ClaudeSettings {
  hooks?: Record<string, HookEntry[]>;
  // Other settings are preserved verbatim, hence the index signature.
  [key: string]: unknown;
}

function readSettings(filePath: string): ClaudeSettings {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as ClaudeSettings;
  } catch (e) {
    throw new Error(
      `Failed to parse ${filePath}: ${(e as Error).message}. Refusing to overwrite.`,
    );
  }
}

function writeSettings(filePath: string, settings: ClaudeSettings): void {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o644,
  });
}

/**
 * Merge `linear prime` into one event array. Returns true if the command
 * was newly added; false if it was already present.
 */
function addHook(events: HookEntry[], command: string): boolean {
  for (const entry of events) {
    for (const h of entry.hooks ?? []) {
      if (h.command === command) return false;
    }
  }
  events.push({
    matcher: "",
    hooks: [{ type: "command", command }],
  });
  return true;
}

/**
 * Remove the linear command from one event array. Empty hook entries are
 * pruned. Returns true if any command was removed.
 */
function removeHook(events: HookEntry[], command: string): boolean {
  let removed = false;
  for (const entry of events) {
    const before = entry.hooks?.length ?? 0;
    entry.hooks = (entry.hooks ?? []).filter((h) => h.command !== command);
    if (entry.hooks.length < before) removed = true;
  }
  return removed;
}

export function installClaude(opts: {
  cwd: string;
  global: boolean;
  stealth?: boolean;
}): ClaudeHookResult {
  const settingsPath = resolveClaudeSettingsPath(opts);
  const settings = readSettings(settingsPath);
  settings.hooks ??= {};
  const stealth = opts.stealth ?? false;
  const commands: Record<string, string> = {};
  const eventsAdded: string[] = [];
  for (const event of CLAUDE_HOOK_EVENTS) {
    const command = hookCommandForEvent(event, stealth);
    commands[event] = command;
    settings.hooks[event] ??= [];
    // Strip every other variant first (the stealth/non-stealth twin, or
    // a pre-TES-825 full-brief PreCompact entry) so re-running setup
    // doesn't leave a duplicate prime firing alongside the new command.
    for (const variant of ALL_HOOK_COMMAND_VARIANTS) {
      if (variant === command) continue;
      removeHook(settings.hooks[event], variant);
    }
    settings.hooks[event] = settings.hooks[event].filter(
      (entry) => (entry.hooks ?? []).length > 0,
    );
    if (addHook(settings.hooks[event], command)) {
      eventsAdded.push(event);
    }
  }
  writeSettings(settingsPath, settings);
  // Sweep stale linear hooks out of the legacy .claude/settings.local.json
  // at project scope only.
  const legacyMigrated = opts.global
    ? null
    : migrateLegacyClaudeSettings(opts.cwd);
  const result: ClaudeHookResult = {
    recipe: "claude",
    path: settingsPath,
    scope: opts.global ? "global" : "project",
    action: "installed",
    stealth,
    command: hookCommandFor(stealth),
    commands,
    events_added: eventsAdded,
  };
  if (legacyMigrated) result.legacy_migrated = legacyMigrated;
  return result;
}

export function checkClaude(opts: {
  cwd: string;
  global: boolean;
  stealth?: boolean;
}): ClaudeHookResult {
  const settingsPath = resolveClaudeSettingsPath(opts);
  const stealth = opts.stealth ?? false;
  const command = hookCommandFor(stealth);
  const commands = Object.fromEntries(
    CLAUDE_HOOK_EVENTS.map((event) => [
      event,
      hookCommandForEvent(event, stealth),
    ]),
  );
  if (!fs.existsSync(settingsPath)) {
    return {
      recipe: "claude",
      path: settingsPath,
      scope: opts.global ? "global" : "project",
      action: "checked",
      stealth,
      command,
      commands,
      installed: false,
    };
  }
  const settings = readSettings(settingsPath);
  const installed = CLAUDE_HOOK_EVENTS.every((event) => {
    const arr = settings.hooks?.[event] ?? [];
    return arr.some((entry) =>
      (entry.hooks ?? []).some((h) => h.command === commands[event]),
    );
  });
  return {
    recipe: "claude",
    path: settingsPath,
    scope: opts.global ? "global" : "project",
    action: "checked",
    stealth,
    command,
    commands,
    installed,
  };
}

export function removeClaude(opts: {
  cwd: string;
  global: boolean;
  stealth?: boolean;
}): ClaudeHookResult {
  const settingsPath = resolveClaudeSettingsPath(opts);
  const stealth = opts.stealth ?? false;
  const command = hookCommandFor(stealth);
  const result: ClaudeHookResult = {
    recipe: "claude",
    path: settingsPath,
    scope: opts.global ? "global" : "project",
    action: "removed",
    stealth,
    command,
    commands: Object.fromEntries(
      CLAUDE_HOOK_EVENTS.map((event) => [
        event,
        hookCommandForEvent(event, stealth),
      ]),
    ),
    events_removed: [],
  };
  // Run legacy migration up front so that even if the canonical
  // settings.json never existed, we still sweep stale linear hooks out
  // of the legacy `.claude/settings.local.json` and report
  // installed=true if anything was actually cleaned.
  const legacyMigratedEarly = opts.global
    ? null
    : migrateLegacyClaudeSettings(opts.cwd);
  if (legacyMigratedEarly) result.legacy_migrated = legacyMigratedEarly;
  if (!fs.existsSync(settingsPath)) {
    result.installed = legacyMigratedEarly !== null;
    return result;
  }
  const settings = readSettings(settingsPath);
  if (!settings.hooks) {
    result.installed = legacyMigratedEarly !== null;
    return result;
  }
  // Strip every variant on remove (both stealth and non-stealth) so
  // `--remove` produces a clean slate regardless of which was installed.
  for (const event of CLAUDE_HOOK_EVENTS) {
    const arr = settings.hooks[event];
    if (!arr) continue;
    let removedAny = false;
    for (const variant of ALL_HOOK_COMMAND_VARIANTS) {
      if (removeHook(arr, variant)) removedAny = true;
    }
    if (removedAny) result.events_removed?.push(event);
    // Prune empty events and zero-command entries (Claude Code rejects nulls).
    settings.hooks[event] = arr.filter(
      (entry) => (entry.hooks ?? []).length > 0,
    );
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }
  writeSettings(settingsPath, settings);
  // Legacy migration already ran up front; combine its outcome with the
  // canonical-file sweep result for the final installed flag.
  result.installed =
    (result.events_removed?.length ?? 0) > 0 || legacyMigratedEarly !== null;
  return result;
}

// ──────────────────────────────────────────────────────────────────────
// Gemini hook recipe: settings.json merge + GEMINI.md companion.
//
// Mirrors the Claude trio with two differences:
//   - Gemini CLI fires `PreCompress` (not `PreCompact`) before compaction.
//     Confirmed against the upstream Gemini CLI docs (geminicli.com/docs/
//     hooks, fossies.org/linux/gemini-cli/docs/hooks/index.md): the event
//     mapping table explicitly maps Claude's PreCompact -> Gemini's
//     PreCompress. Both events are recipe-managed.
//   - It needs a small instructions file at <cwd>/GEMINI.md so the agent
//     picks up the workflow even before the SessionStart hook fires.
//
// Both project- and global-scope hook installs still write GEMINI.md at
// the project cwd — the file is the agent's only pointer into the
// workflow when the hook hasn't run yet.
//
// Body choice: GEMINI.md uses WORKFLOW_BODY_MINIMAL. The hook fires
// `linear prime` on session start / pre-compress, which loads the full
// workflow context — the companion file only needs to be a pointer at
// that command (plus the `/plugin install linear` hint for Claude Code
// hosts). Other hookless recipes (codex, factory, opencode, mux) continue
// to use WORKFLOW_BODY since they have no hook to surface the cheat-sheet.
// ──────────────────────────────────────────────────────────────────────

export const GEMINI_HOOK_EVENTS = ["SessionStart", "PreCompress"] as const;
export const GEMINI_HOOK_COMMAND = HOOK_COMMAND;
export const GEMINI_HOOK_COMMAND_STEALTH = HOOK_COMMAND_STEALTH;
export const GEMINI_HOOK_COMMAND_MEMORIES = HOOK_COMMAND_MEMORIES;
export const GEMINI_INSTRUCTIONS_FILE = "GEMINI.md";

export interface GeminiHookResult {
  recipe: "gemini";
  path: string;
  scope: "project" | "global";
  action: "installed" | "checked" | "removed";
  /** Which `linear prime` variant this run targets. */
  stealth: boolean;
  /** The SessionStart command string written to settings.json. */
  command: string;
  /** Per-event command map (compaction events get --memories-only). */
  commands: Record<string, string>;
  events_added?: string[];
  events_removed?: string[];
  instructions_file: string;
  instructions_action?: "written" | "exists" | "removed" | "absent";
  installed?: boolean;
}

function projectGeminiSettings(cwd: string): string {
  return path.join(cwd, ".gemini", "settings.json");
}

function globalGeminiSettings(home: string): string {
  return path.join(home, ".gemini", "settings.json");
}

function resolveGeminiSettingsPath(opts: {
  cwd: string;
  global: boolean;
}): string {
  return opts.global
    ? globalGeminiSettings(os.homedir())
    : projectGeminiSettings(opts.cwd);
}

function geminiInstructionsPath(cwd: string): string {
  return path.join(cwd, GEMINI_INSTRUCTIONS_FILE);
}

export function installGemini(opts: {
  cwd: string;
  global: boolean;
  stealth?: boolean;
}): GeminiHookResult {
  const settingsPath = resolveGeminiSettingsPath(opts);
  const settings = readSettings(settingsPath);
  settings.hooks ??= {};
  const stealth = opts.stealth ?? false;
  const commands: Record<string, string> = {};
  const eventsAdded: string[] = [];
  for (const event of GEMINI_HOOK_EVENTS) {
    const command = hookCommandForEvent(event, stealth);
    commands[event] = command;
    settings.hooks[event] ??= [];
    for (const variant of ALL_HOOK_COMMAND_VARIANTS) {
      if (variant === command) continue;
      removeHook(settings.hooks[event], variant);
    }
    settings.hooks[event] = settings.hooks[event].filter(
      (entry) => (entry.hooks ?? []).length > 0,
    );
    if (addHook(settings.hooks[event], command)) {
      eventsAdded.push(event);
    }
  }
  writeSettings(settingsPath, settings);

  const insPath = geminiInstructionsPath(opts.cwd);
  let instructionsAction: "written" | "exists";
  if (fs.existsSync(insPath)) {
    instructionsAction = "exists";
  } else {
    ensureParentDir(insPath);
    // Minimal profile: hook fires `linear prime` on session start, so
    // GEMINI.md only needs to be a pointer.
    fs.writeFileSync(insPath, WORKFLOW_BODY_MINIMAL, { mode: 0o644 });
    instructionsAction = "written";
  }

  return {
    recipe: "gemini",
    path: settingsPath,
    scope: opts.global ? "global" : "project",
    action: "installed",
    stealth,
    command: hookCommandFor(stealth),
    commands,
    events_added: eventsAdded,
    instructions_file: insPath,
    instructions_action: instructionsAction,
  };
}

export function checkGemini(opts: {
  cwd: string;
  global: boolean;
  stealth?: boolean;
}): GeminiHookResult {
  const settingsPath = resolveGeminiSettingsPath(opts);
  const insPath = geminiInstructionsPath(opts.cwd);
  const insExists = fs.existsSync(insPath);
  const instructionsAction = insExists ? "exists" : "absent";
  const stealth = opts.stealth ?? false;
  const command = hookCommandFor(stealth);
  const commands = Object.fromEntries(
    GEMINI_HOOK_EVENTS.map((event) => [
      event,
      hookCommandForEvent(event, stealth),
    ]),
  );

  if (!fs.existsSync(settingsPath)) {
    return {
      recipe: "gemini",
      path: settingsPath,
      scope: opts.global ? "global" : "project",
      action: "checked",
      stealth,
      command,
      commands,
      installed: false,
      instructions_file: insPath,
      instructions_action: instructionsAction,
    };
  }
  const settings = readSettings(settingsPath);
  const installed =
    insExists &&
    GEMINI_HOOK_EVENTS.every((event) => {
      const arr = settings.hooks?.[event] ?? [];
      return arr.some((entry) =>
        (entry.hooks ?? []).some((h) => h.command === commands[event]),
      );
    });
  return {
    recipe: "gemini",
    path: settingsPath,
    scope: opts.global ? "global" : "project",
    action: "checked",
    stealth,
    command,
    commands,
    installed,
    instructions_file: insPath,
    instructions_action: instructionsAction,
  };
}

export function removeGemini(opts: {
  cwd: string;
  global: boolean;
  stealth?: boolean;
}): GeminiHookResult {
  const settingsPath = resolveGeminiSettingsPath(opts);
  const insPath = geminiInstructionsPath(opts.cwd);
  const stealth = opts.stealth ?? false;
  const command = hookCommandFor(stealth);
  const result: GeminiHookResult = {
    recipe: "gemini",
    path: settingsPath,
    scope: opts.global ? "global" : "project",
    action: "removed",
    stealth,
    command,
    commands: Object.fromEntries(
      GEMINI_HOOK_EVENTS.map((event) => [
        event,
        hookCommandForEvent(event, stealth),
      ]),
    ),
    events_removed: [],
    instructions_file: insPath,
  };

  if (fs.existsSync(settingsPath)) {
    const settings = readSettings(settingsPath);
    if (settings.hooks) {
      for (const event of GEMINI_HOOK_EVENTS) {
        const arr = settings.hooks[event];
        if (!arr) continue;
        let removedAny = false;
        for (const variant of ALL_HOOK_COMMAND_VARIANTS) {
          if (removeHook(arr, variant)) removedAny = true;
        }
        if (removedAny) result.events_removed?.push(event);
        settings.hooks[event] = arr.filter(
          (entry) => (entry.hooks ?? []).length > 0,
        );
        if (settings.hooks[event].length === 0) {
          delete settings.hooks[event];
        }
      }
      writeSettings(settingsPath, settings);
    }
  }

  if (fs.existsSync(insPath)) {
    fs.unlinkSync(insPath);
    result.instructions_action = "removed";
  } else {
    result.instructions_action = "absent";
  }

  const hooksRemoved = (result.events_removed?.length ?? 0) > 0;
  const fileRemoved = result.instructions_action === "removed";
  result.installed = hooksRemoved || fileRemoved;
  return result;
}

// ──────────────────────────────────────────────────────────────────────
// Codex section recipe: marker-bracketed managed block inside AGENTS.md.
//
// Writes <cwd>/AGENTS.md in project mode and $CODEX_HOME/AGENTS.md
// (fallback ~/.codex/AGENTS.md) in global mode. A BEGIN/END marker pair
// brackets a managed block that re-runs upsert in place, so users can
// edit the rest of AGENTS.md freely without losing their changes on the
// next `linear setup codex`.
//
// Compare with the `factory` / `opencode` file recipes, which also
// target AGENTS.md but own the whole file — running codex after factory
// will *merge into* what factory wrote rather than clobber it.
// ──────────────────────────────────────────────────────────────────────

export const CODEX_BEGIN_MARKER =
  "<!-- BEGIN LINEAR CODEX SETUP: generated by linear setup codex -->";
export const CODEX_END_MARKER = "<!-- END LINEAR CODEX SETUP -->";
export const CODEX_HOME_ENV_VAR = "CODEX_HOME";
export const CODEX_INSTRUCTIONS_FILE = "AGENTS.md";

export interface CodexSectionResult {
  recipe: "codex";
  path: string;
  scope: "project" | "global";
  action: "installed" | "checked" | "removed";
  instructions_action:
    | "written"
    | "updated"
    | "removed"
    | "absent"
    | "missing-marker"
    | "stale"
    | "current";
  /**
   * Agent-skill composite outcome — codex installs both an AGENTS.md
   * managed section AND the complete agent-skill tree.
   * `installed` on the parent CodexSectionResult is true only when BOTH
   * the section is current AND every agent-skill file is current. The
   * skill outcome is surfaced on the same envelope so consumers can render
   * both in one pass (see formatSetupCodex in src/commands/setup.ts).
   */
  agent_skill?: {
    paths: string[];
    /** All entries current post-op? */
    installed: boolean;
  };
  /**
   * Codex native-hooks composite outcome — codex also writes
   * `.codex/config.toml` (`[features] hooks = true`) and `.codex/hooks.json`
   * (the four managed `linear codex-hook <event>` entries). `installed` on
   * the parent CodexSectionResult is true only when the section, the
   * agent-skill, AND the native hooks are all current.
   */
  hooks_config?: CodexHooksConfigOutcome;
  installed?: boolean;
}

/**
 * Resolve the base directory the agent-skill multifile install writes
 * under, given codex's global flag — project cwd by default, $HOME for
 * `--global`.
 *
 * Note: --global codex writes the AGENTS.md to $CODEX_HOME (or
 * `~/.codex/`) while writing the agent-skill files to plain `$HOME`.
 * The asymmetry is deliberate — the agent-skill needs to live under a
 * generic `.agents/` tree, not codex's config dir.
 */
function codexAgentSkillBase(opts: { cwd: string; global: boolean }): string {
  return opts.global ? os.homedir() : opts.cwd;
}

function codexHomeDir(home: string): string {
  const env = process.env[CODEX_HOME_ENV_VAR];
  if (env && env.trim().length > 0) return env;
  return path.join(home, ".codex");
}

function resolveCodexInstructionsPath(opts: {
  cwd: string;
  global: boolean;
}): string {
  if (opts.global) {
    return path.join(codexHomeDir(os.homedir()), CODEX_INSTRUCTIONS_FILE);
  }
  return path.join(opts.cwd, CODEX_INSTRUCTIONS_FILE);
}

const CODEX_MARKERS: SectionMarkers = {
  begin: CODEX_BEGIN_MARKER,
  end: CODEX_END_MARKER,
  emptyHeader: "# Codex Instructions",
};

function codexCtx(opts: { cwd: string; global: boolean }): SectionRecipeCtx {
  return {
    filePath: resolveCodexInstructionsPath(opts),
    markers: CODEX_MARKERS,
  };
}

/**
 * Look up the agent-skill RecipeDef from the catalog. We need it for
 * codex's composite install/check/remove (codex installs the agent-skill
 * files, then the AGENTS.md managed section). Throws a clear error if
 * the catalog drift removes the entry — that would be a regression in
 * the setup-service.ts RECIPES table.
 */
function getAgentSkillRecipe(): RecipeDef & { files: MultiFileEntry[] } {
  const skill = RECIPES["agent-skill"];
  if (!skill || skill.kind !== "multifile" || !skill.files) {
    throw new Error(
      "agent-skill recipe missing from catalog — required by codex composite (file a bug)",
    );
  }
  return skill as RecipeDef & { files: MultiFileEntry[] };
}

export function installCodex(opts: {
  cwd: string;
  global: boolean;
}): CodexSectionResult {
  const ctx = codexCtx(opts);
  // Composite step 1: write the agent-skill files. For --global codex,
  // the skill base is $HOME, not $CODEX_HOME — the agent-skill tree
  // lives under the generic `.agents/` root rather than codex's config
  // dir.
  const skill = installMultiFileRecipe(
    getAgentSkillRecipe(),
    codexAgentSkillBase(opts),
  );
  // Composite step 2: AGENTS.md managed section.
  const outcome = runSectionRecipe("install", ctx);
  // Composite step 3: Codex native hooks — config.toml feature flag +
  // hooks.json managed entries.
  const hooks = installCodexNativeHooks(opts);
  return {
    recipe: "codex",
    path: ctx.filePath,
    scope: opts.global ? "global" : "project",
    action: "installed",
    instructions_action: outcome,
    agent_skill: { paths: skill.paths, installed: skill.installed },
    hooks_config: hooks,
  };
}

export function checkCodex(opts: {
  cwd: string;
  global: boolean;
}): CodexSectionResult {
  const ctx = codexCtx(opts);
  const skill = checkMultiFileRecipe(
    getAgentSkillRecipe(),
    codexAgentSkillBase(opts),
  );
  const outcome = runSectionRecipe("check", ctx);
  const hooks = checkCodexNativeHooks(opts);
  return {
    recipe: "codex",
    path: ctx.filePath,
    scope: opts.global ? "global" : "project",
    action: "checked",
    // Composite check: only "installed" if the section is current AND every
    // agent-skill file matches AND the native hooks are current. Any side
    // stale = not installed.
    installed: outcome === "current" && skill.installed && hooks.installed,
    instructions_action: outcome,
    agent_skill: { paths: skill.paths, installed: skill.installed },
    hooks_config: hooks,
  };
}

export function removeCodex(opts: {
  cwd: string;
  global: boolean;
}): CodexSectionResult {
  const ctx = codexCtx(opts);
  // Remove agent-skill first so a partial failure leaves the AGENTS.md
  // section pointing at nothing rather than the inverse.
  const skill = removeMultiFileRecipe(
    getAgentSkillRecipe(),
    codexAgentSkillBase(opts),
  );
  const outcome = runSectionRecipe("remove", ctx);
  const hooks = removeCodexNativeHooks(opts);
  return {
    recipe: "codex",
    path: ctx.filePath,
    scope: opts.global ? "global" : "project",
    action: "removed",
    // `installed` here records whether anything was actually removed.
    // True iff the section existed OR any skill file existed OR any native
    // hooks existed pre-remove ("did we clean up anything?" semantics).
    installed: outcome === "removed" || skill.installed || hooks.installed,
    instructions_action: outcome,
    agent_skill: { paths: skill.paths, installed: skill.installed },
    hooks_config: hooks,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Mux section recipe: three independent layers managed by the same
// BEGIN/END markers — `<cwd>/AGENTS.md` (always), `<cwd>/.mux/AGENTS.md`
// (when --project is set or by default), and `~/.mux/AGENTS.md` (when
// --global is set).
//
// linear omits the three mux shell hook scripts (.mux/init, tool_post,
// tool_env) — they have no analog in the stateless linear CLI. The
// user-facing AGENTS.md surface is what matters for agent
// discoverability, so that's the entire scope of this recipe.
//
// Layers compose independently — install with `--global` keeps the
// `--project` layer untouched, and vice-versa. The result envelope
// reports every layer that was touched so operators can audit a
// multi-layer run in one shot.
// ──────────────────────────────────────────────────────────────────────

export const MUX_BEGIN_MARKER =
  "<!-- BEGIN LINEAR MUX SETUP: generated by linear setup mux -->";
export const MUX_END_MARKER = "<!-- END LINEAR MUX SETUP -->";
export const MUX_INSTRUCTIONS_FILE = "AGENTS.md";
export const MUX_PROJECT_DIR = ".mux";

const MUX_MARKERS: SectionMarkers = {
  begin: MUX_BEGIN_MARKER,
  end: MUX_END_MARKER,
  emptyHeader: "# Mux Instructions",
};

export type MuxLayer = "base" | "project" | "global";

export interface MuxLayerResult {
  layer: MuxLayer;
  path: string;
  action:
    | "written"
    | "updated"
    | "removed"
    | "absent"
    | "missing-marker"
    | "stale"
    | "current";
}

export interface MuxResult {
  recipe: "mux";
  action: "installed" | "checked" | "removed";
  layers: MuxLayerResult[];
  /** True iff every requested layer is currently in its desired state. */
  installed: boolean;
}

interface MuxOpts {
  cwd: string;
  /** Add a managed section to <cwd>/.mux/AGENTS.md. */
  project: boolean;
  /** Add a managed section to ~/.mux/AGENTS.md. */
  global: boolean;
}

function muxBasePath(cwd: string): string {
  return path.join(cwd, MUX_INSTRUCTIONS_FILE);
}

function muxProjectPath(cwd: string): string {
  return path.join(cwd, MUX_PROJECT_DIR, MUX_INSTRUCTIONS_FILE);
}

function muxGlobalPath(): string {
  return path.join(os.homedir(), MUX_PROJECT_DIR, MUX_INSTRUCTIONS_FILE);
}

function muxLayerPaths(
  opts: MuxOpts,
): Array<{ layer: MuxLayer; path: string }> {
  const layers: Array<{ layer: MuxLayer; path: string }> = [
    { layer: "base", path: muxBasePath(opts.cwd) },
  ];
  if (opts.project)
    layers.push({ layer: "project", path: muxProjectPath(opts.cwd) });
  if (opts.global) layers.push({ layer: "global", path: muxGlobalPath() });
  return layers;
}

function muxLayerCtx(filePath: string): SectionRecipeCtx {
  return {
    filePath,
    markers: MUX_MARKERS,
  };
}

function runOneMuxLayer(
  op: SectionOp,
  layer: MuxLayer,
  filePath: string,
): MuxLayerResult {
  const action = runSectionRecipe(op, muxLayerCtx(filePath));
  return { layer, path: filePath, action };
}

export function installMux(opts: MuxOpts): MuxResult {
  const layers = muxLayerPaths(opts).map(({ layer, path: p }) =>
    runOneMuxLayer("install", layer, p),
  );
  return {
    recipe: "mux",
    action: "installed",
    layers,
    installed: layers.every(
      (l) => l.action === "written" || l.action === "updated",
    ),
  };
}

export function checkMux(opts: MuxOpts): MuxResult {
  const layers = muxLayerPaths(opts).map(({ layer, path: p }) =>
    runOneMuxLayer("check", layer, p),
  );
  return {
    recipe: "mux",
    action: "checked",
    layers,
    installed: layers.every((l) => l.action === "current"),
  };
}

export function removeMux(opts: MuxOpts): MuxResult {
  const layers = muxLayerPaths(opts).map(({ layer, path: p }) =>
    runOneMuxLayer("remove", layer, p),
  );
  return {
    recipe: "mux",
    action: "removed",
    layers,
    installed: layers.some((l) => l.action === "removed"),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Agents section recipe: managed AGENTS.md block holding the same short
// snippet that `linear onboard` prints. The snippet just points the
// agent at `linear prime` for dynamic workflow context — unlike codex
// (which embeds the full workflow body), this recipe stays lean so the
// AGENTS.md surface doesn't have to be re-rendered every time the
// workflow changes.
//
// Targets `<cwd>/AGENTS.md` in project mode and `~/.config/AGENTS.md`
// in global mode (XDG path). Profile support (full/minimal) is out of
// scope here; a follow-up can layer it on top of the same marker pair.
// ──────────────────────────────────────────────────────────────────────

export const AGENTS_BEGIN_MARKER =
  "<!-- BEGIN LINEAR INTEGRATION: generated by linear setup agents -->";
export const AGENTS_END_MARKER = "<!-- END LINEAR INTEGRATION -->";
export const AGENTS_INSTRUCTIONS_FILE = "AGENTS.md";

export interface AgentsSectionResult {
  recipe: "agents";
  path: string;
  scope: "project" | "global";
  action: "installed" | "checked" | "removed";
  instructions_action:
    | "written"
    | "updated"
    | "removed"
    | "absent"
    | "missing-marker"
    | "stale"
    | "current";
  installed?: boolean;
}

const AGENTS_MARKERS: SectionMarkers = {
  begin: AGENTS_BEGIN_MARKER,
  end: AGENTS_END_MARKER,
  emptyHeader: "# Agent Instructions",
  body: AGENTS_SNIPPET,
};

function resolveAgentsInstructionsPath(opts: {
  cwd: string;
  global: boolean;
}): string {
  if (opts.global) {
    return path.join(os.homedir(), ".config", AGENTS_INSTRUCTIONS_FILE);
  }
  return path.join(opts.cwd, AGENTS_INSTRUCTIONS_FILE);
}

function agentsCtx(opts: { cwd: string; global: boolean }): SectionRecipeCtx {
  return {
    filePath: resolveAgentsInstructionsPath(opts),
    markers: AGENTS_MARKERS,
  };
}

export function installAgents(opts: {
  cwd: string;
  global: boolean;
}): AgentsSectionResult {
  const ctx = agentsCtx(opts);
  const outcome = runSectionRecipe("install", ctx);
  return {
    recipe: "agents",
    path: ctx.filePath,
    scope: opts.global ? "global" : "project",
    action: "installed",
    instructions_action: outcome,
  };
}

export function checkAgents(opts: {
  cwd: string;
  global: boolean;
}): AgentsSectionResult {
  const ctx = agentsCtx(opts);
  const outcome = runSectionRecipe("check", ctx);
  return {
    recipe: "agents",
    path: ctx.filePath,
    scope: opts.global ? "global" : "project",
    action: "checked",
    installed: outcome === "current",
    instructions_action: outcome,
  };
}

export function removeAgents(opts: {
  cwd: string;
  global: boolean;
}): AgentsSectionResult {
  const ctx = agentsCtx(opts);
  const outcome = runSectionRecipe("remove", ctx);
  return {
    recipe: "agents",
    path: ctx.filePath,
    scope: opts.global ? "global" : "project",
    action: "removed",
    installed: outcome === "removed",
    instructions_action: outcome,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Factory section recipe — managed AGENTS.md block.
//
// Writes a Factory-specific marker pair into <cwd>/AGENTS.md. User
// content outside the marker pair round-trips safely.
//
// The body is the full WORKFLOW_BODY (Factory Droid runs hookless and
// needs the inline command reference). Codex / agents use different
// markers + bodies — every section recipe owns its own marker pair so
// re-running `linear setup codex` after `linear setup factory` doesn't
// accidentally rewrite the wrong block.
// ──────────────────────────────────────────────────────────────────────

export const FACTORY_BEGIN_MARKER =
  "<!-- BEGIN LINEAR FACTORY SETUP: generated by linear setup factory -->";
export const FACTORY_END_MARKER = "<!-- END LINEAR FACTORY SETUP -->";
export const FACTORY_INSTRUCTIONS_FILE = "AGENTS.md";

export interface FactorySectionResult {
  recipe: "factory";
  path: string;
  scope: "project";
  action: "installed" | "checked" | "removed";
  instructions_action:
    | "written"
    | "updated"
    | "removed"
    | "absent"
    | "missing-marker"
    | "stale"
    | "current";
  installed?: boolean;
}

const FACTORY_MARKERS: SectionMarkers = {
  begin: FACTORY_BEGIN_MARKER,
  end: FACTORY_END_MARKER,
  emptyHeader: "# Factory Droid Instructions",
  body: WORKFLOW_BODY,
};

function factoryCtx(opts: { cwd: string }): SectionRecipeCtx {
  return {
    filePath: path.join(opts.cwd, FACTORY_INSTRUCTIONS_FILE),
    markers: FACTORY_MARKERS,
  };
}

export function installFactory(opts: { cwd: string }): FactorySectionResult {
  const ctx = factoryCtx(opts);
  const outcome = runSectionRecipe("install", ctx);
  return {
    recipe: "factory",
    path: ctx.filePath,
    scope: "project",
    action: "installed",
    instructions_action: outcome,
  };
}

export function checkFactory(opts: { cwd: string }): FactorySectionResult {
  const ctx = factoryCtx(opts);
  const outcome = runSectionRecipe("check", ctx);
  return {
    recipe: "factory",
    path: ctx.filePath,
    scope: "project",
    action: "checked",
    installed: outcome === "current",
    instructions_action: outcome,
  };
}

export function removeFactory(opts: { cwd: string }): FactorySectionResult {
  const ctx = factoryCtx(opts);
  const outcome = runSectionRecipe("remove", ctx);
  return {
    recipe: "factory",
    path: ctx.filePath,
    scope: "project",
    action: "removed",
    installed: outcome === "removed",
    instructions_action: outcome,
  };
}

// ──────────────────────────────────────────────────────────────────────
// OpenCode section recipe — managed AGENTS.md block.
//
// Writes an OpenCode-specific marker pair into <cwd>/AGENTS.md so the
// codex / factory / opencode managed blocks coexist in the same
// AGENTS.md without overwriting each other.
//
// The body is the full WORKFLOW_BODY (OpenCode runs hookless and needs
// the inline command reference). Mirrors the factory section recipe
// shape one-for-one — only the marker label, file constant, and result
// `recipe` literal differ.
// ──────────────────────────────────────────────────────────────────────

export const OPENCODE_BEGIN_MARKER =
  "<!-- BEGIN LINEAR OPENCODE SETUP: generated by linear setup opencode -->";
export const OPENCODE_END_MARKER = "<!-- END LINEAR OPENCODE SETUP -->";
export const OPENCODE_INSTRUCTIONS_FILE = "AGENTS.md";

export interface OpencodeSectionResult {
  recipe: "opencode";
  path: string;
  scope: "project";
  action: "installed" | "checked" | "removed";
  instructions_action:
    | "written"
    | "updated"
    | "removed"
    | "absent"
    | "missing-marker"
    | "stale"
    | "current";
  installed?: boolean;
}

const OPENCODE_MARKERS: SectionMarkers = {
  begin: OPENCODE_BEGIN_MARKER,
  end: OPENCODE_END_MARKER,
  emptyHeader: "# OpenCode Instructions",
  body: WORKFLOW_BODY,
};

function opencodeCtx(opts: { cwd: string }): SectionRecipeCtx {
  return {
    filePath: path.join(opts.cwd, OPENCODE_INSTRUCTIONS_FILE),
    markers: OPENCODE_MARKERS,
  };
}

export function installOpencode(opts: { cwd: string }): OpencodeSectionResult {
  const ctx = opencodeCtx(opts);
  const outcome = runSectionRecipe("install", ctx);
  return {
    recipe: "opencode",
    path: ctx.filePath,
    scope: "project",
    action: "installed",
    instructions_action: outcome,
  };
}

export function checkOpencode(opts: { cwd: string }): OpencodeSectionResult {
  const ctx = opencodeCtx(opts);
  const outcome = runSectionRecipe("check", ctx);
  return {
    recipe: "opencode",
    path: ctx.filePath,
    scope: "project",
    action: "checked",
    installed: outcome === "current",
    instructions_action: outcome,
  };
}

export function removeOpencode(opts: { cwd: string }): OpencodeSectionResult {
  const ctx = opencodeCtx(opts);
  const outcome = runSectionRecipe("remove", ctx);
  return {
    recipe: "opencode",
    path: ctx.filePath,
    scope: "project",
    action: "removed",
    installed: outcome === "removed",
    instructions_action: outcome,
  };
}
