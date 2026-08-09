import { findLocalConfigPath, getConfig, setConfig } from "./config-store.js";
import { deriveScopeLabel } from "./git-remote.js";

/**
 * Tracks whether we've already attempted the per-process bootstrap so a
 * long-lived REPL or chained subcommand invocation doesn't re-derive and
 * re-warn on every `createContext()` call.
 *
 * The cache is intentionally module-scoped (not exported) so callers can't
 * accidentally reset it. Tests that need a fresh attempt re-import the
 * module via `vi.resetModules()`.
 */
let attempted = false;

/**
 * Test-only hook used by `tests/unit/common/scope-bootstrap.test.ts` to
 * verify the one-shot behavior across multiple synthetic invocations
 * without paying the ESM module-reset overhead.
 */
export function _resetScopeBootstrapForTests(): void {
  attempted = false;
}

export interface ScopeBootstrapResult {
  performed: boolean;
  label?: string;
  reason?:
    | "already-attempted"
    | "no-git-repo"
    | "env-disabled"
    | "already-configured"
    | "no-label-derivable";
}

/**
 * Silent first-run initializer. When run inside a git repository with no
 * existing scope configuration, derives a `git:<name>` label from the
 * git remote (or toplevel / cwd fallback) and writes it to the per-repo
 * `.linear/config.json`. Skips itself entirely in the following cases:
 *
 *   - `LINEAR_NO_AUTO_INIT` is set (any non-empty value).
 *   - `process.cwd()` is not inside a git repo (no toplevel resolvable).
 *   - `scope.label` already exists in the local OR global layer.
 *   - The label-derivation chain returns null (e.g. cwd is `/`).
 *
 * Label *creation in Linear* is deliberately deferred to the first write
 * command — reading against a non-existent label simply returns zero
 * results, which is cheap and pollution-free. The implicit-init only
 * touches the local file.
 *
 * Emits a one-line stderr notice on success so the user knows where the
 * file came from and can edit it.
 */
export function ensureRepoScope(
  env: NodeJS.ProcessEnv = process.env,
  stderr: NodeJS.WritableStream = process.stderr,
): ScopeBootstrapResult {
  if (attempted) return { performed: false, reason: "already-attempted" };
  attempted = true;

  if (env.LINEAR_NO_AUTO_INIT && env.LINEAR_NO_AUTO_INIT !== "") {
    return { performed: false, reason: "env-disabled" };
  }
  if (!findLocalConfigPath()) {
    return { performed: false, reason: "no-git-repo" };
  }
  const local = getConfig("scope.label", env, { layer: "local" });
  if (local.found) {
    return { performed: false, reason: "already-configured" };
  }
  const global = getConfig("scope.label", env, { layer: "global" });
  if (global.found) {
    return { performed: false, reason: "already-configured" };
  }

  const derived = deriveScopeLabel();
  if (!derived) {
    return { performed: false, reason: "no-label-derivable" };
  }

  setConfig("scope.label", derived.label, { layer: "local" });
  stderr.write(
    `linear: initialized .linear/config.json for this repo (scope: ${derived.label})\n`,
  );
  return { performed: true, label: derived.label };
}
