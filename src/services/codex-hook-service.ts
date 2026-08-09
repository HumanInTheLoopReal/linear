/**
 * Internal service layer for the hidden `linear codex-hook` command.
 *
 * Manages:
 *   - subprocess execution of `linear prime` (with a 30s timeout),
 *   - the session-keyed refresh marker file under the user cache dir,
 *   - the four lifecycle event handlers (SessionStart / PreCompact /
 *     PostCompact / UserPromptSubmit).
 *
 * No GraphQL / resolver layer is involved — codex-hook is stateless and
 * session-keyed, re-invoking the CLI's own `prime` verb as a child process.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import {
  CODEX_HOOK_POST_COMPACT,
  CODEX_HOOK_PRE_COMPACT,
  CODEX_HOOK_SESSION_START,
  CODEX_HOOK_USER_PROMPT_SUBMIT,
  type CodexHookInput,
  type CodexHookResponse,
} from "../common/codex-hook-types.js";

/** Hard deadline for a single `linear prime` invocation. */
export const CODEX_HOOK_PRIME_TIMEOUT_MS = 30_000;

/**
 * Execute `linear prime` (or `linear prime --memories-only`) as a child
 * process and return its combined stdout+stderr. Re-invokes the same CLI
 * binary via `process.execPath` + the entry script (`process.argv[1]`) so the
 * running `linear` is the one that primes.
 *
 * Exported as a mutable binding so tests can stub it.
 */
export let codexHookExecPrime = async (
  memoriesOnly: boolean,
): Promise<string> => {
  const args = [process.argv[1], "prime"];
  if (memoriesOnly) args.push("--memories-only");
  return await new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      { timeout: CODEX_HOOK_PRIME_TIMEOUT_MS, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const detail = `${stdout}${stderr}`.trim();
          reject(
            new Error(
              `linear prime${memoriesOnly ? " --memories-only" : ""}: ${error.message}${
                detail ? `: ${detail}` : ""
              }`,
            ),
          );
          return;
        }
        resolve(`${stdout}${stderr}`);
      },
    );
  });
};

/** Test-only seam to swap the prime executor. */
export function setCodexHookExecPrime(
  fn: (memoriesOnly: boolean) => Promise<string>,
): () => void {
  const original = codexHookExecPrime;
  codexHookExecPrime = fn;
  return () => {
    codexHookExecPrime = original;
  };
}

/**
 * Base directory for refresh markers. Prefers `~/.cache/linear/codex-hooks`
 * (the platform user-cache dir), falling back to `<tmpdir>/linear-codex-hooks`
 * when the home/cache dir cannot be resolved.
 */
export function codexHookMarkerBaseDir(): string {
  const cacheDir = userCacheDir();
  if (cacheDir) {
    return path.join(cacheDir, "linear", "codex-hooks");
  }
  return path.join(os.tmpdir(), "linear-codex-hooks");
}

/**
 * Resolve the platform's per-user cache directory:
 *   - darwin → ~/Library/Caches
 *   - win32  → %LocalAppData%
 *   - else   → $XDG_CACHE_HOME or ~/.cache
 * Returns null when the home directory cannot be resolved.
 */
function userCacheDir(): string | null {
  let home = "";
  try {
    home = os.homedir();
  } catch {
    home = "";
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData && localAppData.length > 0) return localAppData;
    if (home) return path.join(home, "AppData", "Local");
    return null;
  }
  if (process.platform === "darwin") {
    if (!home) return null;
    return path.join(home, "Library", "Caches");
  }
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg && xdg.length > 0) return xdg;
  if (home) return path.join(home, ".cache");
  return null;
}

/**
 * Deterministic per-session marker path. Hashes `session_id \x00 clean(cwd)`
 * with SHA-256, so the same session + cwd always resolve to the same marker
 * file. Missing fields default to "unknown-session" / "unknown-workspace".
 */
export function codexHookRefreshMarkerPath(input: CodexHookInput): string {
  const sessionId =
    input.session_id && input.session_id.length > 0
      ? input.session_id
      : "unknown-session";
  const workspace =
    input.cwd && input.cwd.length > 0 ? input.cwd : "unknown-workspace";
  const sum = createHash("sha256")
    .update(`${sessionId}\x00${path.posix.normalize(workspace)}`)
    .digest("hex");
  return path.join(codexHookMarkerBaseDir(), `${sum}.refresh`);
}

/** Serialize + write a response envelope to the given stream (newline-terminated). */
function writeResponse(stdout: Writable, response: CodexHookResponse): void {
  stdout.write(`${JSON.stringify(response)}\n`);
}

/**
 * SessionStart: run full `linear prime` and inject the output as
 * additionalContext. On error or empty output, emit nothing: a failed prime
 * at session start is non-fatal — Codex just gets no context.
 */
export async function codexHookInjectPrime(
  stdout: Writable,
  event: string,
): Promise<void> {
  let out: string;
  try {
    out = await codexHookExecPrime(false);
  } catch {
    return;
  }
  if (out.trim() === "") return;
  writeResponse(stdout, {
    continue: true,
    hookSpecificOutput: { hookEventName: event, additionalContext: out },
  });
}

/**
 * PreCompact: validate memories with `linear prime --memories-only`. On
 * failure emit a systemMessage warning; on success emit nothing.
 */
export async function codexHookPreCompactCheck(
  stdout: Writable,
): Promise<void> {
  try {
    await codexHookExecPrime(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeResponse(stdout, {
      continue: true,
      systemMessage: `Linear context check failed before compaction: ${message}`,
    });
  }
}

/**
 * PostCompact: write the session-keyed refresh marker so the next
 * UserPromptSubmit knows to re-prime. Marker dir is created mode 0700, file
 * mode 0600 (user-private). A mkdir failure is swallowed (best-effort).
 */
export function codexHookMarkNeedsRefresh(input: CodexHookInput): void {
  const markerPath = codexHookRefreshMarkerPath(input);
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true, mode: 0o700 });
  } catch {
    return;
  }
  fs.writeFileSync(markerPath, "1\n", { mode: 0o600 });
}

/**
 * UserPromptSubmit: if the refresh marker exists, re-run full `linear prime`,
 * remove the marker, and inject the output (when non-empty). No marker = no
 * output. The marker is removed only on success; on a prime failure we emit a
 * systemMessage warning and leave the marker in place so a later prompt retries.
 */
export async function codexHookMaybeRefresh(
  input: CodexHookInput,
  stdout: Writable,
): Promise<void> {
  const markerPath = codexHookRefreshMarkerPath(input);
  if (!fs.existsSync(markerPath)) return;
  let out: string;
  try {
    out = await codexHookExecPrime(false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeResponse(stdout, {
      continue: true,
      systemMessage: `Linear context refresh after compaction failed: ${message}`,
    });
    return;
  }
  try {
    fs.unlinkSync(markerPath);
  } catch {
    // Best-effort cleanup; ignore removal failures.
  }
  if (out.trim() === "") return;
  writeResponse(stdout, {
    continue: true,
    hookSpecificOutput: {
      hookEventName: CODEX_HOOK_USER_PROMPT_SUBMIT,
      additionalContext: out,
    },
  });
}

/**
 * Dispatch a single codex-hook event. Reads the parsed input envelope, lets
 * `hook_event_name` override the positional event arg, then routes to the
 * matching handler. Throws on an unsupported event.
 */
export async function runCodexHook(
  event: string,
  input: CodexHookInput,
  stdout: Writable,
): Promise<void> {
  const resolved =
    input.hook_event_name && input.hook_event_name.length > 0
      ? input.hook_event_name
      : event;

  switch (resolved) {
    case CODEX_HOOK_SESSION_START:
      await codexHookInjectPrime(stdout, CODEX_HOOK_SESSION_START);
      return;
    case CODEX_HOOK_PRE_COMPACT:
      await codexHookPreCompactCheck(stdout);
      return;
    case CODEX_HOOK_POST_COMPACT:
      codexHookMarkNeedsRefresh(input);
      return;
    case CODEX_HOOK_USER_PROMPT_SUBMIT:
      await codexHookMaybeRefresh(input, stdout);
      return;
    default:
      throw new Error(`unsupported Codex hook event "${resolved}"`);
  }
}
