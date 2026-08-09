import type { Command } from "commander";
import type { CodexHookInput } from "../common/codex-hook-types.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { runCodexHook } from "../services/codex-hook-service.js";

/**
 * Hidden `linear codex-hook <event>` command.
 *
 * It is wired into Codex's native hook system by `linear setup codex`
 * (which writes `.codex/hooks.json` + the `[features] hooks = true` flag).
 * Codex pipes a JSON envelope on stdin describing the lifecycle event; this
 * command runs `linear prime` (as a child process) and replies with a hook
 * response envelope on stdout. It is NOT meant to be invoked by humans, hence
 * it is registered hidden.
 *
 * Unlike the read-only Linear verbs, codex-hook does not use `handleCommand`/
 * `outputSuccess` — it speaks the bespoke Codex hook protocol (a single JSON
 * object, or nothing, on the silent success paths) and writes diagnostics to
 * stderr with a non-zero exit on hard failure.
 */

export const CODEX_HOOK_META: DomainMeta = {
  name: "codex-hook",
  summary:
    "internal Codex lifecycle hook (reads JSON stdin, runs linear prime)",
  context: [
    "Hidden command invoked by Codex's native hook system, not by humans.",
    "`linear setup codex` wires it into `.codex/hooks.json` for four events:",
    "SessionStart, PreCompact, PostCompact, UserPromptSubmit.",
    "",
    "Reads a JSON envelope from stdin (session_id, cwd, hook_event_name, ...)",
    "and dispatches by event:",
    "  - SessionStart      → run `linear prime`, inject as additionalContext",
    "  - PreCompact        → validate `linear prime --memories-only`, warn on fail",
    "  - PostCompact       → write a session-keyed refresh marker",
    "  - UserPromptSubmit  → if marker present, re-prime + clear it",
    "",
    "Emits a `{continue, systemMessage?, hookSpecificOutput?}` JSON envelope",
    "on the paths that produce output; nothing on the silent success paths.",
    "Each `linear prime` invocation has a 30s timeout.",
  ].join("\n"),
  arguments: {
    event:
      "lifecycle event: SessionStart | PreCompact | PostCompact | UserPromptSubmit",
  },
  seeAlso: ["prime", "setup codex"],
};

/**
 * Read the full stdin stream as a UTF-8 string. Resolves to "" when the
 * stream ends with no data — an empty stdin is valid hook input, not an error.
 */
function readStdin(stream: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve, reject) => {
    // No TTY / closed stdin → treat as empty input.
    if (stream.isTTY) {
      resolve("");
      return;
    }
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

/**
 * Parse the stdin payload into a CodexHookInput. An empty/whitespace-only
 * payload yields an empty input (the positional event arg is then used).
 * Malformed JSON throws — surfaced as a non-zero exit with a stderr message.
 */
function parseInput(raw: string): CodexHookInput {
  const trimmed = raw.trim();
  if (trimmed === "") return {};
  return JSON.parse(trimmed) as CodexHookInput;
}

export function setupCodexHookCommands(program: Command): void {
  const codexHook = program
    .command("codex-hook <event>", { hidden: true })
    .description("run an internal Codex lifecycle hook")
    .action(async (...args: unknown[]) => {
      const [event] = args as [string, Record<string, unknown>, Command];
      try {
        const raw = await readStdin(process.stdin);
        const input = parseInput(raw);
        await runCodexHook(event, input, process.stdout);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      }
    });

  codexHook
    .command("usage")
    .description("show detailed usage for codex-hook")
    .action(() => {
      console.log(formatDomainUsage(codexHook, CODEX_HOOK_META));
    });
}
