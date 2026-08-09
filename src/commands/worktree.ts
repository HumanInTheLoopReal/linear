import path from "node:path";
import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import {
  addWorktree,
  branchNameFromIssue,
  currentBranch,
  isGitRepo,
  isLinkedWorktree,
  listWorktrees,
  mainRepoRoot,
  removeWorktree,
  repoRoot,
  type WorktreeEntry,
  worktreeSafetyIssue,
} from "../services/git-service.js";
import { getIssue } from "../services/issue-service.js";

/**
 * `linear worktree <id> [path]` — per-issue git worktree. Lets an agent
 * (or human) keep a dedicated working tree per Linear issue so parallel
 * sessions don't stomp each other's index.
 *
 * `linear worktree list` mirrors `git worktree list` with a
 * `📁 Worktrees:` text block + a `{worktrees, main}` JSON envelope.
 *
 * Default path: `<parent-of-repo>/<identifier-lowercased>` so worktrees
 * land as siblings of the source checkout (matches the convention most
 * agents in this repo follow). Override with the positional `path`.
 */

export const WORKTREE_META: DomainMeta = {
  name: "worktree",
  summary: "create, list, remove, or inspect git worktrees for Linear issues",
  context: [
    "Four modes:",
    "  • `linear worktree create <id> [path]` — derive a branch name from",
    "    the Linear issue and run `git worktree add` to set up a sibling",
    "    checkout. Defaults to `../<identifier-lowercased>` next to the",
    "    repo root; override with `[path]`. Override the branch with",
    "    `--branch <name>` (attaches an existing local/remote branch, else",
    "    creates it).",
    "  • `linear worktree list` — show all worktrees with the main tree",
    "    marked. Mirrors `git worktree list` shape.",
    "  • `linear worktree remove <id-or-path>` — tear down a worktree after",
    "    safety checks (uncommitted changes / unpushed commits); `--force`",
    "    skips them. Accepts an issue id or a path.",
    "  • `linear worktree info` — show the current worktree (path, branch,",
    "    main repo) when cwd is a linked worktree.",
    "",
    "Useful for parallel agent sessions: each issue gets its own checkout",
    "so concurrent edits don't fight over the index, and a coordinator can",
    "clean them up when the work merges.",
  ].join("\n"),
  arguments: {
    id: "issue identifier (e.g. ENG-42) or UUID",
    path: "(optional) directory for the new worktree — defaults to `../<id-lowercased>`",
  },
  seeAlso: ["branch", "issues read"],
};

export type WorktreeCreateResult = {
  created: string;
  branch: string;
  issue: { id: string; identifier: string; title: string };
  action: "created" | "attached";
};

export type WorktreeListResult = {
  worktrees: WorktreeEntry[];
  main: string;
};

export type WorktreeRemoveResult = {
  removed: string;
  branch: string;
};

export type WorktreeInfoResult =
  | { isWorktree: false }
  | {
      isWorktree: true;
      path: string;
      name: string;
      branch: string;
      mainRepo: string;
    };

export type WorktreeResult =
  | WorktreeCreateResult
  | WorktreeListResult
  | WorktreeRemoveResult
  | WorktreeInfoResult;

export function formatWorktree(result: WorktreeResult): string {
  if ("worktrees" in result) {
    const lines = ["", "📁 Worktrees:", ""];
    for (const w of result.worktrees) {
      const marker = w.path === result.main ? "  * " : "    ";
      const branchTag = w.branch ? ` [${w.branch}]` : " [detached]";
      lines.push(`${marker}${w.path}${branchTag}`);
    }
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  if ("removed" in result) {
    const tag = result.branch ? ` (branch ${result.branch})` : "";
    return `Removed worktree ${result.removed}${tag}\n`;
  }
  if ("isWorktree" in result) {
    if (!result.isWorktree) {
      return "Not in a git worktree (this is the main repository)\n";
    }
    const lines = [
      `Worktree: ${result.path}`,
      `  Name: ${result.name}`,
      `  Branch: ${result.branch || "(detached)"}`,
      `  Main repo: ${result.mainRepo}`,
    ];
    return `${lines.join("\n")}\n`;
  }
  const verb =
    result.action === "created"
      ? "Created worktree at"
      : "Attached worktree at";
  return `${verb} ${result.created} on branch ${result.branch}\n`;
}

/**
 * Resolve a `remove <id-or-path>` argument to an existing worktree path.
 *
 * Accepts (in priority order, all matched against the live worktree
 * registry): an absolute/cwd-relative path, a repo-root-relative path, the
 * issue-identifier-derived sibling path (`../<id-lowercased>`, matching the
 * `create` default), and finally a basename match. Returns the registered
 * worktree path, or `null` when nothing matches.
 */
export function resolveWorktreePath(
  arg: string,
  repoRootPath: string,
  worktrees: WorktreeEntry[],
): string | null {
  const byPath = new Set(worktrees.map((w) => w.path));
  const candidates = [
    path.resolve(arg),
    repoRootPath ? path.join(repoRootPath, arg) : null,
    repoRootPath ? defaultWorktreePath(repoRootPath, arg) : null,
  ].filter((c): c is string => c !== null);
  for (const c of candidates) {
    if (byPath.has(c)) return c;
  }
  const base = path.basename(arg);
  const byBase = worktrees.find((w) => path.basename(w.path) === base);
  return byBase ? byBase.path : null;
}

/**
 * Default worktree path: sibling of the repo root named after the
 * lowercased issue identifier. e.g. repo at `/home/u/proj` + ENG-42 →
 * `/home/u/eng-42`.
 */
export function defaultWorktreePath(
  repoRootPath: string,
  identifier: string,
): string {
  return path.join(path.dirname(repoRootPath), identifier.toLowerCase());
}

export function setupWorktreeCommands(program: Command): void {
  const worktree = program
    .command("worktree")
    .description(
      "create, list, remove, or inspect git worktrees scoped to Linear issues",
    );

  worktree
    .command("list")
    .description("list git worktrees with the main tree marked")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        if (!isGitRepo()) {
          throw new Error(
            "linear worktree: not inside a git working tree (run from a git repo)",
          );
        }
        const worktrees = listWorktrees();
        const main = worktrees.find((w) => w.isMain)?.path ?? "";
        const result: WorktreeListResult = { worktrees, main };
        outputResult(result, formatWorktree, rootOpts);
      }),
    );

  worktree
    .command("create <id> [path]")
    .description(
      "create a git worktree for an issue (default path: ../<id-lowercased>)",
    )
    .option(
      "--branch <name>",
      "branch name for the worktree (default: derived from the issue id + title); attaches an existing local/remote branch when one matches",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [id, suppliedPath, opts, command] = args as [
          string,
          string | undefined,
          { branch?: string },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        if (!isGitRepo()) {
          throw new Error(
            "linear worktree: not inside a git working tree (run from a git repo)",
          );
        }
        const root = repoRoot();
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, id);
        const issue = await getIssue(ctx.gql, issueId);

        const branchName =
          opts.branch && opts.branch.length > 0
            ? opts.branch
            : branchNameFromIssue(issue.identifier, issue.title);
        const targetPath =
          suppliedPath && suppliedPath.length > 0
            ? path.resolve(suppliedPath)
            : defaultWorktreePath(root, issue.identifier);

        const action = addWorktree(targetPath, branchName);

        const result: WorktreeCreateResult = {
          created: targetPath,
          branch: branchName,
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
          },
          action,
        };
        outputResult(result, formatWorktree, rootOpts);
      }),
    );

  worktree
    .command("remove <id-or-path>")
    .description(
      "remove a worktree (issue id or path) after safety checks; --force to skip",
    )
    .option(
      "--force",
      "skip safety checks (uncommitted changes / unpushed commits)",
      false,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [target, opts, command] = args as [
          string,
          { force?: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        if (!isGitRepo()) {
          throw new Error(
            "linear worktree: not inside a git working tree (run from a git repo)",
          );
        }
        const root = repoRoot();
        const worktrees = listWorktrees();
        const resolved = resolveWorktreePath(target, root, worktrees);
        if (!resolved) {
          throw new Error(
            `linear worktree remove: no worktree matches '${target}'`,
          );
        }
        const mainPath = worktrees.find((w) => w.isMain)?.path ?? root;
        if (path.resolve(resolved) === path.resolve(mainPath)) {
          throw new Error(
            "linear worktree remove: cannot remove the main worktree",
          );
        }
        const force = opts.force ?? false;
        if (!force) {
          const issue = worktreeSafetyIssue(resolved);
          if (issue) {
            throw new Error(
              `linear worktree remove: ${issue} (use --force to override)`,
            );
          }
        }
        const branch = worktrees.find((w) => w.path === resolved)?.branch ?? "";
        removeWorktree(resolved, force);

        const result: WorktreeRemoveResult = { removed: resolved, branch };
        outputResult(result, formatWorktree, rootOpts);
      }),
    );

  worktree
    .command("info")
    .description(
      "show info about the current worktree (when cwd is a worktree)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        if (!isGitRepo()) {
          throw new Error(
            "linear worktree: not inside a git working tree (run from a git repo)",
          );
        }
        if (!isLinkedWorktree()) {
          const result: WorktreeInfoResult = { isWorktree: false };
          outputResult(result, formatWorktree, rootOpts);
          return;
        }
        const wtRoot = repoRoot();
        const result: WorktreeInfoResult = {
          isWorktree: true,
          path: wtRoot,
          name: path.basename(wtRoot),
          branch: currentBranch(),
          mainRepo: mainRepoRoot(),
        };
        outputResult(result, formatWorktree, rootOpts);
      }),
    );

  worktree
    .command("usage")
    .description("show detailed usage for worktree")
    .action(() => {
      console.log(formatDomainUsage(worktree, WORKTREE_META));
    });
}
