import type { Command } from "commander";
import { getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";

/**
 * `linear tips` — curated workflow tips for agents + humans.
 *
 * Ships a small static catalog (no dynamic show-after-command machinery).
 */

export const TIPS_META: DomainMeta = {
  name: "tips",
  summary: "print curated workflow tips for using `linear` effectively",
  context: [
    "Outputs a markdown list of linear workflow hints (text by default,",
    "JSON via `--json`). Useful for new sessions or when an agent needs",
    "a refresher without re-running `linear prime`.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["prime", "onboard"],
};

export interface Tip {
  id: string;
  category: string;
  message: string;
}

export const TIPS: readonly Tip[] = [
  {
    id: "next-finds-unblocked",
    category: "Discovery",
    message:
      "Use `linear next` to find issues with no active blockers — the answer to 'what can I start now?'.",
  },
  {
    id: "ready-alias",
    category: "Discovery",
    message:
      "`linear ready` is an alias for `linear next`. Both work; pick the vocabulary you're used to.",
  },
  {
    id: "json-default-off",
    category: "Output",
    message:
      "Read-only verbs print human-readable text by default. Pass `--json` for the structured envelope when scripting or feeding output to another tool.",
  },
  {
    id: "assign-shortcut",
    category: "Workflow",
    message:
      "`linear assign <id> <user>` is shorter than `linear issues update <id> --assignee <user>`. Empty string unassigns.",
  },
  {
    id: "close-trailers",
    category: "Workflow",
    message:
      "Commit messages with `Closes ENG-N` / `Fixes ENG-N` / `Resolves ENG-N` trailers auto-close the referenced issues when the post-commit hook is installed (`linear hooks install`).",
  },
  {
    id: "prime-on-session-start",
    category: "Workflow",
    message:
      "Run `linear prime` at session start (or wire it into a `SessionStart` hook) so agents pick up workflow context after compaction.",
  },
  {
    id: "remember-persist",
    category: "Memory",
    message:
      '`linear remember "insight" --key <slug>` persists a note across sessions. Search with `linear memories <keyword>`, retrieve with `linear recall <slug>`.',
  },
  {
    id: "depends-graph",
    category: "Dependencies",
    message:
      "`linear depends tree <id>` walks the full dependency graph; `linear depends cycles` flags loops. Use before bulk-closing related issues.",
  },
  {
    id: "edit-blocks-agents",
    category: "Agent gotchas",
    message:
      "Don't run `linear edit <id>` from an agent — it opens `$EDITOR` and blocks until you exit. Use `linear issues update` for headless writes.",
  },
  {
    id: "parallel-creates",
    category: "Agent gotchas",
    message:
      "Spawn parallel subagents when creating many issues at once; each `issues create` is independent and parallelizes cleanly.",
  },
  {
    id: "short-verb-aliases",
    category: "Shortcuts",
    message:
      "Short top-level verbs (`list`, `show`, `create`, `close`, `ready`, `dep tree`, `defer`, ...) all work — see `src/commands/aliases.ts` for the full map.",
  },
  {
    id: "stealth-mode",
    category: "Workflow",
    message:
      "On a managed branch (no push rights)? Pair `linear prime --stealth` with `linear setup claude --stealth` to drop git-ops from the session-close protocol.",
  },
];

export interface TipsResult {
  count: number;
  tips: readonly Tip[];
}

export function formatTips(result: TipsResult): string {
  const byCategory = new Map<string, Tip[]>();
  for (const t of result.tips) {
    const bucket = byCategory.get(t.category) ?? [];
    bucket.push(t);
    byCategory.set(t.category, bucket);
  }

  const lines: string[] = [`💡 Tips (${result.count}):`, ""];
  for (const [category, items] of byCategory) {
    lines.push(`${category}`);
    for (const t of items) {
      lines.push(`  • ${t.message}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function setupTipsCommands(program: Command): void {
  program
    .command("tips")
    .description("print curated workflow tips for using `linear`")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        outputResult({ count: TIPS.length, tips: TIPS }, formatTips, rootOpts);
      }),
    );

  program
    .command("tips-usage")
    .description("show detailed usage for tips")
    .action(() => {
      const cmd = program.commands.find((c) => c.name() === "tips");
      if (cmd) console.log(formatDomainUsage(cmd, TIPS_META));
    });
}
