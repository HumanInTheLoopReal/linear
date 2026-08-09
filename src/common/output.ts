import {
  AUTH_ERROR_CODE,
  AuthenticationError,
  exitCodeFor,
  hintFor,
  invalidParameterError,
  isRecoverable,
} from "./errors.js";

export type JsonMode = "pretty" | "compact";

/**
 * Normalize the global `--json` flag's raw Commander value into a concrete
 * mode (or `null` for the text path). Bare `--json` parses as `true`, named
 * forms as `"pretty"` / `"compact"`. Unrecognized strings fall back to
 * pretty so we never silently swallow user input.
 *
 * Agent-mode default (lin-g1hy): a *bare* `--json` emits compact when
 * `agentMode` is on — the agent saves output tokens without asking. An
 * explicit `--json=pretty` always stays pretty; an explicit
 * `--json=compact` always stays compact. Only the unqualified default flips.
 *
 * "Bare" reaches here two ways: as boolean `true` (Commander's optional-arg
 * default) or as the `"auto"` sentinel that the argv rewriter substitutes
 * for a bare `--json` to stop Commander eating the next positional (see
 * `normalizeJsonOption` in commands/aliases.ts). Both mean "no mode chosen".
 */
export function resolveJsonMode(
  value: boolean | string | undefined,
  agentMode = false,
): JsonMode | null {
  if (value === undefined || value === false) return null;
  if (value === "compact") return "compact";
  if (value === "pretty") return "pretty";
  if (value === true || value === "auto") {
    return agentMode ? "compact" : "pretty";
  }
  return "pretty";
}

/**
 * Split the `--fields` value into dot-paths: `"id, state.name ,, x"` →
 * `["id", "state.name", "x"]`. Empty segments are dropped so a trailing
 * comma is not an error.
 */
export function parseFieldsList(value: string): string[] {
  return value
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * Project `value` down to the given dot-path segments, keeping nested shape
 * and mapping across arrays mid-path. A path that stops at a subtree keeps
 * that whole subtree; a missing key is skipped rather than emitted as null.
 *
 * Only own properties are matched, so `--fields constructor` (or any other
 * inherited member) picks nothing, and results are written with
 * `Object.defineProperty` so `--fields __proto__` writes a plain key instead
 * of invoking the prototype setter.
 */
export function pickFields(value: unknown, paths: string[][]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => pickFields(item, paths));
  }
  if (value === null || typeof value !== "object") {
    // The path descends past a scalar — nothing left to pick.
    return value;
  }
  const source = value as Record<string, unknown>;
  const tailsByHead = new Map<string, string[][]>();
  // A path that terminates at a key claims its whole subtree, so it has to
  // outrank longer siblings (`nodes` beats `nodes.identifier`) in either order.
  const wholeSubtree = new Set<string>();
  for (const [head, ...tail] of paths) {
    if (head === undefined) continue;
    const tails = tailsByHead.get(head) ?? [];
    if (tail.length > 0) tails.push(tail);
    else wholeSubtree.add(head);
    tailsByHead.set(head, tails);
  }

  const projected: Record<string, unknown> = {};
  for (const [head, tails] of tailsByHead) {
    if (!Object.hasOwn(source, head)) continue;
    const keepWhole = wholeSubtree.has(head) || tails.length === 0;
    Object.defineProperty(projected, head, {
      value: keepWhole ? source[head] : pickFields(source[head], tails),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return projected;
}

/**
 * Emit the JSON envelope. Pretty (default) matches the legacy multi-line
 * `JSON.stringify(data, null, 2)` shape; compact uses bare
 * `JSON.stringify(data)` for slimmer agent contexts (typically 30–50%
 * fewer bytes on a Linear-shaped payload).
 *
 * `fields` narrows the payload to the named dot-paths before serializing.
 * Paths address the envelope as emitted, so a list verb narrows through its
 * container: `--fields nodes.identifier`, not `--fields identifier`.
 */
export function outputSuccess(
  data: unknown,
  mode: JsonMode = "pretty",
  fields?: string[],
): void {
  const shaped =
    fields && fields.length > 0
      ? pickFields(
          data,
          fields.map((path) => path.split(".")),
        )
      : data;
  if (mode === "compact") {
    console.log(JSON.stringify(shaped));
    return;
  }
  console.log(JSON.stringify(shaped, null, 2));
}

/**
 * Text-default dispatcher. When the global `--json` flag is set on the root
 * program (reachable via `getRootOpts(command)`), delegate to `outputSuccess`
 * so agents keep the JSON envelope they've always had. Otherwise render the
 * supplied formatter to stdout (appending a trailing newline if missing).
 *
 * Per-command formatters live inline in `src/commands/*.ts` above their
 * `.action()` block; shared helpers are in `src/commands/_format.ts`.
 */
export interface OutputOptions {
  json?: boolean | string;
  agentMode?: boolean;
  compact?: boolean;
  fields?: string[];
}

/**
 * Effective JSON mode for a set of root options — the single source of truth
 * for how `--json`, `--compact` and `--fields` interact. Prefer this over
 * calling `resolveJsonMode` directly so a command that emits JSON itself
 * honours the same rules as `outputResult`.
 *
 * `--compact` and `--fields` only shape the JSON envelope, so on this
 * text-default CLI either one implies `--json` — otherwise the flag would
 * silently do nothing. `--compact` also outranks an explicit `--json=pretty`.
 */
export function resolveOutputMode(opts: OutputOptions): JsonMode | null {
  const requested = resolveJsonMode(opts.json, opts.agentMode ?? false);
  if (opts.compact) return "compact";
  if (requested) return requested;
  return (opts.fields?.length ?? 0) > 0 ? "pretty" : null;
}

export function outputResult<T>(
  data: T,
  formatter: (data: T) => string,
  opts: OutputOptions = {},
): void {
  const mode = resolveOutputMode(opts);
  if (mode) {
    outputSuccess(data, mode, opts.fields);
    return;
  }
  const text = formatter(data);
  process.stdout.write(text);
  if (!text.endsWith("\n")) process.stdout.write("\n");
}

/**
 * Emit a bare identifier line to stdout. Used by `issues q` so that
 * `ID=$(linear issues q "title")` captures only the new identifier:
 * stdout must be ONLY the issue identifier (no JSON, no decoration),
 * and stderr stays clean on the success path.
 */
export function outputIdOnly(id: string): void {
  process.stdout.write(`${id}\n`);
}

export function outputError(error: Error): void {
  const hint = hintFor(error);
  console.error(
    JSON.stringify(
      hint ? { error: error.message, hint } : { error: error.message },
      null,
      2,
    ),
  );
  process.exit(exitCodeFor(error));
}

export function outputAuthError(error: AuthenticationError): void {
  console.error(
    JSON.stringify(
      {
        error: "AUTHENTICATION_REQUIRED",
        message: error.message,
        details: error.details,
        action: "USER_ACTION_REQUIRED",
        // Concrete, non-interactive steps the agent can take. `instruction` is
        // derived from the same list (the default contains `linear auth login`,
        // preserving the legacy "linear auth" substring contract) so callers
        // that only read `instruction` still get actionable guidance.
        remediation: error.remediation,
        instruction: error.remediation.join("\n"),
        exit_code: AUTH_ERROR_CODE,
      },
      null,
      2,
    ),
  );
  process.exit(AUTH_ERROR_CODE);
}

export function parseLimit(value: string): number {
  const limit = parseInt(value, 10);
  if (Number.isNaN(limit) || limit < 1) {
    throw invalidParameterError("--limit", "must be a positive integer");
  }
  return limit;
}

export function handleCommand(
  asyncFn: (...args: unknown[]) => Promise<void>,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    try {
      await asyncFn(...args);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        outputAuthError(error);
        return;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      // Recoverable warnings (warnError) print to stderr and DO NOT exit, so a
      // headless agent is never blocked by an auxiliary/optional failure.
      if (isRecoverable(err)) {
        const hint = hintFor(err);
        console.error(
          hint
            ? `Warning: ${err.message} (${hint})`
            : `Warning: ${err.message}`,
        );
        return;
      }
      outputError(err);
    }
  };
}
