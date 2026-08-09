# ADR 0001 — Plugin bundle distribution model

## Status

Accepted

## Context

Agent IDEs (Claude Code, Codex, Cursor, Factory, Mux) discover
capabilities via plugin bundles — directories laid out to a known
schema with manifest files (`.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`) describing commands, hooks, skills, and
agents.

linear-cli ships its capabilities as a plugin bundle at
`plugins/linear/`, exposes the bundle through a public Claude Code
marketplace, and commits the bundle to its own source tree so
contributors can develop and test against the same files end users
install. The distribution model has to satisfy several constraints:

- Multiple target IDEs share most of the bundle content (skills,
  commands, agent prompts). Maintaining separate forks per IDE
  multiplies maintenance cost and drift.
- Local development of the plugin needs to be possible without
  publishing to the public marketplace on every change.
- End users should be able to install with a single command per IDE.
- The bundle's source-of-truth must be auditable in the repo — review
  and version control over the same files users execute.

PROCESS.md "Locked cross-cutting decisions" #1 chose "public Claude
Code plugin marketplace + local dev copy via
`.claude-plugin/marketplace.json` at repo root." Decision #5 chose
"single bundle serves both Claude Code and Codex." This ADR captures
the non-obvious rationale.

## Decision

1. **Ship the bundle in the repo at `plugins/linear/`.** The directory
   is the source of truth for everything an installed plugin contains:
   `skills/`, `commands/`, `agents/`, manifest files, ADRs, SKILL.md,
   CLAUDE.md (plugin-internal).
2. **Expose via `.claude-plugin/marketplace.json` at the repo root**
   for local-dev installs. `claude plugin install ./plugins/linear`
   (or against the marketplace pointer) works from a clean clone.
3. **Publish to the public Claude Code marketplace** for end users.
   The marketplace entry points at the same `plugins/linear/`
   contents pinned to a release tag.
4. **Dual-target Claude Code + Codex from day one.** Two manifest
   files (`plugins/linear/.claude-plugin/plugin.json` and
   `plugins/linear/.codex-plugin/plugin.json`) point into the same
   skill/command/agent tree. No content is duplicated between
   manifests.

## Consequences

### Positive

- Local-dev parity: contributors test the same bundle end users
  install — no "works on my machine, breaks in marketplace" gap.
- Auditability: every plugin asset is in `git log`; PR review covers
  the same files agents execute.
- One canonical content tree: changes to a slash-command doc or a
  resource immediately benefit both Claude Code and Codex consumers.
- Versioning: the bundle version (`plugins/linear/.claude-plugin/plugin.json`)
  bumps in lockstep with the CLI release (see `RELEASING.md` §7),
  which makes "what version of the plugin shipped with linear vX.Y.Z"
  trivially answerable.

### Negative

- Schema changes in either plugin manifest require a `npm run build`
  + spot-check before release. Sub-project A's spec doc captures the
  Codex schema-pin caveat; ignoring it produces silent-failure
  bundles.
- The marketplace.json must be kept in sync with the bundle path on
  every move/rename. Mitigated by the maintenance guide
  ([`docs/PLUGIN-MAINTENANCE.md`](../PLUGIN-MAINTENANCE.md)) §5.
- Public marketplace publish requires a manual step in
  [`RELEASING.md`](../../RELEASING.md) §7. Until Claude Code adds an
  automated submission flow, this stays manual.

## Related

- [`docs/PLUGIN-MAINTENANCE.md`](../PLUGIN-MAINTENANCE.md) — operational
  maintenance contract for the bundle.

## Date

2026-05-17
