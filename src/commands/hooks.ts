import type { Command } from "commander";
import {
  type CommandContext,
  createContext,
  getRootOpts,
} from "../common/context.js";
import { isNotFoundError } from "../common/errors.js";
import { isClosedStateType } from "../common/issue-lifecycle.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveStateIdByType } from "../resolvers/status-resolver.js";
import {
  checkHooksInstalled,
  GitRepoMissingError,
  HOOK_AUTH_MISSING_EXIT_CODE,
  HOOK_NARRATIVES,
  type HookName,
  installHooks,
  isHookName,
  MANAGED_HOOKS,
  runHook,
  uninstallHooks,
} from "../services/hooks-service.js";
import { getIssue, updateIssue } from "../services/issue-service.js";
import {
  type AutoCloseOutcome,
  runPostCommitAutoClose,
} from "../services/post-commit-auto-close.js";

/**
 * Hooks is linear-only operational tooling (git-hook dispatcher). The
 * `list` output has a Managed-hooks section + Install-state footer:
 *
 *   run        → `<icon> <hook>: <detail|reason|no-op>` per invocation
 *   list       → Managed hooks block + Install: line
 *   install    → `✓ <action> hooks via <target> at <path>` + hook names line
 *   uninstall  → `✓ Removed` / `· Absent` per the action enum
 */

interface HooksRunResultShape {
  hook: string;
  action: "applied" | "skipped";
  detail?: string;
  reason?: string;
}

interface PostCommitAutoCloseRunShape extends HooksRunResultShape {
  parsed?: string[];
  entries?: Array<{
    identifier: string;
    outcome: "closed" | "already-closed" | "not-found" | "error";
    reason?: string;
  }>;
}

export async function closeIssueFromHook(
  context: CommandContext,
  identifier: string,
): Promise<AutoCloseOutcome> {
  let issueId: string;
  try {
    issueId = await resolveIssueId(context.sdk, identifier);
  } catch (error) {
    if (isNotFoundError(error)) return "not-found";
    throw error;
  }

  const issue = await getIssue(context.gql, issueId);
  if (issue.state && isClosedStateType(issue.state.type)) {
    return "already-closed";
  }
  const teamId = issue.team?.id;
  if (!teamId) throw new Error(`issue ${identifier} has no team`);

  const stateId = await resolveStateIdByType(context.sdk, teamId, "completed");
  await updateIssue(context.gql, issueId, { stateId });
  return "closed";
}

export function formatHooksRun(result: PostCommitAutoCloseRunShape): string {
  const head =
    result.action === "applied"
      ? `✓ ${result.hook}: ${result.detail ?? "applied"}`
      : result.reason
        ? `· ${result.hook}: skipped — ${result.reason}`
        : `· ${result.hook}: no-op`;

  const lines = [head];
  if (result.hook === "post-commit" && result.entries?.length) {
    for (const e of result.entries) {
      const icon =
        e.outcome === "closed"
          ? "✓"
          : e.outcome === "already-closed"
            ? "·"
            : e.outcome === "not-found"
              ? "?"
              : "✗";
      const tail = e.reason ? ` (${e.reason})` : "";
      lines.push(`  ${icon} ${e.identifier}: ${e.outcome}${tail}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

interface HooksManagedRowShape {
  hook: string;
  has_behavior: boolean;
  /**
   * Per-hook narrative describing what the hook does in linear.
   * Surfaced under each hook row in `linear hooks list` and included in
   * the JSON envelope so agents see the same source-of-truth string.
   */
  narrative?: string;
}

interface HooksInstallStatusShape {
  target: string;
  path: string;
  installed: boolean;
  outdated?: boolean;
  installed_version?: string;
  current_version?: string;
  lefthook_present: boolean;
  hook_names: string[];
}

interface HooksListResultShape {
  managed: HooksManagedRowShape[];
  install: HooksInstallStatusShape;
  note?: string;
}

export function formatHooksList(result: HooksListResultShape): string {
  const lines: string[] = ["Managed hooks:"];
  const widest = Math.max(...result.managed.map((m) => m.hook.length));
  for (const m of result.managed) {
    const icon = m.has_behavior ? "•" : "·";
    const label = m.has_behavior ? "(active)" : "(inert)";
    lines.push(`  ${icon} ${m.hook.padEnd(widest)}  ${label}`);
    // Per-hook narrative: describes what each hook does and why it's
    // active/inert. Indented under the row so it visually belongs to it;
    // wrapped to line-length unbroken — the strings are spec-frozen so
    // we don't reflow inside the formatter.
    if (m.narrative) {
      lines.push(`      ${m.narrative}`);
    }
  }
  lines.push("");
  const installed = result.install.installed ? "installed" : "not installed";
  lines.push(
    `Install: ${installed} via ${result.install.target} at ${result.install.path}`,
  );
  if (!result.install.installed) {
    lines.push("  hint: run `linear hooks install` to wire dispatchers");
  } else {
    if (result.install.hook_names.length > 0) {
      lines.push(`  hooks: ${result.install.hook_names.join(", ")}`);
    }
    if (result.install.outdated) {
      const v = result.install.installed_version ?? "legacy (unversioned)";
      const cur = result.install.current_version ?? "current";
      lines.push(
        `  ⚠ outdated (installed v${v}, current v${cur}) — run \`linear hooks install\` to update`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

interface HooksInstallResultShape {
  target: string;
  path: string;
  action: "installed" | "updated" | "current";
  hook_names: string[];
  shared?: boolean;
  chained?: boolean;
  hooks_path?: string;
}

export function formatHooksInstall(result: HooksInstallResultShape): string {
  const icon = result.action === "current" ? "·" : "✓";
  const verb =
    result.action === "current"
      ? "already installed"
      : result.action === "updated"
        ? "updated"
        : "installed";
  const via = result.shared ? "shared git-hooks" : result.target;
  const lines: string[] = [
    `${icon} Hooks ${verb} via ${via} at ${result.path}`,
  ];
  if (result.hook_names.length > 0) {
    lines.push(`  hooks: ${result.hook_names.join(", ")}`);
  }
  if (result.shared && result.hooks_path) {
    lines.push(`  git config core.hooksPath=${result.hooks_path}`);
  }
  if (result.chained) {
    lines.push("  chained: pre-existing hook content preserved in-place");
  }
  return `${lines.join("\n")}\n`;
}

interface HooksUninstallResultShape {
  target: string;
  path: string;
  action: "removed" | "absent";
  hook_names: string[];
  shared?: boolean;
  hooks_path_reset?: boolean;
}

export function formatHooksUninstall(
  result: HooksUninstallResultShape,
): string {
  if (result.action === "absent") {
    return `· No managed hook wiring found at ${result.path}\n`;
  }
  const via = result.shared ? "shared git-hooks" : result.target;
  const lines: string[] = [
    `✓ Removed hook wiring from ${via} at ${result.path}`,
  ];
  if (result.hook_names.length > 0) {
    lines.push(`  hooks: ${result.hook_names.join(", ")}`);
  }
  if (result.hooks_path_reset) {
    lines.push("  git config core.hooksPath unset");
  }
  return `${lines.join("\n")}\n`;
}

export const HOOKS_META: DomainMeta = {
  name: "hooks",
  summary: "install, dispatch, and inspect linear git hooks",
  context: [
    "linear prefers lefthook when it is configured in the repo — writing",
    "a marker-bracketed managed block into `lefthook.local.yml` so it",
    "coexists with any existing lefthook config (the user's `lefthook.yml`",
    "is never touched) — and otherwise falls back to writing a",
    "marker-bracketed shim into `.git/hooks/<name>` that dispatches to",
    "`linear hooks run <name>`.",
    "",
    "Behavior per hook (all six wired by install):",
    "  • prepare-commit-msg <msgfile> (active): append `Executed-By: $LINEAR_ACTOR`",
    "    trailer when the env var is set and no such trailer is present yet,",
    "    AND queue any `Closes/Fixes/Resolves ENG-N` close-trailers for the",
    "    post-commit drain. Skipped on merge commits.",
    "  • post-commit (active): drain the close-trailer queue written by",
    "    prepare-commit-msg, transitioning each referenced Linear issue to",
    "    its team's `completed` state. Idempotent; per-issue failures are",
    "    recorded but never abort the dispatch. The close transition runs",
    "    out-of-hook to avoid blocking the commit on GraphQL latency.",
    "  • pre-commit / post-merge / pre-push / post-checkout (inert): recognized",
    "    but no-op. Linear is the source of truth via GraphQL and there is",
    "    no per-branch / per-machine local DB, so these hook names have no",
    "    linear-side work. They are still wired so `lefthook validate` and",
    "    `linear hooks list` show the full hook surface; each inert hook's",
    "    per-hook narrative explains why.",
    "",
    "Subcommands:",
    "  • install      — write managed block (lefthook.local.yml or .git/hooks/<name>)",
    "      --force     re-stamp the managed block even when already current",
    "      --shared    install into a committable .linear-hooks/ dir at the repo",
    "                  root and set core.hooksPath (absolute, worktree-safe) so a",
    "                  team can share the wiring via git",
    "      --chain     preserve + run pre-existing hook content; linear chains",
    "                  in-place by default (it never renames hooks to <name>.old),",
    "                  so this flag just records the intent",
    "  • uninstall    — strip the managed block (--shared resets core.hooksPath)",
    "  • list         — show managed dispatchers + current install state",
    "  • run <name>   — dispatcher invoked by the hook itself",
  ].join("\n"),
  arguments: {
    "hook-name":
      "Git hook name (one of: pre-commit, post-merge, pre-push, post-checkout, prepare-commit-msg, post-commit)",
  },
  seeAlso: ["setup claude", "where"],
};

export function setupHooksCommands(program: Command): void {
  const hooks = program.command("hooks").description("dispatch git-hook logic");
  hooks.action(() => hooks.help());

  hooks
    .command("run <hook-name> [args...]")
    .description(
      "execute a single git hook (typically called from a shim or lefthook step)",
    )
    .option(
      "--actor <name>",
      "override LINEAR_ACTOR for this invocation (mainly for testing)",
    )
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [hookName, hookArgs, options, command] = cmdArgs as [
          string,
          string[],
          { actor?: string },
          Command,
        ];
        if (!isHookName(hookName)) {
          throw new Error(
            `unknown hook '${hookName}' (allowed: ${MANAGED_HOOKS.join(", ")})`,
          );
        }
        const rootOpts = getRootOpts(command);

        if (hookName === "post-commit") {
          // Exit-3 graceful skip: when auth is unconfigured we exit with a
          // dedicated code so the installed shim can translate it into
          // exit 0 + stderr warning. Without this, an unconfigured
          // contributor sees a hook failure rather than a clean skip.
          let ctx: ReturnType<typeof createContext>;
          try {
            ctx = createContext(rootOpts);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (/No API token/i.test(msg)) {
              console.error(`linear: ${msg}`);
              process.exit(HOOK_AUTH_MISSING_EXIT_CODE);
            }
            throw e;
          }
          const result = await runPostCommitAutoClose({
            closeIssue: (identifier) => closeIssueFromHook(ctx, identifier),
          });
          outputResult(result, formatHooksRun, rootOpts);
          return;
        }

        const result = runHook({
          hook: hookName as HookName,
          args: hookArgs ?? [],
          actor: options.actor,
        });
        outputResult(result, formatHooksRun, rootOpts);
      }),
    );

  hooks
    .command("list")
    .description(
      "list the git hooks linear can dispatch + current install state",
    )
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [, command] = cmdArgs as [unknown, Command];
        const rootOpts = getRootOpts(command);
        const status = checkHooksInstalled({ cwd: process.cwd() });
        const payload = {
          managed: MANAGED_HOOKS.map((name) => {
            const narrative = HOOK_NARRATIVES[name];
            return {
              hook: name,
              has_behavior: narrative?.active ?? false,
              narrative: narrative?.narrative,
            };
          }),
          install: status,
          note: "run `linear hooks install` to wire `linear hooks run <name>` via lefthook (preferred) or `.git/hooks/<name>` shim.",
        };
        outputResult(payload, formatHooksList, rootOpts);
      }),
    );

  hooks
    .command("install")
    .description(
      "install the managed hook wiring (lefthook.local.yml or .git/hooks/<name> shim)",
    )
    .option(
      "--force",
      "re-stamp the managed block even when it is already current",
    )
    .option(
      "--shared",
      "install into a committable .linear-hooks/ dir + set core.hooksPath",
    )
    .option(
      "--chain",
      "preserve and run pre-existing hook content (linear chains in-place by default)",
    )
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [options, command] = cmdArgs as [
          { force?: boolean; shared?: boolean; chain?: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        try {
          const result = installHooks({
            cwd: process.cwd(),
            force: options.force,
            shared: options.shared,
            chain: options.chain,
          });
          outputResult(result, formatHooksInstall, rootOpts);
        } catch (e) {
          if (e instanceof GitRepoMissingError) {
            throw new Error(e.message);
          }
          throw e;
        }
      }),
    );

  hooks
    .command("uninstall")
    .description("remove the managed hook wiring (preserves user content)")
    .option(
      "--shared",
      "remove the shared .linear-hooks/ wiring + reset core.hooksPath",
    )
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [options, command] = cmdArgs as [{ shared?: boolean }, Command];
        const rootOpts = getRootOpts(command);
        const result = uninstallHooks({
          cwd: process.cwd(),
          shared: options.shared,
        });
        outputResult(result, formatHooksUninstall, rootOpts);
      }),
    );

  hooks
    .command("usage")
    .description("show detailed usage for hooks")
    .action(() => {
      console.log(formatDomainUsage(hooks, HOOKS_META));
    });
}
