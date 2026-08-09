/**
 * Agent-safe confirmation guard for destructive / bulk mutations
 * (lin-iowg — standardize --dry-run/--force across mutating commands).
 *
 * The contract every guarded mutation follows:
 *
 *   --force / --yes   → skip the guard, always proceed        ("forced")
 *   TTY human         → optional Y/n prompt (default: yes)     ("confirmed"/"declined")
 *   non-interactive   → PROCEED by default                     ("non-interactive")
 *
 * The critical invariant is the last line. An agent driving the CLI in a
 * non-TTY context (CI, piped stdin, `LINEAR_NON_INTERACTIVE`, `--quiet`)
 * must NEVER be blocked on a prompt it cannot answer. The user already
 * typed the mutating verb (`--fix`, `pour`, …); a non-interactive run
 * treats that as consent. Humans on a TTY get one last Y/n as a courtesy.
 *
 * Why proceed-by-default is safe here: linear's guarded mutations are
 * reversible state transitions (anything they close you can `reopen`).
 * Reserve force-required for genuinely destructive, irreversible verbs;
 * this helper is for the reversible class.
 *
 * Reuses the same interactivity precedence (flag > env > CI > TTY) as the
 * `init` wizard via `resolveInteractiveMode`, so one rule governs every
 * interactive surface in the CLI.
 */

import {
  createPromptIO,
  type PromptIO,
  promptYesNo,
  resolveInteractiveMode,
} from "./prompt.js";

/**
 * Outcome of a confirmation guard. Only `"declined"` means "do not
 * mutate"; the other three all mean "go ahead" (see `proceedConfirmed`).
 * The label is returned (rather than a bare boolean) so callers can log
 * *why* they proceeded — forced vs. agent-default vs. human-confirmed.
 */
export type ConfirmDecision =
  | "forced"
  | "non-interactive"
  | "confirmed"
  | "declined";

export interface ConfirmGuardOptions {
  /** `--force` OR `--yes` — skip the prompt entirely and proceed. */
  force?: boolean;
  /** `--non-interactive` flag (forces the agent-safe default path). */
  nonInteractive?: boolean;
  /** `--quiet` / `-q` flag (implies non-interactive). */
  quiet?: boolean;
  /** Inject env for tests; production reads `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Inject TTY state for tests; production uses `process.stdin.isTTY`. */
  isTTY?: boolean;
  /** Inject a prompt IO for tests; production builds a readline one. */
  io?: PromptIO;
  /** Default answer for the Y/n prompt when a human just hits Enter. */
  defaultYes?: boolean;
}

/**
 * Decide whether a guarded mutation should proceed. See the module
 * docstring for the full contract. Never throws on a non-TTY context —
 * that is the whole point.
 */
export async function confirmGuard(
  question: string,
  opts: ConfirmGuardOptions = {},
): Promise<ConfirmDecision> {
  if (opts.force) return "forced";

  const interactive = resolveInteractiveMode({
    nonInteractive: opts.nonInteractive,
    quiet: opts.quiet,
    env: opts.env,
    isTTY: opts.isTTY,
  });
  // Agent-safe default: a non-interactive caller proceeds without a prompt.
  if (!interactive) return "non-interactive";

  const io = opts.io ?? createPromptIO();
  try {
    const yes = await promptYesNo(io, question, opts.defaultYes ?? true);
    return yes ? "confirmed" : "declined";
  } finally {
    // Only close IO we created; an injected IO is the caller's to manage.
    if (!opts.io) io.close();
  }
}

/** True when the decision means "go ahead and mutate". */
export function proceedConfirmed(decision: ConfirmDecision): boolean {
  return decision !== "declined";
}
