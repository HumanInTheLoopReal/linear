import type { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import {
  type AgentsAction,
  type ClaudeMdAction,
  INIT_RECIPE_CHOICES,
  type InitRecipeOutcome,
  type InitResult,
  type Role,
  runInit,
} from "../services/init-service.js";
import { formatContext } from "./context.js";

/**
 * Format helpers — keep the same 📋 banner shape we ship today, but expand
 * the body to cover the new wizard outputs (role, recipes, hooks, profile).
 */

const AGENTS_ICON: Record<AgentsAction, string> = {
  created: "✓",
  exists: "·",
  appended: "✓",
  replaced: "✓",
  current: "·",
  preserved: "·",
  skipped: "·",
};

const AGENTS_VERB: Record<AgentsAction, string> = {
  created: "wrote",
  exists: "already present",
  appended: "appended managed block to",
  replaced: "updated managed block in",
  current: "already current",
  preserved: "preserved (full profile kept across minimal re-run)",
  skipped: "skipped",
};

const CLAUDE_MD_ICON: Record<ClaudeMdAction, string> = {
  created: "✓",
  exists: "·",
  skipped: "·",
};

const CLAUDE_MD_VERB: Record<ClaudeMdAction, string> = {
  created: "wrote",
  exists: "already present",
  skipped: "skipped",
};

function formatRecipeLine(outcome: InitRecipeOutcome): string {
  const recipe = outcome.recipe;
  const result = outcome.result as { path?: string; paths?: string[] };
  if (Array.isArray(result.paths)) {
    return `  ✓ ${recipe} → ${result.paths.join(", ")}`;
  }
  if (typeof result.path === "string") {
    return `  ✓ ${recipe} → ${result.path}`;
  }
  return `  ✓ ${recipe}`;
}

export function formatInit(result: InitResult): string {
  const lines: string[] = ["📋 linear init:"];

  lines.push("");
  lines.push("Mode:");
  lines.push(
    `  · role: ${result.role}${result.stealth ? " (stealth)" : ""}` +
      `, interactive: ${result.interactive ? "yes" : "no"}`,
  );

  lines.push("");
  lines.push("Config:");
  if (result.team_written) {
    lines.push(`  ✓ team → ${result.team_written}`);
  } else {
    lines.push("  · team (no --team given, unchanged)");
  }

  lines.push("");
  lines.push("Identity:");
  for (const line of formatContext(result.context).trimEnd().split("\n")) {
    lines.push(`  ${line}`);
  }

  lines.push("");
  lines.push("Agents:");
  if (result.agents_file) {
    const icon = AGENTS_ICON[result.agents_action];
    const verb = AGENTS_VERB[result.agents_action];
    lines.push(
      `  ${icon} ${result.agents_file} ${verb} (profile: ${result.agents_profile})`,
    );
  } else {
    lines.push("  · AGENTS.md skipped (--skip-agents)");
  }
  if (result.claude_md_file) {
    const icon = CLAUDE_MD_ICON[result.claude_md_action];
    const verb = CLAUDE_MD_VERB[result.claude_md_action];
    lines.push(`  ${icon} CLAUDE.md ${verb}: ${result.claude_md_file}`);
  } else {
    lines.push("  · CLAUDE.md skipped (--skip-agents)");
  }

  if (result.claude_hook) {
    const hook = result.claude_hook;
    lines.push(`  ✓ Claude hook ${hook.action} (${hook.scope}): ${hook.path}`);
    if (hook.events_added && hook.events_added.length > 0) {
      lines.push(`    events: ${hook.events_added.join(", ")}`);
    }
  } else if (!result.stealth && result.role !== "contributor") {
    lines.push("  · Claude hook skipped");
  }

  if (result.recipes.length > 0) {
    lines.push("");
    lines.push("Recipes:");
    for (const r of result.recipes) {
      if (r.recipe === "claude") continue; // Claude hook is rendered above.
      lines.push(formatRecipeLine(r));
    }
  }

  lines.push("");
  lines.push("Hooks:");
  if (result.hooks) {
    lines.push(
      `  ✓ ${result.hooks.target} → ${result.hooks.path} (${result.hooks.action})`,
    );
  } else {
    lines.push(`  · ${result.hooks_skipped_reason}`);
  }

  if (result.stealth_exclude) {
    const ex = result.stealth_exclude;
    lines.push("");
    lines.push("Stealth:");
    if (ex.skipped_not_git) {
      lines.push("  · git exclude skipped (not a git repo)");
    } else if (ex.added.length > 0) {
      lines.push(`  ✓ .git/info/exclude → +${ex.added.join(", ")}`);
    } else {
      lines.push("  · .git/info/exclude already configured");
    }
  }

  return `${lines.join("\n")}\n`;
}

export const INIT_META: DomainMeta = {
  name: "init",
  summary:
    "first-run setup wizard: identity, default team, AGENTS.md, CLAUDE.md, recipes, and hooks",
  context: [
    "First-run wizard layered over the existing services. linear has no",
    "local store, so init focuses on configuration and managed-file setup:",
    "",
    "  1. Save the team (and `agents.file` if overridden). When inside a",
    "     git repo, `--team` writes to `<repo>/.linear/config.json` as",
    "     `scope.team` (per-repo override); otherwise it writes to",
    "     `~/.linear/config.json` as the legacy global `team.default`.",
    "  2. Run the same online check as `linear context` (viewer +",
    "     workspace + default-team resolution).",
    "  3. Render `AGENTS.md` as a marker-versioned managed block. The",
    "     default `minimal` profile is a pointer at `linear prime`; the",
    "     `full` profile inlines the command reference for hookless",
    "     agents (Codex, Factory, Mux). Re-running with `minimal` on a",
    "     `full` file preserves the full content (no information loss).",
    "  4. Write a thin `CLAUDE.md` pointer when one does not already",
    "     exist (never overwrites).",
    "  5. Install recipe artefacts (defaults to the Claude hook) via",
    "     `linear setup` installers.",
    "  6. Install lefthook overlays / `.git/hooks/` shims via",
    "     `linear hooks install` so quality gates fire on commit / push.",
    "",
    "The wizard is interactive when stdin is a TTY and none of",
    "`--non-interactive`, `--quiet`, `LINEAR_NON_INTERACTIVE`, or CI are",
    "set. Non-interactive runs use a deterministic default plan; explicit",
    "`--recipes` / `--hooks` flags bypass the prompt entirely so scripts",
    "stay reproducible.",
    "",
    "Umbrella flags:",
    "  --stealth        skip AGENTS.md, CLAUDE.md, recipes, hooks AND add",
    "                   linear's local-only paths (.linear/,",
    "                   .claude/settings.local.json) to .git/info/exclude so",
    "                   collaborators never see them (config write still",
    "                   happens; useful for managed branches / no-push work).",
    "  --contributor    skip every local install (config too); identity",
    "                   probe still runs so the user can verify auth.",
    "",
    "Pre-requisite: a valid token must already be resolvable via",
    "`--api-token`, `LINEAR_API_TOKEN`, or `~/linear/token`. Run",
    "`linear auth login` first if none is configured.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["auth login", "context", "config get", "setup claude", "onboard"],
};

interface InitFlagOpts {
  team?: string;
  skipAgents?: boolean;
  skipHooks?: boolean;
  stealth?: boolean;
  contributor?: boolean;
  nonInteractive?: boolean;
  quiet?: boolean;
  recipes?: string;
  hooks?: string;
  agentsProfile?: string;
  agentsFile?: string;
  agentsTemplate?: string;
  role?: string;
}

/**
 * Parse a comma-separated recipe / hook list. Empty string → empty array.
 * Unknown names are passed through; the service drops them silently.
 */
function parseList(input: string | undefined): string[] | undefined {
  if (input === undefined) return undefined;
  const t = input.trim();
  if (t === "") return [];
  if (t === "all") return Array.from(INIT_RECIPE_CHOICES);
  return t
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function parseProfile(input?: string): "minimal" | "full" | undefined {
  if (input === undefined) return undefined;
  const t = input.toLowerCase();
  if (t === "minimal" || t === "full") return t;
  throw new Error(
    `--agents-profile must be 'minimal' or 'full' (got '${input}')`,
  );
}

function parseRole(input?: string): Role | undefined {
  if (input === undefined) return undefined;
  const t = input.toLowerCase();
  if (t === "maintainer" || t === "contributor") return t;
  throw new Error(
    `--role must be 'maintainer' or 'contributor' (got '${input}')`,
  );
}

export function setupInitCommands(program: Command): void {
  const init = program
    .command("init")
    .description(
      "first-run setup wizard (identity, AGENTS.md, CLAUDE.md, recipes, hooks)",
    )
    .option(
      "-t, --team <key>",
      "default team key — inside a git repo, written to <repo>/.linear/config.json as scope.team; otherwise to ~/.linear/config.json as team.default",
    )
    .option("--skip-agents", "skip AGENTS.md + CLAUDE.md + recipe installs")
    .option(
      "--skip-hooks",
      "skip lefthook / git-hooks shim install (no quality-gate wiring)",
    )
    .option(
      "--stealth",
      "umbrella: skip agent files/recipes/hooks + add local-only paths to .git/info/exclude (managed-branch / no-push workflows)",
    )
    .option(
      "--contributor",
      "contributor mode: skip every local install (just verify identity)",
    )
    .option(
      "--non-interactive",
      "do not prompt; use defaults or explicit flags",
    )
    .option("-q, --quiet", "suppress progress output; implies non-interactive")
    .option(
      "--recipes <list>",
      "comma-separated recipe names (or 'all' / empty for none); skips the wizard prompt",
    )
    .option(
      "--hooks <list>",
      "comma-separated hook kinds (or empty for none); skips the wizard prompt",
    )
    .option(
      "--agents-profile <profile>",
      "AGENTS.md profile: 'minimal' (default) or 'full' (inline reference for hookless agents)",
    )
    .option(
      "--agents-file <name>",
      "override AGENTS.md filename (persisted to config as agents.file)",
    )
    .option(
      "--agents-template <path>",
      "write a custom template body instead of the managed-block default (user owns the file)",
    )
    .option(
      "--role <role>",
      "force role: 'maintainer' (default) or 'contributor'",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [InitFlagOpts, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const recipes = parseList(options.recipes);
        const hooks = parseList(options.hooks);
        const agentsProfile = parseProfile(options.agentsProfile);
        const role = parseRole(options.role);
        const result = await runInit({
          client: ctx.gql,
          cliVersion: pkg.version,
          team: options.team,
          skipAgents: options.skipAgents,
          skipHooks: options.skipHooks,
          stealth: options.stealth,
          contributor: options.contributor,
          nonInteractive: options.nonInteractive,
          quiet: options.quiet,
          recipes,
          hooks,
          agentsProfile,
          agentsFile: options.agentsFile,
          agentsTemplate: options.agentsTemplate,
          role,
        });
        outputResult(result, formatInit, rootOpts);
      }),
    );

  init
    .command("usage")
    .description("show detailed usage for init")
    .action(() => {
      console.log(formatDomainUsage(init, INIT_META));
    });
}
