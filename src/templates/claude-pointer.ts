/**
 * Thin CLAUDE.md pointer template — written by `linear init` when no
 * CLAUDE.md exists in the project. Per PROCESS.md §D2, the AGENTS.md /
 * CLAUDE.md split has the rich brief in AGENTS.md and a 30-line pointer
 * in CLAUDE.md. The pointer is intentionally short: workflow / build /
 * storage rules drift quickly when duplicated across agent entrypoints,
 * so we keep one source of truth (AGENTS.md) and point at it.
 *
 * Write semantics (see init-service.ts):
 *   - Never overwrite. If CLAUDE.md already exists, leave it alone.
 *   - Not a managed block. No BEGIN/END markers — the user is expected
 *     to hand-edit this file after first write.
 *   - Skipped under `--skip-agents` and `--stealth`, same gating as
 *     AGENTS.md.
 *
 * Shape: title + "Start here" links + "Ground rules" bullets + a
 * precedence note.
 */

export const CLAUDE_POINTER = `# Claude Code Entry Point

Keep this file thin. Workflow, build, and storage rules belong in AGENTS.md.
Copied into two places, they go stale in one of them.

## Start here

- **Workflow and safety**: [AGENTS.md](AGENTS.md)
- **How to actually run the work**: [AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md) (if present)
- **How the code is laid out**: [docs/CLAUDE.md](docs/CLAUDE.md) (if present)

## Ground rules

- Run \`linear prime\` before starting tracked work.
- Linear holds durable outcomes, decisions, independently resumable work,
  human gates, and next actions. Temporary execution steps belong in the host
  agent's task system.
- Creating an issue commits it to the backlog. Create the children your
  assigned work requires; unrelated discoveries wait for triage.
- \`linear prime\` is the live command reference. For the static reference
  bundle, install \`/plugin install linear\` in Claude Code, which pulls down
  \`plugins/linear/skills/linear/resources/\`.
- Where this file disagrees with [AGENTS.md](AGENTS.md), AGENTS.md wins.
  Delete the duplicate here rather than reconciling the two.
`;
