/**
 * `.aider/LINEAR.md` body — the linear workflow brief auto-loaded
 * by aider on every invocation (via `.aider.conf.yml`'s `read:`
 * block).
 *
 * Emphasizes aider's `/run` prefix execution model — aider doesn't
 * shell out itself; the user (or the model, with `/run`) does. So
 * every "do X" instruction here is phrased as `/run linear X` rather
 * than the bare CLI verb a Claude Code agent would emit.
 */
export const AIDER_LINEAR_MD = `# Linear Issue Tracking — Aider edition

This project uses **linear** (Linear.app CLI) for issue tracking.
Aider auto-loads this file via \`.aider.conf.yml\` so the workflow is
in your context window without you having to \`/add\` it each session.

## Core Rules

- Track durable outcomes, decisions, independently resumable work, human
  gates, and next actions in Linear. Use the host agent's task system for
  temporary execution steps.
- Treat issue creation as backlog commitment. Workers create only necessary
  children under assigned work; unrelated discoveries wait for triage.
- Use \`/run linear next\` to find eligible approved work. Search and confirm
  the parent before creating anything.
- Aider does not shell out automatically. To execute a \`linear\`
  command, **prefix it with \`/run\`** — e.g. \`/run linear next\`,
  \`/run linear show TES-1\`. The model can suggest \`/run\` commands;
  the user runs them.
- After making code edits, run the required gates, tend review/merge, post one
  receipt, and close only after the repository's real terminal event.

## Quick Reference (aider /run style)

\`\`\`
/run linear prime                            # Load full workflow context
/run linear next                             # Find unblocked work
/run linear issues list --status open        # Open issues
/run linear show TES-1                       # Read an issue
/run linear issues create "..." --parent-ticket <parent> --dry-run # Preview approved child
/run linear start <id>                       # Claim + In Progress; one selector owns selection
/run linear close <id> --reason "..."        # Close after the real terminal gate
/run linear depends add <issue> <blocker>    # Add a blocker edge
\`\`\`

## Workflow

1. \`/run linear where\` — verify workspace and repository scope
2. \`/run linear next\` — find eligible approved work
3. \`/run linear show <id>\` — load the issue, parent, and dependencies
4. \`/run linear start <id>\` — claim through the owning selector and confirm state
5. Use agent tasks for temporary execution and Linear children only for
   required independently resumable work
6. Capture unrelated discoveries as findings for triage
7. Tend review/merge, post one receipt, then close after the real gate

## Context Loading

For full workflow documentation in agent-optimized format,
\`/run linear prime\` and review the output. The output is curated
for AI consumption and updates with every linear release.

## Where to Learn More

- \`/run linear --help\` — top-level commands + aliases
- \`/run linear usage\` — multi-domain usage doc
- \`USAGE.md\` (in this repo, if present) — full reference
- \`.aider/README.md\` — human-facing onboarding for this directory
`;
