import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthenticationError, DEFAULT_REMEDIATION } from "./errors.js";
import { getStoredToken } from "./token-storage.js";

export interface CommandOptions {
  apiToken?: string;
  /**
   * Global root flag. When truthy, commands that render text by default
   * fall back to the JSON envelope via `outputResult`. Parsed by Commander
   * on the root program; read via `getRootOpts(command).json`.
   *
   * Values:
   *   `true` / `"auto"` (bare `--json`) → pretty, or compact under agent mode
   *   `"pretty"` (explicit)             → pretty (2-space indent, multi-line)
   *   `"compact"`                       → JSON.stringify with no spaces (one line)
   *   `undefined`                       → text path (default)
   *
   * Bare `--json` arrives as boolean `true` or the `"auto"` sentinel (the
   * argv rewriter in commands/aliases.ts substitutes it so Commander does
   * not eat the next positional). `resolveJsonMode` in `common/output.ts`
   * normalizes all of these — consulting agent mode for the bare case —
   * into the `"pretty" | "compact" | null` triplet that emitters consume.
   */
  json?: boolean | string;
  /**
   * Resolved agent-mode flag (lin-g1hy). Not a CLI flag — `getRootOpts`
   * stamps it from `resolveAgentMode()` so downstream emitters and limit
   * resolution can trim output for agent callers. `undefined` in raw
   * Commander opts; always set after `getRootOpts`.
   */
  agentMode?: boolean;
  /**
   * Global root flag `--compact`: emit the JSON envelope on a single line.
   * Implies `--json` (there is nothing to compact on the text path) and wins
   * over an explicit `--json=pretty`. Equivalent to `--json=compact`, kept as
   * its own flag because it composes with `--fields` without re-stating the
   * mode.
   */
  compact?: boolean;
  /**
   * Global root flag `--fields <list>`: dot-paths to keep in the JSON
   * envelope, already split by `parseFieldsList` (e.g.
   * `["nodes.identifier", "nodes.state.name"]`). Implies `--json`. Paths
   * address the envelope as emitted, so list verbs narrow through `nodes.`.
   */
  fields?: string[];
}

export type TokenSource = "flag" | "env" | "stored" | "legacy";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

/** @throws AuthenticationError (kind "missing") if no token found in any source */
export function resolveApiToken(options: CommandOptions): ResolvedToken {
  if (options.apiToken) {
    return { token: options.apiToken, source: "flag" };
  }

  if (process.env.LINEAR_API_TOKEN) {
    return { token: process.env.LINEAR_API_TOKEN, source: "env" };
  }

  const storedToken = getStoredToken();
  if (storedToken) {
    return { token: storedToken, source: "stored" };
  }

  const legacyFile = path.join(os.homedir(), ".linear_api_token");
  if (fs.existsSync(legacyFile)) {
    console.error(
      "Warning: ~/.linear_api_token is deprecated. Run 'linear auth' to migrate.",
    );
    return {
      token: fs.readFileSync(legacyFile, "utf8").trim(),
      source: "legacy",
    };
  }

  throw new AuthenticationError(
    "No API token found in any source (--api-token, LINEAR_API_TOKEN, ~/linear/token).",
    {
      kind: "missing",
      message: "No API token found.",
      remediation: DEFAULT_REMEDIATION,
    },
  );
}

export function getApiToken(options: CommandOptions): string {
  const { token } = resolveApiToken(options);
  return token;
}
