import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import {
  checkAgents,
  checkClaude,
  checkCodex,
  checkFactory,
  checkFileRecipe,
  checkGemini,
  checkMultiFileRecipe,
  checkMux,
  checkOpencode,
  DEFERRED_RECIPES,
  getRecipe,
  installAgents,
  installClaude,
  installCodex,
  installFactory,
  installFileRecipe,
  installGemini,
  installMultiFileRecipe,
  installMux,
  installOpencode,
  listRecipes,
  removeAgents,
  removeClaude,
  removeCodex,
  removeFactory,
  removeFileRecipe,
  removeGemini,
  removeMultiFileRecipe,
  removeMux,
  removeOpencode,
  saveUserRecipe,
} from "../services/setup-service.js";
import { WORKFLOW_BODY } from "../templates/workflow.js";

interface SetupListShape {
  recipes: Array<{
    name: string;
    description: string;
    kind: string;
    target: string | null;
    source: string;
  }>;
}

interface SetupAddShape {
  action: string;
  name: string;
  target: string;
  config: string;
  hint: string;
}

interface SetupOutputShape {
  action: string;
  path: string;
  bytes: number;
}

interface SetupFileShape {
  recipe: string;
  path: string;
  action: "installed" | "checked" | "removed";
  installed?: boolean;
}

interface SetupMultiFileShape {
  recipe: string;
  paths: string[];
  action: "installed" | "checked" | "removed";
  entries: Array<{ path: string; installed: boolean }>;
  installed: boolean;
}

interface SetupClaudeShape {
  recipe: "claude";
  path: string;
  scope: "project" | "global";
  action: "installed" | "checked" | "removed";
  stealth: boolean;
  command: string;
  /** Per-event command map (compaction events get --memories-only). */
  commands?: Record<string, string>;
  events_added?: string[];
  events_removed?: string[];
  installed?: boolean;
  legacy_migrated?: string;
}

/**
 * Render the hook command lines: one per event when the per-event map is
 * present (SessionStart gets the full brief, PreCompact/PreCompress the
 * memories-only tail), falling back to the single legacy `command`.
 */
function formatHookCommands(result: {
  command: string;
  commands?: Record<string, string>;
}): string[] {
  const entries = Object.entries(result.commands ?? {});
  if (entries.length === 0) return [`  command: ${result.command}`];
  return entries.map(([event, command]) => `  command: ${command}  (${event})`);
}

interface SetupGeminiShape extends Omit<SetupClaudeShape, "recipe"> {
  recipe: "gemini";
  instructions_file: string;
  instructions_action?: "written" | "exists" | "removed" | "absent";
}

interface SetupCodexShape {
  recipe: "codex";
  path: string;
  scope: "project" | "global";
  action: "installed" | "checked" | "removed";
  instructions_action: string;
  agent_skill?: {
    paths: string[];
    installed: boolean;
  };
  hooks_config?: {
    config_path: string;
    hooks_path: string;
    action: "installed" | "checked" | "removed";
    installed: boolean;
  };
  installed?: boolean;
}

interface SetupMuxShape {
  recipe: "mux";
  action: "installed" | "checked" | "removed";
  layers: Array<{ layer: string; path: string; action: string }>;
  installed: boolean;
}

interface SetupAgentsShape {
  recipe: "agents";
  path: string;
  scope: "project" | "global";
  action: "installed" | "checked" | "removed";
  instructions_action: string;
  installed?: boolean;
}

interface SetupFactoryShape {
  recipe: "factory";
  path: string;
  scope: "project";
  action: "installed" | "checked" | "removed";
  instructions_action: string;
  installed?: boolean;
}

interface SetupOpencodeShape {
  recipe: "opencode";
  path: string;
  scope: "project";
  action: "installed" | "checked" | "removed";
  instructions_action: string;
  installed?: boolean;
}

function actionIcon(
  action: "installed" | "checked" | "removed",
  installed?: boolean,
): string {
  if (action === "installed") return "✓";
  if (action === "removed") return installed ? "✓" : "·";
  return installed ? "✓" : "✗";
}

function actionVerb(
  action: "installed" | "checked" | "removed",
  installed?: boolean,
): string {
  if (action === "installed") return "installed";
  if (action === "removed") return installed ? "removed" : "already absent";
  return installed ? "installed" : "not installed";
}

export function formatSetupList(result: SetupListShape): string {
  const lines: string[] = [`📋 Setup recipes (${result.recipes.length}):`, ""];
  const nameWidth = Math.max(
    ...result.recipes.map((r) => r.name.length),
    "name".length,
  );
  for (const r of result.recipes) {
    const tag = r.source === "user" ? " (user)" : "";
    const target = r.target ? `  → ${r.target}` : "";
    lines.push(
      `  ${r.name.padEnd(nameWidth)}  [${r.kind}]${tag}  ${r.description}${target}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatSetupAdd(result: SetupAddShape): string {
  return [
    `✓ Recipe '${result.name}' ${result.action}`,
    `  target: ${result.target}`,
    `  config: ${result.config}`,
    `  ${result.hint}`,
    "",
  ].join("\n");
}

export function formatSetupOutput(result: SetupOutputShape): string {
  return `✓ Wrote workflow template → ${result.path} (${result.bytes} bytes)\n`;
}

export function formatSetupFileRecipe(result: SetupFileShape): string {
  const icon = actionIcon(result.action, result.installed);
  const verb = actionVerb(result.action, result.installed);
  return `${icon} ${result.recipe} (file) ${verb}\n  path: ${result.path}\n`;
}

export function formatSetupMultiFileRecipe(
  result: SetupMultiFileShape,
): string {
  const icon = actionIcon(result.action, result.installed);
  const verb = actionVerb(result.action, result.installed);
  const lines: string[] = [`${icon} ${result.recipe} (multifile) ${verb}`];
  for (const entry of result.entries) {
    // Per-entry installed flag: on check it's "match" status, on
    // install always true (we just wrote it), on remove it's "existed
    // pre-remove". Renders the same icon-set so the surface stays
    // uniform — no second vocabulary for users to learn.
    const entryIcon = actionIcon(result.action, entry.installed);
    lines.push(`  ${entryIcon} ${entry.path}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatSetupClaude(result: SetupClaudeShape): string {
  const icon = actionIcon(result.action, result.installed);
  const verb = actionVerb(result.action, result.installed);
  const lines: string[] = [
    `${icon} claude (hook, ${result.scope}) ${verb}`,
    `  path:    ${result.path}`,
    ...formatHookCommands(result),
  ];
  if (result.events_added && result.events_added.length > 0) {
    lines.push(`  events added:   ${result.events_added.join(", ")}`);
  }
  if (result.events_removed && result.events_removed.length > 0) {
    lines.push(`  events removed: ${result.events_removed.join(", ")}`);
  }
  if (result.legacy_migrated) {
    lines.push(`  migrated:       ${result.legacy_migrated}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatSetupGemini(result: SetupGeminiShape): string {
  const icon = actionIcon(result.action, result.installed);
  const verb = actionVerb(result.action, result.installed);
  const lines: string[] = [
    `${icon} gemini (hook, ${result.scope}) ${verb}`,
    `  path:    ${result.path}`,
    ...formatHookCommands(result),
  ];
  if (result.events_added && result.events_added.length > 0) {
    lines.push(`  events added:   ${result.events_added.join(", ")}`);
  }
  if (result.events_removed && result.events_removed.length > 0) {
    lines.push(`  events removed: ${result.events_removed.join(", ")}`);
  }
  if (result.instructions_action) {
    lines.push(
      `  GEMINI.md:      ${result.instructions_action} (${result.instructions_file})`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatSetupCodex(result: SetupCodexShape): string {
  const icon = actionIcon(result.action, result.installed);
  const verb = actionVerb(result.action, result.installed);
  const lines: string[] = [
    `${icon} codex (section + agent-skill, ${result.scope}) ${verb}`,
    `  path:        ${result.path}`,
    `  section:     ${result.instructions_action}`,
  ];
  // Composite recipe: render the agent-skill leg if present. The skill
  // installed flag is "every file current" — mirrors the same vocabulary
  // we use elsewhere (multifile recipes, agents-snippet).
  if (result.agent_skill) {
    const skillIcon = result.agent_skill.installed ? "✓" : "✗";
    lines.push(
      `  agent-skill: ${skillIcon} (${result.agent_skill.paths.length} files)`,
    );
    for (const p of result.agent_skill.paths) {
      lines.push(`    ${p}`);
    }
  }
  // Codex native-hooks leg: config.toml feature flag + hooks.json entries.
  if (result.hooks_config) {
    const hooksIcon = result.hooks_config.installed ? "✓" : "✗";
    lines.push(`  hooks:       ${hooksIcon}`);
    lines.push(`    ${result.hooks_config.config_path}`);
    lines.push(`    ${result.hooks_config.hooks_path}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function formatSetupAgents(result: SetupAgentsShape): string {
  const icon = actionIcon(result.action, result.installed);
  const verb = actionVerb(result.action, result.installed);
  return [
    `${icon} agents (section, ${result.scope}) ${verb}`,
    `  path:    ${result.path}`,
    `  section: ${result.instructions_action}`,
    "",
  ].join("\n");
}

export function formatSetupFactory(result: SetupFactoryShape): string {
  const icon = actionIcon(result.action, result.installed);
  const verb = actionVerb(result.action, result.installed);
  return [
    `${icon} factory (section, ${result.scope}) ${verb}`,
    `  path:    ${result.path}`,
    `  section: ${result.instructions_action}`,
    "",
  ].join("\n");
}

export function formatSetupOpencode(result: SetupOpencodeShape): string {
  const icon = actionIcon(result.action, result.installed);
  const verb = actionVerb(result.action, result.installed);
  return [
    `${icon} opencode (section, ${result.scope}) ${verb}`,
    `  path:    ${result.path}`,
    `  section: ${result.instructions_action}`,
    "",
  ].join("\n");
}

export function formatSetupMux(result: SetupMuxShape): string {
  const icon = result.action === "installed" || result.installed ? "✓" : "·";
  const verb = actionVerb(result.action, result.installed);
  const lines: string[] = [`${icon} mux (sections) ${verb}`];
  for (const layer of result.layers) {
    lines.push(`  [${layer.layer}] ${layer.action}: ${layer.path}`);
  }
  return `${lines.join("\n")}\n`;
}

type RecipeOp = "install" | "check" | "remove";
type RootOpts = { json?: boolean | string };
type HookDispatchOpts = { cwd: string; global: boolean; stealth: boolean };
type SectionDispatchOpts = { cwd: string; global: boolean; project: boolean };
type SectionDispatchResult = { installed?: boolean };

type HookDispatcher = (
  op: RecipeOp,
  opts: HookDispatchOpts,
  rootOpts: RootOpts,
) => void;

type SectionDispatcher = (
  op: RecipeOp,
  opts: SectionDispatchOpts,
  rootOpts: RootOpts,
) => SectionDispatchResult;

const HOOK_DISPATCH: Record<string, HookDispatcher> = {
  claude: (op, opts, rootOpts) => {
    const fn = {
      install: installClaude,
      check: checkClaude,
      remove: removeClaude,
    }[op];
    outputResult(fn(opts), formatSetupClaude, rootOpts);
  },
  gemini: (op, opts, rootOpts) => {
    const fn = {
      install: installGemini,
      check: checkGemini,
      remove: removeGemini,
    }[op];
    outputResult(fn(opts), formatSetupGemini, rootOpts);
  },
};

const SECTION_DISPATCH: Record<string, SectionDispatcher> = {
  codex: (op, opts, rootOpts) => {
    const fn = {
      install: installCodex,
      check: checkCodex,
      remove: removeCodex,
    }[op];
    const result = fn({ cwd: opts.cwd, global: opts.global });
    outputResult(result, formatSetupCodex, rootOpts);
    return result;
  },
  agents: (op, opts, rootOpts) => {
    const fn = {
      install: installAgents,
      check: checkAgents,
      remove: removeAgents,
    }[op];
    const result = fn({ cwd: opts.cwd, global: opts.global });
    outputResult(result, formatSetupAgents, rootOpts);
    return result;
  },
  factory: (op, opts, rootOpts) => {
    const fn = {
      install: installFactory,
      check: checkFactory,
      remove: removeFactory,
    }[op];
    // Factory section recipe is project-only (no --global / --project
    // layering surface) — Factory Droid only reads `<cwd>/AGENTS.md`.
    // Just drop those flags before handing off.
    const result = fn({ cwd: opts.cwd });
    outputResult(result, formatSetupFactory, rootOpts);
    return result;
  },
  opencode: (op, opts, rootOpts) => {
    const fn = {
      install: installOpencode,
      check: checkOpencode,
      remove: removeOpencode,
    }[op];
    // OpenCode is project-only (same reasoning as factory above) —
    // OpenCode reads `<cwd>/AGENTS.md`.
    const result = fn({ cwd: opts.cwd });
    outputResult(result, formatSetupOpencode, rootOpts);
    return result;
  },
  mux: (op, opts, rootOpts) => {
    const fn = { install: installMux, check: checkMux, remove: removeMux }[op];
    const result = fn({
      cwd: opts.cwd,
      global: opts.global,
      project: opts.project,
    });
    outputResult(result, formatSetupMux, rootOpts);
    return result;
  },
};

export const SETUP_META: DomainMeta = {
  name: "setup",
  summary:
    "install integration files for AI editors (cursor, claude, aider, factory, etc.)",
  context: [
    "Ships a recipe catalog for embedding linear workflow instructions",
    "into AI editors (Cursor rules, Claude Code hooks, AGENTS.md sections,",
    "etc.). Each recipe writes a `linear`-flavored template (or for",
    "`claude`, registers a `linear prime` SessionStart hook) so an agent",
    "automatically picks up the right CLI in every editor.",
    "",
    "File recipes (cursor, windsurf, cody, kilocode) just write a workflow",
    "template to a fixed project path. Multifile recipes (aider, junie,",
    "agent-skill) write a small set of related files.",
    "Hook recipes (claude, gemini) merge into a settings.json under",
    "`~/.claude/`, `.claude/`, `~/.gemini/`, or `.gemini/` depending on the",
    "recipe and `--global` flag, preserving any existing hooks and deduping",
    "by command string. Gemini also writes a companion GEMINI.md at the",
    "project cwd.",
    "",
    "Section recipes (codex, agents, factory, opencode, mux) merge a",
    "marker-bracketed managed block into AGENTS.md, preserving user",
    "content outside the markers. Each recipe owns its own marker pair so",
    "factory / codex / opencode coexist in the same file. Codex",
    "targets `<cwd>/AGENTS.md` by default or `$CODEX_HOME/AGENTS.md` /",
    "`~/.codex/AGENTS.md` with `--global`. Mux always writes the base",
    "`<cwd>/AGENTS.md` section and composes layers: `--project` adds",
    "`<cwd>/.mux/AGENTS.md`, `--global` adds `~/.mux/AGENTS.md`.",
    "",
    "`-o <path>` writes the workflow template to an arbitrary path",
    "(creating parent dirs as needed). Use it when no built-in recipe",
    "fits — e.g. embedding the template in a tool config not yet in",
    "the catalog.",
    "",
    "`--stealth` (claude / gemini): wire `linear prime --stealth`",
    "instead of `linear prime`. The stealth variant emits a brief that",
    "omits the git-ops session-close protocol, useful when the agent is",
    "operating on a managed branch or without push rights. install/remove",
    "swap variants cleanly (the other variant is stripped first), and",
    "`--remove` strips both regardless of `--stealth`.",
    "",
    "`--add <name>` persists a user-defined recipe to `.linear/recipes.json`",
    "(JSON format to keep deps minimal). User recipes are file-only",
    '(`kind: "file"`) and write the linear workflow template to the given',
    "path. They shadow built-in recipes of the same name in both `--list`",
    "and lookup, so an org can override e.g. `cursor` with a custom target",
    "path.",
  ].join("\n"),
  arguments: {
    recipe:
      "recipe name (e.g. cursor, claude, aider). Omit + use --list to see all options.",
  },
  seeAlso: ["prime", "memory list", "where"],
};

export function setupSetupCommands(program: Command): void {
  const setup = program
    .command("setup [recipe]")
    .description(
      "install integration files for AI editors and coding assistants",
    )
    .option("--list", "list all available recipes")
    .option("--print", "print the workflow template to stdout")
    .option(
      "-o, --output <path>",
      "write the workflow template to <path> (creates parent dirs as needed)",
    )
    .option(
      "--add <name>",
      "persist a custom file recipe to .linear/recipes.json (positional arg is the target path)",
    )
    .option("--check", "check if the integration is installed")
    .option("--remove", "remove the integration")
    .option(
      "--global",
      "install for the user globally (claude/gemini → ~/.<recipe>/settings.json; codex → $CODEX_HOME or ~/.codex/AGENTS.md; mux → ~/.mux/AGENTS.md)",
    )
    .option(
      "--project",
      "mux only: also write a section to <cwd>/.mux/AGENTS.md (in addition to the always-on <cwd>/AGENTS.md)",
    )
    .option(
      "--stealth",
      "claude/gemini: wire `linear prime --stealth` (omits git-ops in the session-close protocol)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [recipeArg, options, command] = args as [
          string | undefined,
          {
            list?: boolean;
            print?: boolean;
            output?: string;
            add?: string;
            check?: boolean;
            remove?: boolean;
            global?: boolean;
            project?: boolean;
            stealth?: boolean;
          },
          Command,
        ];

        const rootOpts = getRootOpts(command);
        const cwd = process.cwd();

        if (options.list) {
          outputResult(
            {
              recipes: listRecipes(cwd).map((r) => ({
                name: r.name,
                description: r.description,
                kind: r.kind,
                target: r.targetPath ?? null,
                source: r.source,
              })),
            },
            formatSetupList,
            rootOpts,
          );
          return;
        }

        if (options.add) {
          if (!recipeArg) {
            throw new Error(
              "--add <name> requires a positional path argument (usage: linear setup --add <name> <path>)",
            );
          }
          const recipe = saveUserRecipe(cwd, options.add, recipeArg);
          outputResult(
            {
              action: "added",
              name: recipe.name,
              target: recipe.targetPath ?? "",
              config: `.linear/recipes.json`,
              hint: `install with: linear setup ${recipe.name}`,
            },
            formatSetupAdd,
            rootOpts,
          );
          return;
        }

        if (options.print) {
          process.stdout.write(WORKFLOW_BODY);
          return;
        }

        if (options.output) {
          const target = path.resolve(process.cwd(), options.output);
          const dir = path.dirname(target);
          if (dir && dir !== "." && dir !== "") {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(target, WORKFLOW_BODY, { mode: 0o644 });
          outputResult(
            {
              action: "written",
              path: target,
              bytes: Buffer.byteLength(WORKFLOW_BODY, "utf8"),
            },
            formatSetupOutput,
            rootOpts,
          );
          return;
        }

        if (!recipeArg) {
          throw new Error(
            "missing recipe name (use --list to see available recipes, --print to print the template, or pass a name like 'claude')",
          );
        }

        const name = recipeArg.toLowerCase();
        if (DEFERRED_RECIPES.has(name)) {
          throw new Error(
            `recipe '${name}' is not yet implemented in linear. Tracked as a follow-up; use --list to see what is available.`,
          );
        }

        const recipe = getRecipe(name, cwd);
        if (!recipe) {
          throw new Error(
            `unknown recipe '${name}' (use --list to see available recipes)`,
          );
        }

        const op: RecipeOp = options.check
          ? "check"
          : options.remove
            ? "remove"
            : "install";

        if (recipe.kind === "hook") {
          const dispatch = HOOK_DISPATCH[recipe.name];
          if (!dispatch) {
            throw new Error(
              `unknown hook recipe '${recipe.name}' (catalog drift — file a bug)`,
            );
          }
          dispatch(
            op,
            {
              cwd,
              global: options.global ?? false,
              stealth: options.stealth ?? false,
            },
            rootOpts,
          );
          return;
        }

        if (recipe.kind === "section") {
          const dispatch = SECTION_DISPATCH[recipe.name];
          if (!dispatch) {
            throw new Error(
              `unknown section recipe '${recipe.name}' (catalog drift — file a bug)`,
            );
          }
          const result = dispatch(
            op,
            {
              cwd,
              global: options.global ?? false,
              project: options.project ?? false,
            },
            rootOpts,
          );
          if (op === "check" && !result.installed) process.exitCode = 1;
          return;
        }

        if (recipe.kind === "multifile") {
          if (options.check) {
            const result = checkMultiFileRecipe(recipe, cwd);
            outputResult(result, formatSetupMultiFileRecipe, rootOpts);
            if (!result.installed) process.exitCode = 1;
            return;
          }
          if (options.remove) {
            outputResult(
              removeMultiFileRecipe(recipe, cwd),
              formatSetupMultiFileRecipe,
              rootOpts,
            );
            return;
          }
          outputResult(
            installMultiFileRecipe(recipe, cwd),
            formatSetupMultiFileRecipe,
            rootOpts,
          );
          return;
        }

        if (options.check) {
          const result = checkFileRecipe(recipe, cwd);
          outputResult(result, formatSetupFileRecipe, rootOpts);
          if (!result.installed) process.exitCode = 1;
          return;
        }
        if (options.remove) {
          outputResult(
            removeFileRecipe(recipe, cwd),
            formatSetupFileRecipe,
            rootOpts,
          );
          return;
        }
        outputResult(
          installFileRecipe(recipe, cwd),
          formatSetupFileRecipe,
          rootOpts,
        );
      }),
    );

  setup
    .command("usage")
    .description("show detailed usage for setup")
    .action(() => {
      console.log(formatDomainUsage(setup, SETUP_META));
    });
}
