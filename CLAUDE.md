# Claude Code Entry Point for Linear

Keep this file thin. Architecture, workflow, and build rules belong in the
documents below. Copied into two places, they go stale in one of them.

## Start here

- **Architecture and invariants**: [AGENTS.md](AGENTS.md)
- **How to actually run the work**: [AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md)
- **PR maintenance policy**: [PR_MAINTAINER_GUIDELINES.md](PR_MAINTAINER_GUIDELINES.md)
  (when present)

## Ground rules

- Run `linear prime` before starting tracked work.
- Take the Node version from the `package.json` engines field and the
  build and test commands from
  [AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md). Do not pin either here.
- Linear is the source of truth. Re-fetch when resuming; there is no local
  database to reconcile.
- CLI visual conventions live in
  [AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md#visual-design-system).
- Where this file disagrees with something it links to, the linked source
  wins. Delete the duplicate here rather than reconciling the two.
