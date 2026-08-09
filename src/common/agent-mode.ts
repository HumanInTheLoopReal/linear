/**
 * Agent-mode detection + token-economy defaults (lin-g1hy —
 * "output-token-economy" audit).
 *
 * When an agent (rather than a human at a terminal) drives the CLI, the
 * cost that matters is *output tokens the agent has to read back*. Agent
 * mode trims that bill in two ways without changing any explicit request:
 *
 *   1. Lower default page size — list/search/next cap at {@link AGENT_LIST_LIMIT}
 *      instead of 50/100 when the caller didn't pass `--limit`.
 *   2. Compact JSON — a bare `--json` emits the single-line payload
 *      instead of the 2-space-indented one (see resolveJsonMode).
 *
 * Both are *defaults*, not caps: an agent that wants the full firehose
 * passes `--limit 100` (or `--json=pretty`) and the explicit value wins.
 * The `meta.agent_mode` flag on paginated verbs tells the agent the trim
 * happened, so it knows it can opt back in.
 *
 * Detection precedence (so a human inside a Claude Code terminal can opt
 * out):
 *
 *   LINEAR_AGENT_MODE = 0 / false   → OFF  (explicit opt-out wins)
 *   LINEAR_AGENT_MODE = anything else non-empty → ON  (explicit opt-in)
 *   CLAUDECODE / CLAUDE_CODE set    → ON   (auto-detect the agent host)
 *   otherwise                       → OFF
 */

/** Default page size for list/search/next when agent mode trims the default. */
export const AGENT_LIST_LIMIT = 20;

/**
 * Resolve whether the CLI is being driven by an agent. Pure over `env`
 * (injectable for tests); production reads `process.env`.
 */
export function resolveAgentMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicit = env.LINEAR_AGENT_MODE;
  if (explicit !== undefined && explicit !== "") {
    return explicit !== "0" && explicit.toLowerCase() !== "false";
  }
  return Boolean(env.CLAUDECODE || env.CLAUDE_CODE);
}

/**
 * Pick the effective page size for a list-like verb. Honors an explicit
 * `--limit` (Commander source "cli"/"env") verbatim; only substitutes the
 * lower agent default when the value came from the command's static
 * default AND agent mode is on.
 *
 * @param parsedLimit the already-parsed `--limit` value (humanDefault when unset)
 * @param source `command.getOptionValueSource("limit")`
 */
export function resolveAgentLimit(
  parsedLimit: number,
  source: string | undefined,
  agentMode: boolean,
  agentDefault: number = AGENT_LIST_LIMIT,
): number {
  const userSet = source === "cli" || source === "env";
  if (!userSet && agentMode) return agentDefault;
  return parsedLimit;
}
