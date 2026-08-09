/**
 * `linear init` — first-run setup orchestrator.
 *
 * linear has no local store, so init focuses on the workflow surface:
 *
 *   1. Save the team (and persisted agents.file) — inside a git repo
 *      the `--team` flag writes to `<repo>/.linear/config.json` as
 *      `scope.team` (per-repo override); outside a git repo it falls
 *      back to writing `team.default` to `~/.linear/config.json`
 *      (the legacy global behavior).
 *   2. Validate identity online via `runContext()` (viewer + workspace +
 *      default-team resolution).
 *   3. Render an `AGENTS.md` (managed block, marker-versioned). Profile is
 *      `minimal` by default for hook-driven agents; `full` for hookless
 *      agents (Codex, Factory, Mux). Existing `full` content is preserved
 *      across re-runs to avoid information loss.
 *   4. Write a thin `CLAUDE.md` pointer when absent (never overwrites).
 *   5. Install recipe artefacts via the existing `setup-service` recipe
 *      installers (claude/gemini hooks, cursor/windsurf rules, etc.).
 *   6. Install lefthook / git-hooks shims via `hooks-service.installHooks`
 *      so quality gates fire on commit / push.
 *
 * The wizard is mutation-shaped (its output is the success record) but the
 * interactive flow runs only when stdin is a TTY AND no `--non-interactive`
 * / `--quiet` / `LINEAR_NON_INTERACTIVE` / CI env var is set. In every
 * non-TTY context we fall back to a deterministic default plan — keeps
 * `linear init` scriptable from CI without surprise.
 *
 * Architecture: this is a service (Layer 3). It takes a pre-built
 * `GraphQLClient` and pre-validated options. ID resolution, prompt I/O,
 * and command-flag parsing live in `commands/init.ts`. Recipe installs
 * delegate to `setup-service`; hook installs delegate to `hooks-service`.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { GraphQLClient } from "../client/graphql-client.js";
import {
  findLocalConfigPath,
  getConfig,
  setConfig,
} from "../common/config-store.js";
import {
  createPromptIO,
  PromptCanceled,
  type PromptIO,
  promptMultiPick,
  promptYesNo,
  resolveInteractiveMode,
} from "../common/prompt.js";
import {
  type AgentsProfile,
  profileBody,
  upsertSection,
} from "../templates/agents-section.js";
import { CLAUDE_POINTER } from "../templates/claude-pointer.js";
import { type ContextResult, runContext } from "./context-service.js";
import {
  GitRepoMissingError,
  type HooksInstallResult,
  installHooks,
  LefthookMissingError,
} from "./hooks-service.js";
import {
  type AgentsSectionResult,
  type ClaudeHookResult,
  type CodexSectionResult,
  type FactorySectionResult,
  type FileRecipeResult,
  type GeminiHookResult,
  installAgents,
  installClaude,
  installCodex,
  installFactory,
  installFileRecipe,
  installGemini,
  installMultiFileRecipe,
  installMux,
  installOpencode,
  type MultiFileRecipeResult,
  type MuxResult,
  type OpencodeSectionResult,
  RECIPES,
} from "./setup-service.js";

const DEFAULT_AGENTS_PATH = "AGENTS.md";
const DEFAULT_CLAUDE_POINTER_PATH = "CLAUDE.md";

/**
 * Local-only paths a stealth init hides from the shared repo: `.linear/`
 * (per-repo config + the post-commit close queue) and
 * `.claude/settings.local.json` (the per-user Claude settings file). Patterns
 * are repo-root-relative, which is exactly what `.git/info/exclude` expects.
 */
export const STEALTH_EXCLUDE_PATTERNS = [
  ".linear/",
  ".claude/settings.local.json",
];

const STEALTH_EXCLUDE_HEADER =
  "# Linear stealth mode (added by linear init --stealth)";

/** Outcome of the stealth `.git/info/exclude` step. */
export interface StealthExcludeResult {
  /** The exclude file written, or null when cwd is not a git repo. */
  path: string | null;
  /** Patterns appended this run. */
  added: string[];
  /** Patterns already present (left untouched — idempotent). */
  already_present: string[];
  /** True when cwd is not a git repo, so the step was skipped. */
  skipped_not_git: boolean;
}

/**
 * Resolve the common `.git` directory for `cwd` (the main repo's, not a
 * worktree's `.git/worktrees/<name>`), so the exclude
 * applies repo-wide. Returns undefined when `cwd` is not a git repo.
 */
function gitCommonDir(cwd: string): string | undefined {
  try {
    const out = execFileSync(
      "git",
      ["-C", cwd, "rev-parse", "--git-common-dir"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return out === "" ? undefined : out;
  } catch {
    return undefined;
  }
}

/**
 * Stealth git-exclude: append linear's local-only paths to
 * `.git/info/exclude` so a managed-branch / no-push contributor stays
 * invisible to collaborators without touching the tracked `.gitignore`.
 *
 * Per-repo and idempotent: existing patterns are detected by exact-line
 * match and left alone; only missing ones are appended under a marker
 * header. Skips gracefully (no throw) when `cwd` is not a git repo —
 * stealth is best-effort, never a hard init failure.
 */
export function setupGitExclude(cwd: string): StealthExcludeResult {
  const common = gitCommonDir(cwd);
  if (!common) {
    return {
      path: null,
      added: [],
      already_present: [],
      skipped_not_git: true,
    };
  }
  // --git-common-dir may be relative to cwd; resolve it so the write lands
  // in the right place regardless of where init was invoked.
  const gitDir = path.isAbsolute(common) ? common : path.join(cwd, common);
  const infoDir = path.join(gitDir, "info");
  const excludePath = path.join(infoDir, "exclude");

  let existing = "";
  if (fs.existsSync(excludePath)) {
    existing = fs.readFileSync(excludePath, "utf8");
  }
  const lines = existing.split("\n").map((l) => l.trim());

  const added: string[] = [];
  const alreadyPresent: string[] = [];
  for (const pattern of STEALTH_EXCLUDE_PATTERNS) {
    if (lines.includes(pattern)) alreadyPresent.push(pattern);
    else added.push(pattern);
  }

  if (added.length === 0) {
    return {
      path: excludePath,
      added: [],
      already_present: alreadyPresent,
      skipped_not_git: false,
    };
  }

  fs.mkdirSync(infoDir, { recursive: true });
  let next = existing;
  if (next.length > 0 && !next.endsWith("\n")) next += "\n";
  next += `\n${STEALTH_EXCLUDE_HEADER}\n`;
  for (const pattern of added) next += `${pattern}\n`;
  fs.writeFileSync(excludePath, next, "utf8");

  return {
    path: excludePath,
    added,
    already_present: alreadyPresent,
    skipped_not_git: false,
  };
}

/**
 * Recipes selectable from the wizard's recipe-pick step. Ordered the way
 * the prompt presents them (most-common first). All names map to entries
 * in `setup-service.RECIPES`.
 */
export const INIT_RECIPE_CHOICES = [
  "claude",
  "gemini",
  "cursor",
  "windsurf",
  "codex",
  "factory",
  "opencode",
  "agents",
  "mux",
  "aider",
  "junie",
  "cody",
  "kilocode",
  "agent-skill",
] as const;

/**
 * Default recipe picks when the wizard runs non-interactively (CI / no
 * TTY). Install just the Claude hook so `SessionStart` fires
 * `linear prime`. The user can opt into more via `--recipes` or by
 * re-running interactively.
 */
export const DEFAULT_INIT_RECIPES: readonly string[] = ["claude"];

/**
 * Hook kinds the wizard offers. linear's `hooks-service` installs
 * lefthook overlays (when `lefthook.yml` is present) or a `.git/hooks/`
 * shim otherwise — both via the same `installHooks` entrypoint. The
 * "lefthook" / "git-hooks" choice is opt-into-anything-vs-nothing; the
 * service auto-detects which target.
 */
export const INIT_HOOK_CHOICES = ["auto"] as const;
export const DEFAULT_INIT_HOOKS: readonly string[] = ["auto"];

export type Role = "maintainer" | "contributor";

export interface InitOpts {
  client: GraphQLClient;
  cliVersion: string;
  /**
   * When set, persisted BEFORE the identity probe. In a git repo it is
   * written to local `scope.team`; outside a git repo it falls back to
   * global `team.default`.
   */
  team?: string;
  /** Skip AGENTS.md write, CLAUDE.md write, recipe installs. */
  skipAgents?: boolean;
  /** Skip lefthook / git-hooks installer. Reported in result. */
  skipHooks?: boolean;
  /**
   * Stealth umbrella — skips AGENTS.md, CLAUDE.md, recipes, hooks; team
   * config still writes.
   */
  stealth?: boolean;
  /**
   * Contributor mode — skips writing any local config or installer.
   * Identity probe still runs (so the user can see they're authed),
   * but nothing on disk changes outside ~/.linear.
   */
  contributor?: boolean;
  /** Override the resolved role explicitly. */
  role?: Role;
  /** Force non-interactive mode (no prompts). */
  nonInteractive?: boolean;
  /** Quiet mode — implies non-interactive, suppresses prompt output. */
  quiet?: boolean;
  /**
   * Explicit recipe pick list. When set, the wizard skips the recipe
   * prompt. Pass `[]` to install zero recipes. When undefined and
   * interactive, the wizard prompts; non-interactive falls back to
   * {@link DEFAULT_INIT_RECIPES}.
   */
  recipes?: readonly string[];
  /**
   * Explicit hook pick list. When set, skips the hook prompt. Pass `[]`
   * to install zero hooks (useful in tests and tmpdirs without `.git`).
   */
  hooks?: readonly string[];
  /** AGENTS.md profile (default: minimal). */
  agentsProfile?: AgentsProfile;
  /**
   * Override the AGENTS.md filename (e.g. "NOTES.md"). Default reads
   * `agents.file` from config, then falls back to "AGENTS.md".
   */
  agentsFile?: string;
  /**
   * Path to a custom AGENTS.md template body. When set, the file is
   * written verbatim (no managed-block wrapping); the user owns the
   * content.
   */
  agentsTemplate?: string;
  /** Project directory for file writes. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Inject env for tests. Production reads `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Inject TTY state for tests. Production uses `process.stdin.isTTY`. */
  isTTY?: boolean;
  /**
   * Inject a prompt IO adapter for tests. Production creates one with
   * `createPromptIO()` when the wizard runs.
   */
  promptIO?: PromptIO;
}

export type AgentsAction =
  | "created"
  | "exists"
  | "appended"
  | "replaced"
  | "current"
  | "preserved"
  | "skipped";

export type ClaudeMdAction = "created" | "exists" | "skipped";

/**
 * One recipe install outcome — keyed by recipe name for easy
 * aggregation. The `result` shape varies per recipe kind; consumers
 * narrow via the `recipe` discriminator.
 */
export type InitRecipeResult =
  | ClaudeHookResult
  | GeminiHookResult
  | CodexSectionResult
  | FactorySectionResult
  | MuxResult
  | OpencodeSectionResult
  | AgentsSectionResult
  | FileRecipeResult
  | MultiFileRecipeResult;

export interface InitRecipeOutcome {
  recipe: string;
  result: InitRecipeResult;
}

export interface InitResult {
  backend: "linear";
  /** Role this init run took (default: "maintainer"). */
  role: Role;
  /** Whether the wizard ran interactively. */
  interactive: boolean;
  /** Stealth flag — true when the umbrella was active. */
  stealth: boolean;
  context: ContextResult;
  team_written: string | null;
  /** AGENTS.md target path (null when skipped). */
  agents_file: string | null;
  agents_action: AgentsAction;
  /** Effective AGENTS.md profile written. */
  agents_profile: AgentsProfile;
  /** CLAUDE.md pointer file path (null when skipped). */
  claude_md_file: string | null;
  claude_md_action: ClaudeMdAction;
  /**
   * Claude SessionStart hook install result. Populated when the `claude`
   * recipe is selected (which is the default plan). Kept at top level for
   * backward compat with the format layer; also appears in `recipes`.
   */
  claude_hook: ClaudeHookResult | null;
  /** Every recipe installer result, in install order. */
  recipes: InitRecipeOutcome[];
  /** Lefthook / git-hooks install result; null when skipped. */
  hooks: HooksInstallResult | null;
  /** Always populated — describes why hooks weren't installed (if not). */
  hooks_skipped_reason: string;
  /**
   * Stealth `.git/info/exclude` outcome. Populated only when `--stealth`
   * ran (null otherwise) — see {@link setupGitExclude}.
   */
  stealth_exclude: StealthExcludeResult | null;
}

/**
 * Resolve the role for this init run. Explicit `role` wins; then
 * `--contributor` flag; otherwise default maintainer.
 */
function resolveRole(opts: InitOpts): Role {
  if (opts.role) return opts.role;
  if (opts.contributor) return "contributor";
  return "maintainer";
}

/**
 * Default plan: which recipes and hooks to install when the wizard runs
 * non-interactively with no explicit pick lists. Stealth + contributor
 * each zero this out (the umbrella flags assume the user wants no
 * disk changes).
 */
function defaultPlan(
  opts: InitOpts,
  role: Role,
): {
  recipes: readonly string[];
  hooks: readonly string[];
} {
  if (opts.stealth || role === "contributor") {
    return { recipes: [], hooks: [] };
  }
  return {
    recipes: opts.recipes ?? DEFAULT_INIT_RECIPES,
    hooks: opts.hooks ?? DEFAULT_INIT_HOOKS,
  };
}

/**
 * Dispatch a single recipe install to the right installer. Returns a
 * uniform InitRecipeOutcome so the result array stays type-stable across
 * recipe kinds.
 */
function installOneRecipe(
  name: string,
  ctx: { cwd: string; stealth: boolean },
): InitRecipeOutcome | null {
  const recipe = RECIPES[name];
  if (!recipe) return null;
  switch (recipe.kind) {
    case "hook": {
      if (name === "claude") {
        // Default to global so a fresh user gets the SessionStart hook
        // even outside a project tree.
        const r = installClaude({
          cwd: ctx.cwd,
          global: true,
          stealth: ctx.stealth,
        });
        return { recipe: name, result: r };
      }
      if (name === "gemini") {
        const r = installGemini({
          cwd: ctx.cwd,
          global: true,
          stealth: ctx.stealth,
        });
        return { recipe: name, result: r };
      }
      return null;
    }
    case "section": {
      if (name === "codex") {
        const r = installCodex({ cwd: ctx.cwd, global: false });
        return { recipe: name, result: r };
      }
      if (name === "factory") {
        const r = installFactory({ cwd: ctx.cwd });
        return { recipe: name, result: r };
      }
      if (name === "opencode") {
        const r = installOpencode({ cwd: ctx.cwd });
        return { recipe: name, result: r };
      }
      if (name === "mux") {
        // Base layer only — the base AGENTS.md managed block is the
        // common case from a wizard run. Users wanting `.mux/AGENTS.md`
        // or `~/.mux/AGENTS.md` should call `linear setup mux` directly.
        const r = installMux({
          cwd: ctx.cwd,
          project: false,
          global: false,
        });
        return { recipe: name, result: r };
      }
      if (name === "agents") {
        const r = installAgents({ cwd: ctx.cwd, global: false });
        return { recipe: name, result: r };
      }
      return null;
    }
    case "file": {
      const r = installFileRecipe(recipe, ctx.cwd);
      return { recipe: name, result: r };
    }
    case "multifile": {
      const r = installMultiFileRecipe(recipe, ctx.cwd);
      return { recipe: name, result: r };
    }
    default:
      return null;
  }
}

/**
 * Install every selected recipe in order. Unknown recipes are silently
 * dropped — the wizard's pick step is responsible for validating names
 * before they get here.
 */
function installFromCatalog(
  picks: readonly string[],
  ctx: { cwd: string; stealth: boolean },
): InitRecipeOutcome[] {
  const out: InitRecipeOutcome[] = [];
  for (const name of picks) {
    const outcome = installOneRecipe(name, ctx);
    if (outcome) out.push(outcome);
  }
  return out;
}

/**
 * Write the AGENTS.md file. Behavior depends on whether the user passed
 * a custom template:
 *
 *   - `agentsTemplate` set: the template body is written verbatim. We do
 *     NOT wrap it in managed-block markers — the user is taking
 *     responsibility for the whole file. Action is "created" when the
 *     file is fresh, "exists" otherwise (we never clobber).
 *   - Otherwise: the managed-block upsert runs, which produces
 *     created/appended/replaced/current/preserved depending on what's
 *     already on disk.
 */
function writeAgentsFile(opts: {
  cwd: string;
  fileName: string;
  profile: AgentsProfile;
  templatePath?: string;
}): { file: string; action: AgentsAction; profile: AgentsProfile } {
  const targetPath = path.join(opts.cwd, opts.fileName);
  if (opts.templatePath) {
    if (fs.existsSync(targetPath)) {
      return { file: targetPath, action: "exists", profile: opts.profile };
    }
    const body = fs.readFileSync(opts.templatePath, "utf8");
    fs.writeFileSync(targetPath, body, "utf8");
    return { file: targetPath, action: "created", profile: opts.profile };
  }
  const existing = fs.existsSync(targetPath)
    ? fs.readFileSync(targetPath, "utf8")
    : null;
  const outcome = upsertSection(existing, opts.profile);
  fs.writeFileSync(targetPath, outcome.next, "utf8");
  return {
    file: targetPath,
    action: outcome.action,
    profile: outcome.profile,
  };
}

/**
 * Write the thin CLAUDE.md pointer. Never overwrites — if a CLAUDE.md
 * already exists in cwd, leaves it alone.
 */
function writeClaudePointer(cwd: string): {
  file: string;
  action: ClaudeMdAction;
} {
  const targetPath = path.join(cwd, DEFAULT_CLAUDE_POINTER_PATH);
  if (fs.existsSync(targetPath)) {
    return { file: targetPath, action: "exists" };
  }
  fs.writeFileSync(targetPath, CLAUDE_POINTER, "utf8");
  return { file: targetPath, action: "created" };
}

/**
 * Resolve effective AGENTS.md filename. Precedence:
 *
 *   1. Explicit `opts.agentsFile`.
 *   2. Persisted config `agents.file`.
 *   3. Default "AGENTS.md".
 *
 * Side effect: when an explicit override is passed via flag, we persist
 * it to `~/.linear/config.json` so subsequent runs honor the choice
 * without re-passing the flag (`agents.file` config key).
 */
function resolveAgentsFile(opts: InitOpts): string {
  if (opts.agentsFile) {
    setConfig("agents.file", opts.agentsFile);
    return opts.agentsFile;
  }
  const persisted = getConfig("agents.file").value;
  if (persisted) return persisted;
  return DEFAULT_AGENTS_PATH;
}

/**
 * Run the interactive wizard. Each prompt has a default so that the user
 * who just hits Enter through the whole flow ends up with the default
 * plan. Returns null when the user cancels (Ctrl-C / EOF on stdin).
 *
 * Wizard shape (post Phase 9 — implicit scope rollout):
 *   - recipes multi-pick
 *   - hooks multi-pick
 *   - confirm
 *
 * Team selection is no longer prompted here: with implicit per-repo scope
 * (`git:<name>` label written to `.linear/config.json`), reads narrow
 * by label rather than team, and `linear next` works without a team
 * default. Callers can still pass `--team` explicitly; that flows
 * through `opts.team` and `setConfig` writes either `scope.team` (when
 * inside a git repo) or `team.default` (otherwise).
 */
async function runWizard(opts: {
  io: PromptIO;
  defaults: {
    recipes: readonly string[];
    hooks: readonly string[];
  };
}): Promise<{
  recipes: readonly string[];
  hooks: readonly string[];
} | null> {
  try {
    const recipes = await promptMultiPick(
      opts.io,
      "Which agent integrations should I install?",
      INIT_RECIPE_CHOICES,
      opts.defaults.recipes,
    );
    const hooks = await promptMultiPick(
      opts.io,
      "Install git/lefthook quality-gate hooks?",
      INIT_HOOK_CHOICES,
      opts.defaults.hooks,
    );
    const confirmed = await promptYesNo(opts.io, "Proceed with setup?", true);
    if (!confirmed) return null;
    return { recipes, hooks };
  } catch (err) {
    if (err instanceof PromptCanceled) return null;
    throw err;
  }
}

export async function runInit(opts: InitOpts): Promise<InitResult> {
  const cwd = opts.cwd ?? process.cwd();
  const role = resolveRole(opts);
  const stealth = Boolean(opts.stealth);

  // Wizard interaction mode.
  const interactive = resolveInteractiveMode({
    nonInteractive: opts.nonInteractive,
    quiet: opts.quiet,
    env: opts.env,
    isTTY: opts.isTTY,
  });

  // Default plan — drives non-interactive behavior and seeds wizard
  // defaults. Picks live in `opts` if the caller already chose.
  const plan = defaultPlan(opts, role);
  const teamArg = opts.team;
  let recipesPlan: readonly string[] = plan.recipes;
  let hooksPlan: readonly string[] = plan.hooks;

  // Wizard runs only when interactive AND nothing was pre-specified by
  // flags. If `recipes`/`hooks` came in via flags we honor them as-is
  // so scripts stay deterministic.
  if (
    interactive &&
    !stealth &&
    role !== "contributor" &&
    opts.recipes === undefined &&
    opts.hooks === undefined &&
    !opts.skipAgents
  ) {
    const io = opts.promptIO ?? createPromptIO();
    let wizardOutcome: Awaited<ReturnType<typeof runWizard>>;
    try {
      wizardOutcome = await runWizard({
        io,
        defaults: {
          recipes: plan.recipes,
          hooks: plan.hooks,
        },
      });
    } finally {
      if (!opts.promptIO) io.close();
    }
    if (wizardOutcome === null) {
      throw new Error("Setup canceled.");
    }
    recipesPlan = wizardOutcome.recipes;
    hooksPlan = wizardOutcome.hooks;
  }

  // 1. Persist team. Skipped in contributor mode (the user is reading
  //    not configuring) and when no team is given.
  //
  //    Layer policy (Phase 9): inside a git repo → write to local
  //    `scope.team` so different repos can target different teams
  //    without trampling each other. Outside a git repo → fall back to
  //    global `team.default` (the legacy behavior).
  let teamWritten: string | null = null;
  if (teamArg && role !== "contributor") {
    const insideGitRepo = findLocalConfigPath() !== null;
    if (insideGitRepo) {
      setConfig("scope.team", teamArg, { layer: "local" });
    } else {
      setConfig("team.default", teamArg, { layer: "global" });
    }
    teamWritten = teamArg;
  }

  // 2. Online identity probe — workspace + viewer + default-team.
  const context = await runContext({
    client: opts.client,
    cliVersion: opts.cliVersion,
    env: opts.env,
  });

  // 3. AGENTS.md + CLAUDE.md + recipes.
  let agentsFileOut: string | null = null;
  let agentsAction: AgentsAction = "skipped";
  const agentsProfile: AgentsProfile = opts.agentsProfile ?? "minimal";
  let effectiveProfile: AgentsProfile = agentsProfile;
  let claudeMdFile: string | null = null;
  let claudeMdAction: ClaudeMdAction = "skipped";
  let recipes: InitRecipeOutcome[] = [];
  let claudeHook: ClaudeHookResult | null = null;

  const shouldWriteFiles =
    !opts.skipAgents && !stealth && role !== "contributor";

  if (shouldWriteFiles) {
    const fileName = resolveAgentsFile(opts);
    const agentsOut = writeAgentsFile({
      cwd,
      fileName,
      profile: agentsProfile,
      templatePath: opts.agentsTemplate,
    });
    agentsFileOut = agentsOut.file;
    agentsAction = agentsOut.action;
    effectiveProfile = agentsOut.profile;

    const claudeOut = writeClaudePointer(cwd);
    claudeMdFile = claudeOut.file;
    claudeMdAction = claudeOut.action;

    // Recipe installs (claude/gemini/cursor/...).
    recipes = installFromCatalog(recipesPlan, { cwd, stealth });
    for (const r of recipes) {
      if (r.recipe === "claude") {
        claudeHook = r.result as ClaudeHookResult;
        break;
      }
    }
  }

  // 4. Hooks (lefthook / git-hooks shim).
  let hooks: HooksInstallResult | null = null;
  let hooksSkippedReason = "";
  if (opts.skipHooks) {
    hooksSkippedReason = "explicitly skipped via --skip-hooks";
  } else if (stealth) {
    hooksSkippedReason =
      "skipped under --stealth (managed-branch / no-push workflow)";
  } else if (role === "contributor") {
    hooksSkippedReason = "skipped in contributor mode (no local installs)";
  } else if (hooksPlan.length === 0) {
    hooksSkippedReason = "no hooks selected (pass --hooks=auto to install)";
  } else {
    try {
      hooks = installHooks({ cwd });
    } catch (err) {
      if (
        err instanceof LefthookMissingError ||
        err instanceof GitRepoMissingError
      ) {
        hooksSkippedReason = err.message;
      } else {
        throw err;
      }
    }
  }

  // 5. Stealth git-exclude: hide linear's local-only files from the shared
  // repo via .git/info/exclude (per-repo, never committed). Only runs under
  // --stealth — the managed-branch / no-push workflow that wants invisibility.
  const stealthExclude = stealth ? setupGitExclude(cwd) : null;

  return {
    backend: "linear",
    role,
    interactive,
    stealth,
    context,
    team_written: teamWritten,
    agents_file: agentsFileOut,
    agents_action: agentsAction,
    agents_profile: effectiveProfile,
    claude_md_file: claudeMdFile,
    claude_md_action: claudeMdAction,
    claude_hook: claudeHook,
    recipes,
    hooks,
    hooks_skipped_reason: hooksSkippedReason,
    stealth_exclude: stealthExclude,
  };
}

/** Exposed for the format layer's profile-body preview. */
export function agentsBodyFor(profile: AgentsProfile): string {
  return profileBody(profile);
}
