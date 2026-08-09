/**
 * Minimal AGENTS.md snippet pointing coding agents at `linear prime` (and
 * at the `/plugin install linear` bundle for Claude Code hosts).
 *
 * Shared by `linear onboard` (which prints it for manual paste) and
 * `linear setup agents` (which writes it into a managed AGENTS.md
 * block). One canonical source so both surfaces stay in sync.
 *
 * The snippet deliberately stays short — it just tells the agent to
 * call `linear prime` for dynamic workflow context, rather than
 * duplicating the workflow body inline. That way AGENTS.md doesn't
 * have to be re-rendered every time the workflow changes; the agent
 * picks up the new prime output on its next session.
 *
 * Claude Code hosts that support plugins get a one-line steer at
 * `/plugin install linear`, which pulls down the full
 * `plugins/linear/` bundle (SKILL.md, slash commands, resource docs).
 * Tools without plugin support fall back to the inline pointer at
 * `linear prime` for the same context.
 */
export const AGENTS_SNIPPET = `## Issue Tracking

This project uses **linear** (Linear.app CLI) for issue tracking.
Run \`linear prime\` for workflow context. Claude Code users can also run \`/plugin install linear\` to install the dedicated skill plus \`/linear:*\` slash commands.

**Quick reference:**
- \`linear next\` — find unblocked work
- \`linear issues create "Title" --team <key>\` — create issue
- \`linear issues close <id>\` — complete work
- \`linear remember "insight"\` — persist context across sessions

For full workflow details: \`linear prime\`
`;

/**
 * Copilot-specific instructions for \`.github/copilot-instructions.md\`.
 *
 * A shorter, completion-time-focused variant of AGENTS_SNIPPET.
 * Copilot reads this on every code completion (not once per session),
 * so the body is trimmed:
 *
 * - No "Issue Tracking" heading — Copilot's prompt already frames the
 *   surrounding repo, so a top-level heading wastes tokens.
 * - No \`linear remember\` line — Copilot has no session loop where
 *   persistent memory matters.
 * - Inline reference to the issue-id format so Copilot completes
 *   commit messages and code comments with valid IDs without needing
 *   to call \`linear prime\`.
 */
export const COPILOT_INSTRUCTIONS_SNIPPET = `This project uses **linear** (Linear.app CLI) for issue tracking.

When suggesting commit messages, code comments, or PR descriptions, reference Linear issues by their team-prefixed ID (e.g., \`ENG-123\`, \`TES-1\`). Use trailers like \`Fixes ENG-123\` or \`Closes TES-1\` in commit messages so \`linear\`'s prepare-commit-msg hook can auto-close on push.

**CLI quick reference:**
- \`linear next\` — find unblocked work
- \`linear issues create "Title" --team <key>\` — create issue
- \`linear issues close <id>\` — complete work
- \`linear prime\` — full workflow context (run in terminal, not Copilot Chat)

For interactive agents (Copilot Chat, Workspace), run \`linear prime\` first to load dynamic workflow context.
`;
