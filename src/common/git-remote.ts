import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Git derivation utilities for the implicit per-repo scope feature.
 *
 * All shellouts are best-effort: when `git` is absent, the cwd is not a
 * repo, or `origin` is unconfigured, every function returns `null`. Callers
 * compose these into a fallback chain (remote → toplevel → cwd) via
 * `deriveScopeLabel()` so the CLI degrades to "no scope" rather than
 * erroring outside a repo.
 */

export type ScopeSource = "git_remote" | "toplevel" | "cwd";

export interface DerivedScope {
  label: string;
  source: ScopeSource;
}

/**
 * Run `git remote get-url origin` and return its stdout, or `null` if git
 * is missing, the cwd is not a repo, or no `origin` is configured.
 */
export function getGitRemoteUrl(): string | null {
  try {
    const out = execFileSync("git", ["remote", "get-url", "origin"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

/**
 * Run `git rev-parse --show-toplevel` and return the repo root, or `null`
 * if the cwd is not inside a git repository. Shared by audit-store and the
 * scope/config-store local-layer resolver.
 */
export function getGitTopLevel(): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

/**
 * Extract the repository basename from a git remote URL.
 *
 * Handles the three forms users actually paste into `git remote add`:
 *   - SSH:    `git@github.com:org/repo.git`
 *   - HTTPS:  `https://github.com/org/repo.git`
 *   - SCP-ish without user: `github.com:org/repo`
 *
 * Trailing `.git` and a trailing slash are stripped. Returns `null` for
 * shapes we can't parse — the caller falls through to the toplevel
 * basename rather than throwing.
 */
export function parseRepoNameFromRemote(url: string): string | null {
  if (!url) return null;
  let s = url.trim();
  if (s === "") return null;

  // Strip trailing slash, then trailing .git.
  if (s.endsWith("/")) s = s.slice(0, -1);
  if (s.endsWith(".git")) s = s.slice(0, -4);
  if (s === "") return null;

  // The basename after the final `/` or `:` is the repo segment for every
  // shape we care about (SSH uses `:`, HTTPS/file uses `/`).
  const lastSlash = s.lastIndexOf("/");
  const lastColon = s.lastIndexOf(":");
  const cut = Math.max(lastSlash, lastColon);
  const segment = cut >= 0 ? s.slice(cut + 1) : s;
  return segment === "" ? null : segment;
}

/**
 * Derive the implicit scope label for the current directory.
 *
 * Priority chain (the first that yields a non-empty name wins):
 *   1. `git remote get-url origin` → parse repo segment
 *   2. `git rev-parse --show-toplevel` basename
 *   3. `process.cwd()` basename
 *
 * Returns `null` only when *all three* fail, which in practice means
 * `process.cwd()` resolved to the filesystem root. The returned label is
 * already prefixed with `git:` so callers can use it as a Linear label
 * name directly.
 */
export function deriveScopeLabel(): DerivedScope | null {
  const remote = getGitRemoteUrl();
  if (remote) {
    const parsed = parseRepoNameFromRemote(remote);
    if (parsed) {
      return { label: `git:${parsed}`, source: "git_remote" };
    }
  }

  const top = getGitTopLevel();
  if (top) {
    const base = path.basename(top);
    if (base) return { label: `git:${base}`, source: "toplevel" };
  }

  const cwd = process.cwd();
  const base = path.basename(cwd);
  if (base) return { label: `git:${base}`, source: "cwd" };

  return null;
}
