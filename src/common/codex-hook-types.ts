/**
 * Shared type definitions for the hidden `linear codex-hook` command.
 *
 * Defines the `CodexHookInput` / `CodexHookResponse` /
 * `CodexHookSpecificOutput` shapes for the hook protocol.
 * Codex feeds a JSON envelope on stdin describing the lifecycle event; the
 * command replies with a response envelope on stdout (or nothing on the
 * silent success paths). Field names mirror what Codex emits / expects:
 * snake_case on the input, camelCase on the response.
 */

/**
 * The JSON envelope Codex writes to the hook's stdin. Every field is
 * optional because Codex may omit any of them, and an empty stdin is valid
 * input that parses to an all-empty envelope rather than an error.
 */
export interface CodexHookInput {
  /** Opaque Codex session identifier — keys the refresh marker file. */
  session_id?: string;
  /** Path to the session transcript (unused, carried for parity). */
  transcript_path?: string;
  /** Working directory of the Codex session — keys the refresh marker. */
  cwd?: string;
  /** Lifecycle event name; overrides the positional `<event>` arg when set. */
  hook_event_name?: string;
  /** Model identifier (unused, carried for parity). */
  model?: string;
  /** Compaction/source trigger (e.g. "manual" / "auto") (unused). */
  trigger?: string;
}

/**
 * The `hookSpecificOutput` block on a response envelope. Only emitted when an
 * event injects additional context (SessionStart / UserPromptSubmit refresh).
 */
export interface CodexHookSpecificOutput {
  hookEventName?: string;
  additionalContext?: string;
}

/**
 * The response envelope written to stdout. `continue` is always `true` on the
 * paths that emit output (Codex decides whether to halt). The
 * `omitempty`-style optionality is preserved by only setting the fields that
 * carry a value.
 */
export interface CodexHookResponse {
  continue: boolean;
  systemMessage?: string;
  hookSpecificOutput?: CodexHookSpecificOutput;
}

/** Canonical lifecycle event names. */
export const CODEX_HOOK_SESSION_START = "SessionStart";
export const CODEX_HOOK_PRE_COMPACT = "PreCompact";
export const CODEX_HOOK_POST_COMPACT = "PostCompact";
export const CODEX_HOOK_USER_PROMPT_SUBMIT = "UserPromptSubmit";
