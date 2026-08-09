/**
 * `linear hooks` — git-hook dispatcher + lefthook installer.
 *
 * Rather than fight lefthook for ownership of `.git/hooks/`, we write a
 * marker-bracketed managed block into `lefthook.local.yml` (lefthook's
 * standard overlay file) that wires `linear hooks run <hook-name>` for
 * each event with portable behavior. The user's `lefthook.yml` is never
 * touched.
 *
 * Of the five managed hooks, only `prepare-commit-msg` has portable
 * behavior — it appends an `Executed-By: <actor>` trailer to a commit
 * message when the `LINEAR_ACTOR` env var is set. The other four
 * (pre-commit, post-merge, pre-push, post-checkout) have no portable
 * behavior in linear; they're recognized so dispatch doesn't error, but
 * they're no-ops and are not wired by install.
 *
 * If lefthook isn't configured in the target repo, install refuses with
 * guidance. Direct `.git/hooks/` shim fallback is deferred.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { parseCloseTrailers } from "./commit-trailers.js";

export type HookName =
  | "pre-commit"
  | "post-merge"
  | "pre-push"
  | "post-checkout"
  | "prepare-commit-msg"
  | "post-commit";

/**
 * Current linear-cli version, read from the bundled package.json. Used to
 * version-stamp the managed-block markers (`# --- BEGIN LINEAR HOOKS
 * v<version> ---`) so install/list/check can detect outdated installs.
 */
export const LINEAR_HOOKS_VERSION: string = pkg.version;

/**
 * Default timeout for `linear hooks run <name>` invocations, in seconds.
 * The shim respects `LINEAR_HOOK_TIMEOUT` to override per-environment;
 * users with slow chained pre-commit pipelines can bump this without
 * rebuilding.
 */
export const HOOK_TIMEOUT_SECONDS = 300;

/**
 * Exit code emitted by `linear hooks run` when Linear auth is not
 * configured. The shim translates this to exit 0 with a stderr warning so
 * an unconfigured contributor doesn't get broken commits.
 */
export const HOOK_AUTH_MISSING_EXIT_CODE = 3;

export const MANAGED_HOOKS: HookName[] = [
  "pre-commit",
  "post-merge",
  "pre-push",
  "post-checkout",
  "prepare-commit-msg",
  "post-commit",
];

export function isHookName(s: string): s is HookName {
  return (MANAGED_HOOKS as readonly string[]).includes(s);
}

export const TRAILER_KEY = "Executed-By";

export interface RunResult {
  hook: HookName;
  /** "applied" = real work happened; "skipped" = recognized but no-op for this hook. */
  action: "applied" | "skipped";
  /** Populated for prepare-commit-msg success; describes what changed. */
  detail?: string;
  /** Populated when the dispatcher could not act (missing args, missing env var, etc.). */
  reason?: string;
}

export interface RunHookOpts {
  hook: HookName;
  args: string[];
  /** Pass an explicit actor (overrides env). Mainly for tests. */
  actor?: string;
  /** Inject env for tests; production reads `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Inject fs adapter for tests. */
  fsAdapter?: {
    readFile: (p: string) => string;
    writeFile: (p: string, data: string) => void;
    /**
     * Append a single JSONL line to a queue file, creating the parent
     * directory if needed. Used by `prepare-commit-msg` to queue
     * close-trailers for the deferred post-commit drain.
     */
    appendQueue: (p: string, line: string) => void;
  };
  /**
   * Working directory for resolving `.linear/pending-closes.jsonl`.
   * Defaults to `process.cwd()`. Mainly for tests.
   */
  cwd?: string;
}

function defaultFsAdapter() {
  return {
    readFile: (p: string): string => fs.readFileSync(p, "utf8"),
    writeFile: (p: string, data: string): void => {
      fs.writeFileSync(p, data, { mode: 0o600 });
    },
    appendQueue: (p: string, line: string): void => {
      fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
      fs.appendFileSync(p, line.endsWith("\n") ? line : `${line}\n`, {
        mode: 0o600,
      });
    },
  };
}

/**
 * Relative path (from cwd) of the close-trailer queue file written by
 * `prepare-commit-msg` and drained by `post-commit`. Per-repo, gitignored
 * by convention. JSONL format — each line is one
 * `{commit_token, identifiers}` entry. The queue is unlinked after a
 * successful drain so it never grows unbounded.
 */
export const PENDING_CLOSES_QUEUE_PATH = ".linear/pending-closes.jsonl";

/**
 * Resolve the absolute path of the pending-closes queue file relative to
 * the given working directory (or `process.cwd()` if unspecified).
 */
export function pendingClosesQueuePath(cwd: string = process.cwd()): string {
  return path.join(cwd, PENDING_CLOSES_QUEUE_PATH);
}

/**
 * One queued entry from `prepare-commit-msg`. The `commit_token` is an
 * opaque string keying the entry to its message file (used for
 * idempotency when the same message file is processed twice — e.g.
 * `git commit --amend` re-runs the prepare hook). On drain, all entries'
 * `identifiers` are flattened and de-duplicated before resolution.
 */
export interface PendingCloseEntry {
  commit_token: string;
  identifiers: string[];
}

/**
 * prepare-commit-msg dispatch path. Two responsibilities — both run
 * against the message FILE git hands the hook (not `git log -1`, since
 * the commit hasn't happened yet):
 *
 *   1. Append `Executed-By: <actor>` trailer iff
 *      a. LINEAR_ACTOR is set (or `opts.actor` passed)
 *      b. message file exists
 *      c. source is not "merge" (git supplies that as args[1])
 *      d. trailer is not already present (avoids dupes on `--amend`)
 *
 *   2. Parse `Closes/Fixes/Resolves ENG-N` close-trailers from the
 *      message body via {@link parseCloseTrailers} and queue them to
 *      `.linear/pending-closes.jsonl` for the deferred post-commit
 *      drain. The state transition itself does NOT happen here — that
 *      runs out-of-hook in `post-commit` to avoid blocking the commit on
 *      GraphQL latency.
 *
 * Always returns "applied" or "skipped" — never throws — because a
 * prepare-commit-msg hook that blocks the commit is hostile.
 *
 * The two steps are independent: actor-trailer can apply while
 * close-trailers are absent (and vice-versa). The result `detail`
 * describes both actions when both fire.
 */
function runPrepareCommitMsg(opts: RunHookOpts): RunResult {
  const env = opts.env ?? process.env;
  const adapter = opts.fsAdapter ?? defaultFsAdapter();
  const actor = opts.actor ?? env.LINEAR_ACTOR;
  const cwd = opts.cwd ?? process.cwd();

  const msgFile = opts.args[0];
  if (!msgFile) {
    return {
      hook: "prepare-commit-msg",
      action: "skipped",
      reason: "no message file provided",
    };
  }
  const source = opts.args[1] ?? "";
  if (source === "merge") {
    return {
      hook: "prepare-commit-msg",
      action: "skipped",
      reason: "merge commit; trailer not applicable",
    };
  }

  let content: string;
  try {
    content = adapter.readFile(msgFile);
  } catch (e) {
    return {
      hook: "prepare-commit-msg",
      action: "skipped",
      reason: `could not read ${msgFile}: ${(e as Error).message}`,
    };
  }

  // Step 2 first (in code order): parse close-trailers off the message
  // we just read. We compute this before deciding whether to write the
  // actor trailer so the queued identifiers reflect the message as the
  // user wrote it (the appended trailer line never contains close
  // keywords). Note: per-spec, NO GraphQL call here — only local FS.
  const closeIdentifiers = parseCloseTrailers(content);
  let queueDetail: string | undefined;
  if (closeIdentifiers.length > 0) {
    try {
      const entry: PendingCloseEntry = {
        commit_token: msgFile,
        identifiers: closeIdentifiers,
      };
      adapter.appendQueue(pendingClosesQueuePath(cwd), JSON.stringify(entry));
      queueDetail = `queued ${closeIdentifiers.length} close-trailer${closeIdentifiers.length === 1 ? "" : "s"}`;
    } catch (e) {
      // Queue write failure must not abort the commit; log via reason
      // but don't refuse the whole dispatch.
      queueDetail = `queue write failed: ${(e as Error).message}`;
    }
  }

  // Step 1: actor trailer. Independent of close-trailer queuing.
  let actorDetail: string | undefined;
  let actorSkipReason: string | undefined;
  if (!actor || actor.trim() === "") {
    actorSkipReason = "LINEAR_ACTOR not set; no trailer to add";
  } else {
    let trailerAlreadyPresent = false;
    for (const line of content.split("\n")) {
      if (line.startsWith(`${TRAILER_KEY}:`)) {
        trailerAlreadyPresent = true;
        break;
      }
    }
    if (trailerAlreadyPresent) {
      actorSkipReason = "trailer already present";
    } else {
      const trimmed = content.replace(/[\n\r\t ]+$/, "");
      const next = `${trimmed}\n\n${TRAILER_KEY}: ${actor}\n`;
      try {
        adapter.writeFile(msgFile, next);
        actorDetail = `appended ${TRAILER_KEY}: ${actor}`;
      } catch (e) {
        actorSkipReason = `could not write ${msgFile}: ${(e as Error).message}`;
      }
    }
  }

  // Combine the two outcomes into a single RunResult. "applied" iff
  // either step did real work; "skipped" only if neither did.
  const didWork = actorDetail !== undefined || closeIdentifiers.length > 0;
  if (didWork) {
    const detailParts: string[] = [];
    if (actorDetail) detailParts.push(actorDetail);
    if (queueDetail) detailParts.push(queueDetail);
    return {
      hook: "prepare-commit-msg",
      action: "applied",
      detail: detailParts.join("; "),
    };
  }
  return {
    hook: "prepare-commit-msg",
    action: "skipped",
    reason: actorSkipReason ?? "no actor + no close-trailers",
  };
}

/**
 * Per-hook narrative copy describing the hook's role (active hooks) or why
 * it is inert (surface-only hooks). Consumed by both the `runHook`
 * skipped-reason and `linear hooks list` output.
 */
export interface HookNarrative {
  /** Whether this hook has linear-specific behavior (vs surface-parity only). */
  active: boolean;
  /** One-line description shown under the hook row in `linear hooks list`. */
  narrative: string;
}

export const HOOK_NARRATIVES: Record<HookName, HookNarrative> = {
  "pre-commit": {
    active: false,
    narrative:
      "linear-cli has no local issue DB to export; Linear is the source of truth. No-op.",
  },
  "post-merge": {
    active: false,
    narrative:
      "linear-cli has no local issue DB; Linear is workspace-global, so there's nothing to import after `git pull`. No-op.",
  },
  "pre-push": {
    active: false,
    narrative:
      "linear-cli has no local issue remote; all Linear writes happen at command time via GraphQL. No-op.",
  },
  "post-checkout": {
    active: false,
    narrative:
      "linear-cli has no per-branch issue state; issues are workspace-global. No-op.",
  },
  "prepare-commit-msg": {
    active: true,
    narrative:
      "Appends `Executed-By: $LINEAR_ACTOR` to the commit message and queues any `Closes/Fixes/Resolves ENG-N` close-trailers for the post-commit drain.",
  },
  "post-commit": {
    active: true,
    narrative:
      "Drains pending close-trailers queued by prepare-commit-msg, transitioning each referenced Linear issue to its team's `completed` state.",
  },
};

export function runHook(opts: RunHookOpts): RunResult {
  if (opts.hook === "prepare-commit-msg") {
    return runPrepareCommitMsg(opts);
  }
  // The remaining hooks are recognized so dispatch doesn't error, but
  // they have no portable behavior in linear. Return the per-hook
  // narrative so the user understands why it's inert without consulting
  // docs.
  return {
    hook: opts.hook,
    action: "skipped",
    reason: HOOK_NARRATIVES[opts.hook]?.narrative ?? `${opts.hook} no-op`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// install / uninstall / install-status — managed lefthook.local.yml block
// ──────────────────────────────────────────────────────────────────────

export const LEFTHOOK_FILE = "lefthook.yml";
export const LEFTHOOK_LOCAL_FILE = "lefthook.local.yml";

/**
 * Marker-line prefix. Versioned markers (the current shape, e.g.
 * `# --- BEGIN LINEAR HOOKS v2026.4.9 ---`) share this prefix with the
 * legacy unversioned form (`# --- BEGIN LINEAR HOOKS ---`), so detection
 * uses `startsWith(prefix)` and the version string is parsed off the
 * trailing portion via {@link parseHookVersion}.
 */
export const HOOK_BEGIN_MARKER = "# --- BEGIN LINEAR HOOKS";
export const HOOK_END_MARKER = "# --- END LINEAR HOOKS";

/**
 * Build the full begin-marker line including the version stamp.
 */
export function buildBeginMarker(
  version: string = LINEAR_HOOKS_VERSION,
): string {
  return `${HOOK_BEGIN_MARKER} v${version} ---`;
}

/**
 * Build the full end-marker line including the version stamp. Symmetric
 * with {@link buildBeginMarker}.
 */
export function buildEndMarker(version: string = LINEAR_HOOKS_VERSION): string {
  return `${HOOK_END_MARKER} v${version} ---`;
}

/**
 * Extract the version stamp from a managed-block marker line. Returns
 * `undefined` when the marker is the legacy unversioned form. Used by the
 * outdated-detection path in {@link checkHooksInstalled}.
 */
export function parseHookVersion(markerLine: string): string | undefined {
  const trimmed = markerLine.trimEnd();
  const match = trimmed.match(/\sv([^\s]+)\s*---$/);
  return match ? match[1] : undefined;
}

/**
 * Hooks we wire on install. Five git hooks plus linear-cli's `post-commit`
 * queue flusher. Four of the five git hooks are inert at the dispatch
 * layer (see HOOK_NARRATIVES) but they're still wired here so
 * `lefthook validate` shows the full hook lineup. Inert dispatches return
 * action="skipped" + the per-hook narrative, exit 0.
 */
export const WIRED_HOOKS: HookName[] = [
  "pre-commit",
  "post-merge",
  "pre-push",
  "post-checkout",
  "prepare-commit-msg",
  "post-commit",
];

/**
 * Lefthook-managed section content. One step per hook in {@link WIRED_HOOKS}
 * — git hooks dispatch to `linear hooks run <name> {1}` (lefthook expands
 * `{1}` to the first positional arg, which is the commit-message file for
 * `prepare-commit-msg` and the squash flag for `post-merge`). The
 * `post-commit` step is a custom step (git's post-commit isn't a lefthook
 * built-in) wired so the close-trailer queue drain runs after the commit
 * lands.
 */
function buildLefthookSection(version: string = LINEAR_HOOKS_VERSION): string {
  const lines: string[] = [buildBeginMarker(version)];
  for (const hook of WIRED_HOOKS) {
    lines.push(`${hook}:`);
    lines.push("  commands:");
    lines.push(`    linear-${hook}:`);
    if (hook === "post-commit") {
      lines.push(`      run: linear hooks run ${hook}`);
    } else {
      lines.push(`      run: linear hooks run ${hook} {1}`);
    }
  }
  lines.push(buildEndMarker(version));
  return lines.join("\n");
}

interface SectionLoc {
  found: boolean;
  /** Byte offset of the BEGIN marker's first character. */
  start: number;
  /** Byte offset one past the END marker's final character (inclusive of `---`). */
  end: number;
  /** The raw begin-marker line content (for version detection). */
  beginLine?: string;
}

/**
 * Locate the managed block by matching the BEGIN/END prefixes (so old and
 * new versioned markers both resolve). The returned `start` points at the
 * first character of the BEGIN line; `end` points one byte past the last
 * `---` of the END line, so callers can slice `content.slice(start, end)`
 * to capture the full block including any version suffix.
 */
function findManagedSection(content: string): SectionLoc {
  const start = content.indexOf(HOOK_BEGIN_MARKER);
  const endIdx = content.indexOf(HOOK_END_MARKER);
  if (start === -1 || endIdx === -1 || start > endIdx) {
    return { found: false, start: -1, end: -1 };
  }
  // Walk the BEGIN line to its newline so we can extract the version stamp
  // without including the trailing newline in the slice.
  let beginLineEnd = content.indexOf("\n", start);
  if (beginLineEnd === -1) beginLineEnd = content.length;
  const beginLine = content.slice(start, beginLineEnd);
  // Walk the END line to its newline so the slice consumes the full
  // marker (including any "v<version> ---" suffix) but stops before the
  // newline — callers append/strip newlines as needed.
  let endLineEnd = content.indexOf("\n", endIdx);
  if (endLineEnd === -1) endLineEnd = content.length;
  return { found: true, start, end: endLineEnd, beginLine };
}

function upsertSection(content: string, section: string): string {
  const loc = findManagedSection(content);
  if (loc.found) {
    return content.slice(0, loc.start) + section + content.slice(loc.end);
  }
  if (content.trim() === "") return `${section}\n`;
  const base = content.endsWith("\n") ? content : `${content}\n`;
  return `${base}\n${section}\n`;
}

function stripSection(content: string): { next: string; stripped: boolean } {
  const loc = findManagedSection(content);
  if (!loc.found) return { next: content, stripped: false };
  let end = loc.end;
  if (end < content.length && content[end] === "\n") end += 1;
  return {
    next: content.slice(0, loc.start) + content.slice(end),
    stripped: true,
  };
}

export type HooksTarget = "lefthook" | "git-hooks";

/**
 * Committable hooks directory used by `--shared`. Namespaced as
 * `.linear-hooks/` so it is easy to identify and can coexist alongside other
 * tools' hook directories. Lives at the repo root (not under `.git/`) so
 * it can be checked in and shared with the team.
 */
export const SHARED_HOOKS_DIR = ".linear-hooks";

export interface HooksInstallResult {
  recipe: "hooks";
  target: HooksTarget;
  path: string;
  action: "installed" | "updated" | "current";
  hook_names: HookName[];
  /** True when installed into the committable `.linear-hooks/` directory. */
  shared: boolean;
  /**
   * True when pre-existing hook content was preserved alongside the managed
   * block. Linear always preserves in-file, so this is reported (rather than
   * gated) for `--chain` parity.
   */
  chained: boolean;
  /** Absolute `core.hooksPath` set during a shared install, if any. */
  hooks_path?: string;
}

export interface HooksUninstallResult {
  recipe: "hooks";
  target: HooksTarget;
  path: string;
  action: "removed" | "absent";
  hook_names: HookName[];
  /** True when the shared `.linear-hooks/` directory was targeted. */
  shared: boolean;
  /** Set when `core.hooksPath` was reset because it pointed at our dir. */
  hooks_path_reset?: boolean;
}

/** Options for {@link installHooks}. */
export interface InstallHooksOptions {
  cwd: string;
  /**
   * Re-stamp the managed block even when it is already current (returns
   * `updated` rather than `current`). Backs the `--force` flag.
   */
  force?: boolean;
  /**
   * Install into a committable `.linear-hooks/` directory at the repo root
   * and point `core.hooksPath` at it (absolute, worktree-safe), instead of
   * the per-clone `.git/hooks/`. Lets a team share the wiring via git.
   * Backs the `--shared` flag.
   */
  shared?: boolean;
  /**
   * Accepted for `--chain` parity. Linear's installer always preserves
   * and runs pre-existing hook content in-file (the managed block is
   * appended after it), so chaining is already the default — this flag only
   * surfaces the intent in the result envelope. Linear never renames hooks
   * to `<name>.old`.
   */
  chain?: boolean;
}

/** Options for {@link uninstallHooks}. */
export interface UninstallHooksOptions {
  cwd: string;
  /** Target the shared `.linear-hooks/` directory and reset core.hooksPath. */
  shared?: boolean;
}

/**
 * Run `git -C <cwd> <args>` and return trimmed stdout, or `undefined` on a
 * non-zero exit. Never throws — keeps the installer resilient when git is
 * absent or the directory isn't a repo. We pass `-C` instead of chdir'ing
 * so concurrent installs (and tests) never race on the process cwd.
 */
function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/** Absolute repo root for `cwd`, preferring the main worktree's root. */
function repoRootFor(cwd: string): string | undefined {
  // --show-toplevel is the working-tree root; for a linked worktree the
  // shared hooks dir should live at the main repo root so every worktree
  // resolves the same committed hooks. --git-common-dir/.. gets us there.
  const common = git(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (common) return path.dirname(common);
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

/** Set `core.hooksPath` to an absolute path (worktree-safe). */
function setHooksPath(cwd: string, absPath: string): void {
  git(cwd, ["config", "core.hooksPath", absPath]);
}

/**
 * Unset `core.hooksPath` iff it currently points at our shared dir, so an
 * uninstall doesn't clobber a path the user set themselves. Returns whether
 * a reset happened.
 */
function resetHooksPathIfManaged(cwd: string, managedAbs: string): boolean {
  const current = git(cwd, ["config", "--get", "core.hooksPath"]);
  if (!current) return false;
  if (path.resolve(current) === path.resolve(managedAbs)) {
    git(cwd, ["config", "--unset", "core.hooksPath"]);
    return true;
  }
  return false;
}

export interface HooksInstallStatus {
  recipe: "hooks";
  target: HooksTarget;
  path: string;
  installed: boolean;
  /**
   * True iff the managed block on disk is version-stamped and the version
   * does not match {@link LINEAR_HOOKS_VERSION}. Legacy unversioned blocks
   * (no `v<x>` suffix on the marker) are also reported as outdated so a
   * `linear hooks install` re-run rewrites them with the current marker.
   */
  outdated: boolean;
  /** The version stamp found on disk, if any (undefined for legacy blocks). */
  installed_version?: string;
  /** Always the running CLI version, exposed for clients that surface it. */
  current_version: string;
  lefthook_present: boolean;
  hook_names: HookName[];
}

export class LefthookMissingError extends Error {
  constructor(cwd: string) {
    super(
      `lefthook.yml not found in ${cwd}. linear hooks install only supports lefthook today; install lefthook (https://lefthook.dev) or wire 'linear hooks run <name>' from your existing hook system.`,
    );
    this.name = "LefthookMissingError";
  }
}

export class GitRepoMissingError extends Error {
  constructor(cwd: string) {
    super(
      `${cwd} is not a git repository (no '.git' directory). Run \`git init\` first.`,
    );
    this.name = "GitRepoMissingError";
  }
}

function lefthookLocalPath(cwd: string): string {
  return path.join(cwd, LEFTHOOK_LOCAL_FILE);
}

function lefthookMainPath(cwd: string): string {
  return path.join(cwd, LEFTHOOK_FILE);
}

function gitHooksDir(cwd: string): string {
  return path.join(cwd, ".git", "hooks");
}

function gitHookPath(cwd: string, hookName: HookName): string {
  return path.join(gitHooksDir(cwd), hookName);
}

function hasLefthook(cwd: string): boolean {
  return fs.existsSync(lefthookMainPath(cwd));
}

function hasGitRepo(cwd: string): boolean {
  return (
    fs
      .statSync(path.join(cwd, ".git"), { throwIfNoEntry: false })
      ?.isDirectory() === true
  );
}

/**
 * Build the marker-bracketed shell-script body that gets written into
 * `.git/hooks/<hookName>` when no lefthook is present. The script exec's
 * `linear hooks run <hookName>` so the hook stays self-updating: only
 * the dispatch wiring lives in `.git/hooks`, not the actual hook logic.
 *
 * Resilience features:
 *   - command-v guard: if `linear` is not on PATH, exit 0 silently.
 *   - timeout wrap: `timeout "$_lin_timeout" linear hooks run <name>` so a
 *     hung hook can't stall `git push` indefinitely. `_lin_timeout`
 *     defaults to {@link HOOK_TIMEOUT_SECONDS} and can be overridden via
 *     `LINEAR_HOOK_TIMEOUT`. If the `timeout` binary isn't available
 *     (macOS without coreutils), the invocation falls back to a direct
 *     call.
 *   - exit-3 graceful skip: when `linear hooks run` returns
 *     {@link HOOK_AUTH_MISSING_EXIT_CODE} ("auth not configured"), the
 *     shim emits a stderr warning and exits 0 so an unconfigured
 *     contributor doesn't get broken commits.
 *   - exit-124 graceful skip: `timeout`'s "killed" exit gets the same
 *     treatment — warn but don't abort.
 */
function buildGitHookShim(
  hookName: HookName,
  version: string = LINEAR_HOOKS_VERSION,
): string {
  return [
    buildBeginMarker(version),
    "# Managed by linear. Do not edit between markers.",
    "if command -v linear >/dev/null 2>&1; then",
    "  export LINEAR_GIT_HOOK=1",
    `  _lin_timeout=\${LINEAR_HOOK_TIMEOUT:-${HOOK_TIMEOUT_SECONDS}}`,
    "  if command -v timeout >/dev/null 2>&1; then",
    `    timeout "$_lin_timeout" linear hooks run ${hookName} "$@"`,
    "    _lin_exit=$?",
    "    if [ $_lin_exit -eq 124 ]; then",
    `      echo >&2 "linear: hook '${hookName}' timed out after \${_lin_timeout}s — continuing"`,
    "      _lin_exit=0",
    "    fi",
    "  else",
    `    linear hooks run ${hookName} "$@"`,
    "    _lin_exit=$?",
    "  fi",
    `  if [ $_lin_exit -eq ${HOOK_AUTH_MISSING_EXIT_CODE} ]; then`,
    `    echo >&2 "linear: auth not configured — skipping hook '${hookName}'"`,
    "    _lin_exit=0",
    "  fi",
    "  if [ $_lin_exit -ne 0 ]; then exit $_lin_exit; fi",
    "fi",
    buildEndMarker(version),
  ].join("\n");
}

/**
 * Does `content` carry user-authored lines beyond a bare shebang and the
 * managed block? Used to report `chained` — linear always preserves such
 * content in-file (the `--chain` outcome) rather than renaming to
 * `<name>.old`.
 */
function hasPreservedUserContent(content: string): boolean {
  const { next } = stripSection(content);
  const remainder = next.replace(/^#!.*\n?/, "").trim();
  return remainder !== "";
}

function installLefthookManaged(
  cwd: string,
  force: boolean,
): HooksInstallResult {
  const filePath = lefthookLocalPath(cwd);
  const section = buildLefthookSection();

  let current = "";
  let hadSection = false;
  let alreadyCurrent = false;
  if (fs.existsSync(filePath)) {
    current = fs.readFileSync(filePath, "utf8");
    const loc = findManagedSection(current);
    hadSection = loc.found;
    if (loc.found) {
      alreadyCurrent = current.slice(loc.start, loc.end) === section;
    }
  }
  const chained = hasPreservedUserContent(current);
  if (alreadyCurrent && !force) {
    return {
      recipe: "hooks",
      target: "lefthook",
      path: filePath,
      action: "current",
      hook_names: WIRED_HOOKS,
      shared: false,
      chained,
    };
  }
  const next = upsertSection(current, section);
  fs.writeFileSync(filePath, next, "utf8");
  return {
    recipe: "hooks",
    target: "lefthook",
    path: filePath,
    // --force re-stamping an unchanged block still counts as "updated" so
    // the user sees the rewrite happened.
    action: hadSection ? "updated" : "installed",
    hook_names: WIRED_HOOKS,
    shared: false,
    chained,
  };
}

/**
 * Write a marker-bracketed shim into `<dir>/<name>` for every wired hook
 * and chmod it +x. If a hook file already exists, the shim is upserted
 * between the markers and other user content is preserved (mirrors the
 * lefthook.local.yml flow). If no shebang is present yet, a `#!/bin/sh`
 * line is prepended. Shared by the `.git/hooks/` and `.linear-hooks/`
 * (shared) install paths.
 */
function writeShimsInto(
  dir: string,
  force: boolean,
): {
  action: HooksInstallResult["action"];
  lastPath: string;
  chained: boolean;
} {
  fs.mkdirSync(dir, { recursive: true });

  // Per-hook action precedence: any "updated" wins over "installed",
  // which wins over "current". Otherwise a fresh post-commit install
  // would mask the fact that prepare-commit-msg's managed block was
  // replaced in place.
  let anyUpdated = false;
  let anyInstalled = false;
  let chained = false;
  let lastPath = "";
  for (const hookName of WIRED_HOOKS) {
    const hookPath = path.join(dir, hookName);
    lastPath = hookPath;
    const section = buildGitHookShim(hookName);

    let current = "";
    let hadSection = false;
    let alreadyCurrent = false;
    if (fs.existsSync(hookPath)) {
      current = fs.readFileSync(hookPath, "utf8");
      const loc = findManagedSection(current);
      hadSection = loc.found;
      if (loc.found) {
        alreadyCurrent = current.slice(loc.start, loc.end) === section;
      }
    }
    if (hasPreservedUserContent(current)) chained = true;
    if (alreadyCurrent && !force) {
      continue;
    }
    let next = upsertSection(current, section);
    if (!next.startsWith("#!")) {
      next = `#!/bin/sh\n${next.startsWith("\n") ? next.slice(1) : next}`;
    }
    fs.writeFileSync(hookPath, next, "utf8");
    fs.chmodSync(hookPath, 0o755);
    if (hadSection) anyUpdated = true;
    else anyInstalled = true;
  }
  const action: HooksInstallResult["action"] = anyUpdated
    ? "updated"
    : anyInstalled
      ? "installed"
      : "current";
  return { action, lastPath, chained };
}

/** Fall-back installer for repos without lefthook: write into `.git/hooks/`. */
function installGitHooksShim(cwd: string, force: boolean): HooksInstallResult {
  if (!hasGitRepo(cwd)) {
    throw new GitRepoMissingError(cwd);
  }
  const { action, lastPath, chained } = writeShimsInto(gitHooksDir(cwd), force);
  return {
    recipe: "hooks",
    target: "git-hooks",
    path: lastPath,
    action,
    hook_names: WIRED_HOOKS,
    shared: false,
    chained,
  };
}

/**
 * `--shared` installer: write shims into a committable `.linear-hooks/`
 * directory at the repo root and point `core.hooksPath` at it with an
 * absolute path (worktree-safe). Lets a team commit the wiring instead of
 * each clone running `linear hooks install` by hand.
 */
function installSharedHooksShim(
  cwd: string,
  force: boolean,
): HooksInstallResult {
  if (!hasGitRepo(cwd)) {
    throw new GitRepoMissingError(cwd);
  }
  const root = repoRootFor(cwd) ?? cwd;
  const dir = path.join(root, SHARED_HOOKS_DIR);
  const { action, lastPath, chained } = writeShimsInto(dir, force);
  setHooksPath(cwd, dir);
  return {
    recipe: "hooks",
    target: "git-hooks",
    path: lastPath,
    action,
    hook_names: WIRED_HOOKS,
    shared: true,
    chained,
    hooks_path: dir,
  };
}

export function installHooks(opts: InstallHooksOptions): HooksInstallResult {
  const force = opts.force ?? false;
  if (opts.shared) {
    return installSharedHooksShim(opts.cwd, force);
  }
  if (hasLefthook(opts.cwd)) {
    return installLefthookManaged(opts.cwd, force);
  }
  return installGitHooksShim(opts.cwd, force);
}

function uninstallLefthookManaged(cwd: string): HooksUninstallResult {
  const filePath = lefthookLocalPath(cwd);
  if (!fs.existsSync(filePath)) {
    return {
      recipe: "hooks",
      target: "lefthook",
      path: filePath,
      action: "absent",
      hook_names: WIRED_HOOKS,
      shared: false,
    };
  }
  const current = fs.readFileSync(filePath, "utf8");
  const { next, stripped } = stripSection(current);
  if (!stripped) {
    return {
      recipe: "hooks",
      target: "lefthook",
      path: filePath,
      action: "absent",
      hook_names: WIRED_HOOKS,
      shared: false,
    };
  }
  if (next.trim() === "") {
    fs.unlinkSync(filePath);
  } else {
    fs.writeFileSync(filePath, next, "utf8");
  }
  return {
    recipe: "hooks",
    target: "lefthook",
    path: filePath,
    action: "removed",
    hook_names: WIRED_HOOKS,
    shared: false,
  };
}

/**
 * Strip managed shims from a hooks directory. Removes a file outright when
 * only a shebang (or nothing) remains, else rewrites the preserved content.
 * Shared by the `.git/hooks/` and shared `.linear-hooks/` uninstall paths.
 */
function stripShimsFrom(dir: string): {
  action: HooksUninstallResult["action"];
  lastPath: string;
} {
  let action: HooksUninstallResult["action"] = "absent";
  let lastPath = "";
  for (const hookName of WIRED_HOOKS) {
    const hookPath = path.join(dir, hookName);
    lastPath = hookPath;
    if (!fs.existsSync(hookPath)) continue;
    const current = fs.readFileSync(hookPath, "utf8");
    const { next, stripped } = stripSection(current);
    if (!stripped) continue;
    // If after stripping only the shebang (or nothing) remains, remove the file.
    if (next.trim() === "" || next.trim() === "#!/bin/sh") {
      fs.unlinkSync(hookPath);
    } else {
      fs.writeFileSync(hookPath, next, "utf8");
      fs.chmodSync(hookPath, 0o755);
    }
    action = "removed";
  }
  return { action, lastPath };
}

function uninstallGitHooksShim(cwd: string): HooksUninstallResult {
  const { action, lastPath } = stripShimsFrom(gitHooksDir(cwd));
  return {
    recipe: "hooks",
    target: "git-hooks",
    path: lastPath,
    action,
    hook_names: WIRED_HOOKS,
    shared: false,
  };
}

function uninstallSharedHooksShim(cwd: string): HooksUninstallResult {
  const root = repoRootFor(cwd) ?? cwd;
  const dir = path.join(root, SHARED_HOOKS_DIR);
  const { action, lastPath } = stripShimsFrom(dir);
  // Reset core.hooksPath only when it still points at our dir, so we never
  // clobber a path the user set themselves.
  const hooks_path_reset = resetHooksPathIfManaged(cwd, dir);
  return {
    recipe: "hooks",
    target: "git-hooks",
    path: lastPath,
    action,
    hook_names: WIRED_HOOKS,
    shared: true,
    hooks_path_reset,
  };
}

export function uninstallHooks(
  opts: UninstallHooksOptions,
): HooksUninstallResult {
  if (opts.shared) {
    return uninstallSharedHooksShim(opts.cwd);
  }
  if (hasLefthook(opts.cwd)) {
    return uninstallLefthookManaged(opts.cwd);
  }
  return uninstallGitHooksShim(opts.cwd);
}

function detectOutdated(content: string): {
  outdated: boolean;
  installed_version?: string;
} {
  const loc = findManagedSection(content);
  if (!loc.found || !loc.beginLine) return { outdated: false };
  const version = parseHookVersion(loc.beginLine);
  if (version === undefined) {
    // Legacy unversioned block — flag outdated so re-install rewrites it
    // with the current marker shape.
    return { outdated: true };
  }
  return {
    outdated: version !== LINEAR_HOOKS_VERSION,
    installed_version: version,
  };
}

function checkLefthookInstalled(cwd: string): HooksInstallStatus {
  const filePath = lefthookLocalPath(cwd);
  let installed = false;
  let outdated = false;
  let installed_version: string | undefined;
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf8");
    const loc = findManagedSection(content);
    installed = loc.found;
    if (installed) {
      const meta = detectOutdated(content);
      outdated = meta.outdated;
      installed_version = meta.installed_version;
    }
  }
  return {
    recipe: "hooks",
    target: "lefthook",
    path: filePath,
    installed,
    outdated,
    installed_version,
    current_version: LINEAR_HOOKS_VERSION,
    lefthook_present: true,
    hook_names: WIRED_HOOKS,
  };
}

function checkGitHooksInstalled(cwd: string): HooksInstallStatus {
  let installed = false;
  let outdated = false;
  let installed_version: string | undefined;
  let lastPath = "";
  for (const hookName of WIRED_HOOKS) {
    const hookPath = gitHookPath(cwd, hookName);
    lastPath = hookPath;
    if (!fs.existsSync(hookPath)) continue;
    const content = fs.readFileSync(hookPath, "utf8");
    if (findManagedSection(content).found) {
      installed = true;
      const meta = detectOutdated(content);
      // Any outdated hook flags the whole install as outdated; first match
      // wins for the surfaced version string.
      if (meta.outdated) outdated = true;
      if (installed_version === undefined) {
        installed_version = meta.installed_version;
      }
    }
  }
  return {
    recipe: "hooks",
    target: "git-hooks",
    path: lastPath,
    installed,
    outdated,
    installed_version,
    current_version: LINEAR_HOOKS_VERSION,
    lefthook_present: false,
    hook_names: WIRED_HOOKS,
  };
}

export function checkHooksInstalled(opts: { cwd: string }): HooksInstallStatus {
  if (hasLefthook(opts.cwd)) {
    return checkLefthookInstalled(opts.cwd);
  }
  return checkGitHooksInstalled(opts.cwd);
}
