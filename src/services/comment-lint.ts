/**
 * Wall-of-text guidance for comment bodies (`validation.on-comment`).
 *
 * Linear renders comment bodies as markdown, but agents habitually post
 * long single-paragraph status dumps that show up as unreadable prose
 * walls in the Linear UI (TES-834). Every comment-body surface (issues
 * discuss/reply/edit/edit-reply, the projects discussion verbs, and the
 * deprecated comments facade) runs the resolved body through
 * {@link checkCommentFormat} before posting.
 *
 * Unlike the create-time section gate this is guidance, not a gate: the
 * default mode is `warn` (stderr nudge, the comment still posts). `error`
 * exists only as an explicit config opt-in; short bodies and anything
 * containing a line break never trigger at all.
 */

import { getConfig } from "../common/config-store.js";
import { fatalError } from "../common/errors.js";

/**
 * Bodies at least this long with no line break are treated as walls.
 * Chosen so multi-sentence status dumps trigger while ordinary one-line
 * comments ("LGTM", a close reason, a short answer) never do.
 */
export const WALL_MIN_CHARS = 400;

export type CommentValidationMode = "off" | "warn" | "error";

/**
 * A "wall of text": one long paragraph with no line breaks anywhere.
 * Any newline counts as structure — paragraphs alone already render
 * scannable — so only the truly unbroken dump trips the heuristic.
 */
export function isWallOfText(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length >= WALL_MIN_CHARS && !trimmed.includes("\n");
}

/**
 * `validation.on-comment` config decides the mode, defaulting to `warn`
 * (never block an agent's status update over formatting).
 */
export function resolveCommentValidationMode(
  env?: NodeJS.ProcessEnv,
): CommentValidationMode {
  const configured = getConfig("validation.on-comment", env).value;
  if (configured === "off" || configured === "warn" || configured === "error") {
    return configured;
  }
  return "warn";
}

/**
 * The teaching body shown when a wall is detected. Generic skeleton, not
 * a rigid template — the point is "use markdown structure", not "use
 * these exact headings".
 */
export function renderCommentFormatWarning(body: string): string {
  const chars = body.trim().length;
  return [
    `comment is one ${chars}-char paragraph with no line breaks — Linear renders comment bodies as markdown, so structure long updates:`,
    "",
    "  **Done:** what landed (commit / PR refs)",
    "  - key detail or measurement",
    "",
    "  **Next:** what follows",
    "",
    "Headers, bullets, `code`, and fenced blocks all render; pipe tables do NOT render in Linear. Short one-line comments are fine — this only fires on long unbroken paragraphs.",
  ].join("\n");
}

/**
 * Run the wall-of-text check on a resolved comment body. In the default
 * `warn` mode the guidance is printed to stderr and the comment still
 * posts; `error` (config opt-in only) throws a fatal teaching error;
 * `off` disables the check.
 */
export function checkCommentFormat(
  body: string,
  env?: NodeJS.ProcessEnv,
): void {
  const mode = resolveCommentValidationMode(env);
  if (mode === "off") return;
  if (!isWallOfText(body)) return;

  const warning = renderCommentFormatWarning(body);
  if (mode === "error") {
    throw fatalError(warning, {
      hint: "restructure the body with markdown, or relax the gate: `linear config set validation.on-comment warn|off`",
    });
  }
  process.stderr.write(`⚠ ${warning}\n`);
}
