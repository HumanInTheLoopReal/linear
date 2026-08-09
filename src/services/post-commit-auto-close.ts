/**
 * `linear hooks run post-commit` handler.
 *
 * Drains the close-trailer queue written by `prepare-commit-msg`
 * (`.linear/pending-closes.jsonl`, one JSONL entry per commit) and
 * transitions each referenced Linear issue to its team's "completed"
 * state. The queue file is unlinked after a successful drain; transient
 * per-issue errors retain it so a later post-commit run can retry.
 *
 * For backward-compat with users invoking `linear hooks run post-commit`
 * without having gone through `prepare-commit-msg` (e.g. manual
 * invocation), falls back to parsing HEAD's commit message via
 * `git log -1 --pretty=%B` when no queue file is present.
 *
 * Idempotent + non-fatal: re-running on the same commit (or hitting an
 * already-closed issue) records a per-issue skip rather than failing the
 * hook. Per-issue failures are recorded but never abort the dispatch — a
 * post-commit hook that errors after the commit is already in the local
 * history would just confuse the user.
 *
 * Side effects (queue read/unlink, reading HEAD, calling Linear) are
 * injectable so the unit tests can exercise the orchestration logic
 * without a real git repo, queue file, or API.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import { parseCloseTrailers } from "./commit-trailers.js";
import {
  type PendingCloseEntry,
  pendingClosesQueuePath,
  type RunResult,
} from "./hooks-service.js";

export type AutoCloseOutcome =
  | "closed"
  | "already-closed"
  | "not-found"
  | "error";

export interface AutoCloseEntry {
  identifier: string;
  outcome: AutoCloseOutcome;
  reason?: string;
}

export interface PostCommitAutoCloseResult extends RunResult {
  hook: "post-commit";
  parsed: string[];
  entries: AutoCloseEntry[];
}

export interface PostCommitAutoCloseDeps {
  /** Resolve and close one issue; command/resolver layers own ID resolution. */
  closeIssue: (identifier: string) => Promise<AutoCloseOutcome>;
  /**
   * Override for tests; defaults to reading and parsing
   * `.linear/pending-closes.jsonl` at cwd. Returns the flattened,
   * de-duplicated list of identifiers across all queue entries plus a
   * cleanup function that unlinks the queue file when invoked. Returns
   * `null` when no queue file is present (caller falls back to the
   * git-log path for backward-compat).
   */
  readQueue?: () => { identifiers: string[]; clear: () => void } | null;
  /** Override for tests; defaults to `git log -1 --pretty=%B` at cwd. */
  readCommitMessage?: () => string;
  /**
   * Working directory used to resolve the queue file path. Defaults to
   * `process.cwd()`. Mainly for tests.
   */
  cwd?: string;
}

function defaultReadCommitMessage(): string {
  try {
    return execSync("git log -1 --pretty=%B", { encoding: "utf8" });
  } catch {
    return "";
  }
}

/**
 * Read the close-trailer queue file written by `prepare-commit-msg`,
 * flatten all entries into a de-duplicated identifier list, and return
 * a `clear()` callback that unlinks the queue. Returns `null` when no
 * queue file exists at `<cwd>/.linear/pending-closes.jsonl`.
 *
 * The queue is JSONL — one `{commit_token, identifiers}` entry per line.
 * Empty lines and unparseable lines are skipped (defensive against
 * partially-written files; we'd rather drain what we can than refuse).
 * Tracked in lin-c3m2.
 */
function defaultReadQueue(
  cwd: string,
): { identifiers: string[]; clear: () => void } | null {
  const queuePath = pendingClosesQueuePath(cwd);
  if (!fs.existsSync(queuePath)) {
    return null;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(queuePath, "utf8");
  } catch {
    return null;
  }
  const found = new Set<string>();
  const ordered: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: PendingCloseEntry;
    try {
      entry = JSON.parse(trimmed) as PendingCloseEntry;
    } catch {
      continue;
    }
    if (!Array.isArray(entry.identifiers)) continue;
    for (const id of entry.identifiers) {
      if (typeof id !== "string") continue;
      const upper = id.toUpperCase();
      if (!found.has(upper)) {
        found.add(upper);
        ordered.push(upper);
      }
    }
  }
  return {
    identifiers: ordered,
    clear: () => {
      try {
        fs.unlinkSync(queuePath);
      } catch {
        // Best-effort; a stale queue file is annoying but not fatal —
        // future drains will re-process the same identifiers and hit
        // `already-closed` outcomes.
      }
    },
  };
}

export async function runPostCommitAutoClose(
  deps: PostCommitAutoCloseDeps,
): Promise<PostCommitAutoCloseResult> {
  const cwd = deps.cwd ?? process.cwd();
  const readQueue = deps.readQueue ?? (() => defaultReadQueue(cwd));
  const readCommitMessage = deps.readCommitMessage ?? defaultReadCommitMessage;
  const close = deps.closeIssue;

  // Prefer the queue written by `prepare-commit-msg` (lin-c3m2). Falls
  // back to parsing HEAD's message via git log for users invoking
  // post-commit standalone (no prepare-commit-msg run) — preserves the
  // existing behavior for that path.
  let parsed: string[];
  let clearQueue: (() => void) | null = null;
  const queued = readQueue();
  if (queued) {
    parsed = queued.identifiers;
    clearQueue = queued.clear;
  } else {
    parsed = parseCloseTrailers(readCommitMessage());
  }

  if (parsed.length === 0) {
    // Even an empty queue file should be cleared so we don't keep
    // re-reading it on every commit.
    if (clearQueue) clearQueue();
    return {
      hook: "post-commit",
      action: "skipped",
      reason: "no close-trailers (Closes/Fixes/Resolves) in commit message",
      parsed,
      entries: [],
    };
  }

  const entries: AutoCloseEntry[] = [];
  for (const id of parsed) {
    try {
      const outcome = await close(id);
      entries.push({ identifier: id, outcome });
    } catch (e) {
      entries.push({
        identifier: id,
        outcome: "error",
        reason: (e as Error).message,
      });
    }
  }

  // Terminal outcomes are safe to discard. Keep the queue when any close
  // failed unexpectedly so a transient auth/network failure cannot silently
  // lose the pending close. Successfully handled entries are idempotent and
  // will return `already-closed` on the retry.
  const hasErrors = entries.some((entry) => entry.outcome === "error");
  if (clearQueue && !hasErrors) clearQueue();

  const closed = entries.filter((e) => e.outcome === "closed").length;
  return {
    hook: "post-commit",
    action: closed > 0 ? "applied" : "skipped",
    detail: `parsed ${parsed.length}, closed ${closed}`,
    parsed,
    entries,
  };
}
