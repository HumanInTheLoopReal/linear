/**
 * Thin wrappers around the local `git` binary for verbs that drive a git
 * workflow from a Linear issue (e.g. `linear branch <id>`,
 * `linear worktree <id>`).
 *
 * These helpers shell out via {@link execFileSync} (not `execSync`) so the
 * branch name and any caller-supplied refs are passed as argv tokens
 * rather than interpolated into a shell string — no quoting/escaping
 * surface for accidentally-special characters like `;` or `$`.
 *
 * Slug derivation is intentionally pure (`branchNameFromIssue`) so tests
 * can verify it without spawning a process.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

export interface GitExecResult {
  stdout: string;
  exitCode: number;
}

/**
 * Run a git subcommand with arguments. Returns stdout and exit code.
 * Never throws — non-zero exits surface via `exitCode`.
 */
export function runGit(args: readonly string[]): GitExecResult {
  try {
    const stdout = execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { stdout: e.stdout ?? "", exitCode: e.status ?? 1 };
  }
}

/**
 * True when cwd is inside a git working tree.
 */
export function isGitRepo(): boolean {
  return runGit(["rev-parse", "--is-inside-work-tree"]).exitCode === 0;
}

/**
 * Current branch name, or empty string when detached / not in a repo.
 */
export function currentBranch(): string {
  const r = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (r.exitCode !== 0) return "";
  const name = r.stdout.trim();
  return name === "HEAD" ? "" : name;
}

/**
 * Local branches in declaration order (matches `git branch --list`).
 */
export function listBranches(): string[] {
  const r = runGit([
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/",
  ]);
  if (r.exitCode !== 0) return [];
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * True when a local branch with this name exists.
 */
export function branchExists(name: string): boolean {
  const r = runGit(["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
  return r.exitCode === 0;
}

/**
 * True when a remote-tracking branch with this short name exists under any
 * remote (e.g. `origin/<name>`), regardless of which remote.
 *
 * Used so `worktree create --branch <name>` can attach a pre-existing
 * team/remote branch (git DWIMs a local tracking branch) instead of forking
 * a fresh branch from HEAD. We enumerate `refs/remotes/` and compare the
 * branch portion (everything after the first `/` in `remote/branch`) so the
 * check is remote-agnostic.
 */
export function remoteBranchExists(name: string): boolean {
  const r = runGit([
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/remotes/",
  ]);
  if (r.exitCode !== 0) return false;
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .some((ref) => {
      const slash = ref.indexOf("/");
      return slash >= 0 && ref.slice(slash + 1) === name;
    });
}

/**
 * Switch to `name` (creating it if it does not exist). Returns whether the
 * branch was created (`"created"`) or already existed (`"switched"`).
 *
 * Uses `git switch` (modern, intent-clear) — falls back to `checkout` is
 * unnecessary here because `git switch` ships with git ≥ 2.23 (2019) and
 * we don't support anything older.
 */
export function switchToBranch(name: string): "created" | "switched" {
  if (branchExists(name)) {
    const r = runGit(["switch", name]);
    if (r.exitCode !== 0) {
      throw new Error(`git switch ${name} failed`);
    }
    return "switched";
  }
  const r = runGit(["switch", "-c", name]);
  if (r.exitCode !== 0) {
    throw new Error(`git switch -c ${name} failed`);
  }
  return "created";
}

/**
 * Slugify a free-form issue title into a git-branch-safe path segment.
 *
 * Rules:
 *  - lowercase
 *  - collapse runs of non-alphanumerics into a single `-`
 *  - trim leading/trailing `-`
 *  - cap at `maxLen` chars (default 50) so the final `<id>/<slug>` stays
 *    well under git's 255-char ref limit even with long identifiers
 */
export function slugify(title: string, maxLen = 50): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= maxLen) return slug;
  return slug.slice(0, maxLen).replace(/-+$/g, "");
}

/**
 * Compose the branch name we use for a given Linear issue:
 *   `<identifier-lowercased>/<title-slug>`
 *
 * e.g. `ENG-42` + "Add search filter" → `eng-42/add-search-filter`.
 *
 * When the title slugifies to empty (rare — title is whitespace or only
 * punctuation), falls back to just the identifier.
 */
export function branchNameFromIssue(identifier: string, title: string): string {
  const id = identifier.toLowerCase();
  const slug = slugify(title);
  return slug.length > 0 ? `${id}/${slug}` : id;
}

/**
 * Absolute path to the repository root (`git rev-parse --show-toplevel`),
 * or empty string when not in a repo.
 */
export function repoRoot(): string {
  const r = runGit(["rev-parse", "--show-toplevel"]);
  if (r.exitCode !== 0) return "";
  return r.stdout.trim();
}

export interface WorktreeEntry {
  /** Absolute filesystem path to the worktree. */
  path: string;
  /** Short branch name (e.g. "main") or empty when detached. */
  branch: string;
  /** True when this is the main working tree (not a linked worktree). */
  isMain: boolean;
}

/**
 * Parse `git worktree list --porcelain` into structured entries.
 *
 * Porcelain output looks like:
 *
 *   worktree /abs/path
 *   HEAD <sha>
 *   branch refs/heads/<name>     # OR `detached`
 *
 * Records are separated by blank lines. The first record is always the
 * main working tree.
 */
export function listWorktrees(): WorktreeEntry[] {
  const r = runGit(["worktree", "list", "--porcelain"]);
  if (r.exitCode !== 0) return [];

  const out: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> | null = null;
  let isMain = true;

  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current?.path) {
        out.push({
          path: current.path,
          branch: current.branch ?? "",
          isMain,
        });
        isMain = false;
      }
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("branch ")) {
      if (current) {
        const ref = line.slice("branch ".length).trim();
        current.branch = ref.startsWith("refs/heads/")
          ? ref.slice("refs/heads/".length)
          : ref;
      }
    } else if (line === "detached" && current) {
      current.branch = "";
    }
  }
  if (current?.path) {
    out.push({
      path: current.path,
      branch: current.branch ?? "",
      isMain,
    });
  }
  return out;
}

/**
 * Add a worktree at `path` on branch `branch`. Creates the branch from
 * HEAD when it doesn't exist; otherwise checks out the existing branch
 * into the new worktree.
 *
 * Returns `"created"` when we made a new branch, `"attached"` when we
 * checked out an existing one.
 */
export function addWorktree(
  worktreePath: string,
  branch: string,
): "created" | "attached" {
  // Existing local branch → check it out into the new worktree.
  if (branchExists(branch)) {
    const r = runGit(["worktree", "add", worktreePath, branch]);
    if (r.exitCode !== 0) {
      throw new Error(`git worktree add ${worktreePath} ${branch} failed`);
    }
    return "attached";
  }
  // No local branch, but a remote-tracking one exists → let git DWIM a local
  // tracking branch so an agent can target a pre-existing team/remote branch
  // instead of forking a fresh one from HEAD. (lin-efk1)
  if (remoteBranchExists(branch)) {
    const r = runGit(["worktree", "add", worktreePath, branch]);
    if (r.exitCode !== 0) {
      throw new Error(`git worktree add ${worktreePath} ${branch} failed`);
    }
    return "attached";
  }
  // Branch unknown anywhere → create a fresh local branch from HEAD.
  const r = runGit(["worktree", "add", "-b", branch, worktreePath]);
  if (r.exitCode !== 0) {
    throw new Error(`git worktree add -b ${branch} ${worktreePath} failed`);
  }
  return "created";
}

/**
 * Remove a worktree at `worktreePath`. With `force`, passes `--force` to skip
 * git's own dirty-tree guard (callers do their own safety checks first).
 * Throws on a non-zero git exit.
 */
export function removeWorktree(worktreePath: string, force: boolean): void {
  const args = force
    ? ["worktree", "remove", "--force", worktreePath]
    : ["worktree", "remove", worktreePath];
  const r = runGit(args);
  if (r.exitCode !== 0) {
    throw new Error(`git worktree remove ${worktreePath} failed`);
  }
}

/**
 * Pre-removal safety inspection for a worktree, checking:
 *  - uncommitted changes (`git status --porcelain` non-empty)
 *  - unpushed commits (`git log @{upstream}..` non-empty)
 *
 * Returns a human-readable reason string when the tree is unsafe to remove,
 * or `null` when it is clean. Stashes are intentionally not checked — git
 * stores them globally in the main repo, not per-worktree, so a stash check
 * would give misleading per-worktree results.
 */
export function worktreeSafetyIssue(worktreePath: string): string | null {
  const status = runGit(["-C", worktreePath, "status", "--porcelain"]);
  if (status.exitCode !== 0) {
    return "could not inspect worktree status";
  }
  if (status.stdout.trim().length > 0) {
    return "worktree has uncommitted changes";
  }
  // No upstream → non-zero exit; treat as "nothing to compare" (not unsafe).
  const unpushed = runGit([
    "-C",
    worktreePath,
    "log",
    "@{upstream}..",
    "--oneline",
  ]);
  if (unpushed.exitCode === 0 && unpushed.stdout.trim().length > 0) {
    return "worktree has unpushed commits";
  }
  return null;
}

/**
 * True when cwd is inside a *linked* worktree (not the main working tree).
 *
 * A linked worktree's gitdir lives under `<main>/.git/worktrees/<name>`, so
 * its `--git-dir` differs from `--git-common-dir` (which always points back
 * at the main `<main>/.git`). For the main tree the two are identical.
 */
export function isLinkedWorktree(): boolean {
  const gitDir = runGit(["rev-parse", "--git-dir"]);
  const commonDir = runGit(["rev-parse", "--git-common-dir"]);
  if (gitDir.exitCode !== 0 || commonDir.exitCode !== 0) return false;
  return (
    path.resolve(gitDir.stdout.trim()) !== path.resolve(commonDir.stdout.trim())
  );
}

/**
 * Absolute path to the main repository root, resolved from the shared git
 * common directory (`<main>/.git` → parent is `<main>`). Returns empty string
 * when not in a repo.
 */
export function mainRepoRoot(): string {
  const commonDir = runGit(["rev-parse", "--git-common-dir"]);
  if (commonDir.exitCode !== 0) return "";
  return path.dirname(path.resolve(commonDir.stdout.trim()));
}
