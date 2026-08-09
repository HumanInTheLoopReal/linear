/**
 * Two-tier error model for the Linear CLI.
 *
 * Errors fall into two control-flow tiers:
 *
 *   - FATAL: unrecoverable. The command cannot complete its core purpose; the
 *     process exits with a non-zero code (see the exit-code map below).
 *   - WARN: recoverable. An auxiliary/optional step failed; the message is
 *     printed to stderr and the command CONTINUES. A warning must NEVER block
 *     a headless agent — this is the agent-safety invariant.
 *
 * See `docs/ERROR_HANDLING.md` for the taxonomy and decision tree.
 */

/**
 * Exit-code map. Documented in `docs/ERROR_HANDLING.md`. Backward-compatible:
 * the default fatal code stays 1 unless a typed error specifies otherwise.
 */
export const EXIT_GENERIC = 1;
export const EXIT_VALIDATION = 2;
/**
 * Optimistic-concurrency conflict: the server copy changed after the
 * caller's baseline was taken (`issues push` after an out-of-band edit).
 * A distinct code so agents can branch on "re-pull and retry" without
 * parsing the message.
 */
export const EXIT_CONFLICT = 3;
/** Auth exit code, preserved from the original `outputAuthError` contract. */
export const AUTH_ERROR_CODE = 42;

/**
 * Base class for CLI errors that carry control-flow metadata: the exit code to
 * use when fatal, an optional actionable hint, and a `recoverable` marker that
 * downgrades the error to a non-exiting warning.
 *
 * Plain `Error` instances thrown by command code keep working — they are
 * treated as generic fatal errors (exit 1, no hint).
 */
export class LinearError extends Error {
  /** Process exit code when this error is fatal. */
  readonly exitCode: number;
  /** Optional actionable suggestion, surfaced as `Hint: <hint>`. */
  readonly hint?: string;
  /**
   * When true, the error is a recoverable warning: it is printed to stderr and
   * the command continues without exiting. Defaults to false (fatal).
   */
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: {
      exitCode?: number;
      hint?: string;
      recoverable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "LinearError";
    this.exitCode = options.exitCode ?? EXIT_GENERIC;
    this.hint = options.hint;
    this.recoverable = options.recoverable ?? false;
  }
}

/**
 * Construct a fatal (unrecoverable) error. The process will exit non-zero.
 * Pass `exitCode` for typed semantics (e.g. `EXIT_VALIDATION`) and `hint` for
 * an actionable suggestion.
 */
export function fatalError(
  message: string,
  options: { exitCode?: number; hint?: string } = {},
): LinearError {
  return new LinearError(message, {
    exitCode: options.exitCode ?? EXIT_GENERIC,
    hint: options.hint,
    recoverable: false,
  });
}

/**
 * Construct a recoverable warning. When thrown through `handleCommand` it is
 * printed to stderr and the command CONTINUES (no exit).
 * AGENT-SAFE: a warning must never block a headless agent.
 */
export function warnError(message: string, hint?: string): LinearError {
  return new LinearError(message, { hint, recoverable: true });
}

/** True when an error opts out of the exit path (recoverable warning). */
export function isRecoverable(error: unknown): boolean {
  return error instanceof LinearError && error.recoverable;
}

/** Read the typed exit code off an error, defaulting to generic fatal (1). */
export function exitCodeFor(error: unknown): number {
  if (error instanceof LinearError) return error.exitCode;
  return EXIT_GENERIC;
}

/** Read the optional hint off an error, if any. */
export function hintFor(error: unknown): string | undefined {
  if (error instanceof LinearError) return error.hint;
  return undefined;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}

export function notFoundError(
  entityType: string,
  identifier: string,
  context?: string,
): NotFoundError {
  const contextStr = context ? ` ${context}` : "";
  return new NotFoundError(
    `${entityType} "${identifier}"${contextStr} not found`,
  );
}

export function multipleMatchesError(
  entityType: string,
  identifier: string,
  matches: string[],
  disambiguation: string,
): Error {
  const matchList = matches.join(", ");
  return new Error(
    `Multiple ${entityType}s found matching "${identifier}". ` +
      `Candidates: ${matchList}. ` +
      `Please ${disambiguation}.`,
  );
}

/**
 * Validation failures are fatal and exit 1 (user-input validation).
 * Bad input must exit 1 — not a separate code.
 *
 * `EXIT_VALIDATION` (2) is retained for the single opt-in case of a
 * mutually-exclusive flag conflict; the generic validation helpers below
 * deliberately do NOT use it.
 */
export function invalidParameterError(
  parameter: string,
  reason: string,
): LinearError {
  return fatalError(`Invalid ${parameter}: ${reason}`);
}

export function requiresParameterError(
  flag: string,
  requiredFlag: string,
): LinearError {
  return fatalError(`${flag} requires ${requiredFlag} to be specified`);
}

/**
 * Why authentication failed, from the agent's point of view:
 *   - "missing": no token was supplied in any source.
 *   - "invalid": a token was supplied but the API rejected it (401) or it is
 *     otherwise unusable/expired.
 * Both share the same remediation because the agent's next move is identical:
 * supply a working token non-interactively.
 */
export type AuthErrorKind = "missing" | "invalid";

/**
 * Concrete, non-interactive steps an agent can take to supply a token. This is
 * the headless-safe replacement for "Run 'linear auth'" (which spawns an
 * interactive prompt). Exported so `common/auth.ts` reuses the exact same list
 * for the missing-token case without re-declaring it.
 */
export const DEFAULT_REMEDIATION: readonly string[] = [
  "Set LINEAR_API_TOKEN=<token> in the environment, or pass --api-token <token>.",
  'Persist once: echo "$TOKEN" | linear auth login  (encrypts to ~/linear/token)',
  "Create a token: https://linear.app/settings/account/security/api-keys/new",
];

export class AuthenticationError extends Error {
  readonly details: string;
  readonly kind: AuthErrorKind;
  readonly remediation: readonly string[];

  constructor(
    details?: string,
    opts?: {
      kind?: AuthErrorKind;
      message?: string;
      remediation?: readonly string[];
    },
  ) {
    super(opts?.message ?? "Linear API authentication failed.");
    this.name = "AuthenticationError";
    this.details = details ?? "Your stored token is invalid or expired.";
    this.kind = opts?.kind ?? "invalid";
    this.remediation = opts?.remediation ?? DEFAULT_REMEDIATION;
  }
}

const AUTH_ERROR_PATTERNS: ReadonlyArray<string> = [
  "authentication required",
  "unauthorized",
];

export function isAuthError(error: unknown): boolean {
  if (error instanceof AuthenticationError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase().trim();
    return AUTH_ERROR_PATTERNS.some((pattern) => msg === pattern);
  }
  return false;
}
