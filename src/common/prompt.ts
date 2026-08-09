/**
 * Tiny terminal-prompt helper for interactive verbs (`linear init` wizard).
 *
 * Kept dependency-free on purpose — the wizard reads from stdin with no
 * curses/menus. Prompts are:
 *
 *   - **Defaultable**: each call carries a default; hitting Enter accepts.
 *   - **Cancellable**: Ctrl-C / EOF on stdin throws PromptCanceled, which
 *     the caller turns into a "Setup canceled." exit message.
 *   - **Skippable in non-interactive mode**: when `interactive: false`,
 *     every prompt resolves to its default without touching stdin.
 *   - **TTY-only by construction**: when `interactive: true` the caller
 *     already proved stdin is a TTY (see resolveInteractiveMode()).
 *
 * Why no `inquirer`/`prompts`/etc.? Bringing in a heavy prompts dep for
 * 3 questions adds 100KB+ to the install footprint of a CLI that's
 * deliberately small. The 70-line shim below covers our needs.
 */

import readline from "node:readline";

export class PromptCanceled extends Error {
  constructor() {
    super("prompt canceled");
    this.name = "PromptCanceled";
  }
}

export interface ResolveInteractiveModeOpts {
  /** `--non-interactive` flag value. */
  nonInteractive?: boolean;
  /** `--quiet` / `-q` flag value (implies non-interactive). */
  quiet?: boolean;
  /** Inject env for tests; production reads `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Inject TTY state for tests; production uses `process.stdin.isTTY`. */
  isTTY?: boolean;
}

/**
 * Resolve whether init runs interactively. Precedence is
 * flag > env > CI > TTY.
 *
 * Returns `true` when prompts should actually be shown.
 */
export function resolveInteractiveMode(
  opts: ResolveInteractiveModeOpts,
): boolean {
  if (opts.nonInteractive || opts.quiet) return false;
  const env = opts.env ?? process.env;
  const liEnv = env.LINEAR_NON_INTERACTIVE;
  if (liEnv !== undefined && liEnv !== "") {
    // Explicit 0/false forces interactive mode.
    if (liEnv === "0" || liEnv === "false") {
      const tty = opts.isTTY ?? Boolean(process.stdin.isTTY);
      return tty;
    }
    return false;
  }
  const ci = env.CI;
  if (ci === "true" || ci === "1") return false;
  const tty = opts.isTTY ?? Boolean(process.stdin.isTTY);
  return tty;
}

/**
 * Minimal stdin/stdout adapter — injectable for tests. Production uses
 * `process.stdin` / `process.stdout`. The adapter only needs `write` for
 * the prompt text and an async `question` (a la readline) for the reply.
 */
export interface PromptIO {
  question: (prompt: string) => Promise<string>;
  write: (s: string) => void;
  close: () => void;
}

/**
 * Build a real readline-backed prompt IO. Caller MUST `close()` when
 * done (typically wrap calls in a try/finally). EOF / Ctrl-C surface as
 * PromptCanceled rather than `null`.
 */
export function createPromptIO(): PromptIO {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  return {
    question: (prompt: string) =>
      new Promise((resolve, reject) => {
        rl.once("close", () => reject(new PromptCanceled()));
        rl.question(prompt, (answer) => resolve(answer));
      }),
    write: (s) => process.stdout.write(s),
    close: () => rl.close(),
  };
}

/**
 * Ask a free-form string question with a default. Empty answer accepts
 * the default. The prompt shows `[default]` after the question text so
 * the user sees what Enter will pick.
 */
export async function promptString(
  io: PromptIO,
  question: string,
  defaultValue: string,
): Promise<string> {
  const prefix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await io.question(`${question}${prefix}: `);
  const trimmed = answer.trim();
  return trimmed === "" ? defaultValue : trimmed;
}

/**
 * Yes/No prompt. Default is shown via capitalization: "[y/N]" for
 * default-no, "[Y/n]" for default-yes.
 */
export async function promptYesNo(
  io: PromptIO,
  question: string,
  defaultYes: boolean,
): Promise<boolean> {
  const choices = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await io.question(`${question} ${choices}: `);
  const t = answer.trim().toLowerCase();
  if (t === "") return defaultYes;
  return t === "y" || t === "yes";
}

/**
 * Multi-pick from a labeled list. Accepts:
 *   - Empty answer → defaults.
 *   - Comma-separated names ("claude,cursor") → intersect with valid.
 *   - "all" → every choice.
 *   - "none" / "-" / "0" → empty set.
 *
 * Used by the hooks/recipes pick step in init. Unknown names are
 * silently ignored so a typo doesn't abort init.
 */
export async function promptMultiPick(
  io: PromptIO,
  prompt: string,
  choices: readonly string[],
  defaults: readonly string[],
): Promise<string[]> {
  const valid = new Set(choices);
  const defStr = defaults.join(",") || "(none)";
  io.write(`${prompt}\n`);
  for (const c of choices) {
    const mark = defaults.includes(c) ? "[x]" : "[ ]";
    io.write(`  ${mark} ${c}\n`);
  }
  const answer = await io.question(
    `Picks (comma-separated, "all" / "none", default ${defStr}): `,
  );
  const t = answer.trim();
  if (t === "") return [...defaults];
  if (t.toLowerCase() === "all") return [...choices];
  if (t === "none" || t === "-" || t === "0") return [];
  const requested = t
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const out: string[] = [];
  for (const r of requested) {
    if (valid.has(r) && !out.includes(r)) out.push(r);
  }
  return out;
}
