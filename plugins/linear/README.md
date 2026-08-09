# Linear Plugin

This is the shared Claude Code / Codex plugin package for `linear`. Claude and Codex use separate manifest files, but they share the same skill tree.

## Install

```
/plugin install linear
```

(Or, for local development, point Claude Code at the repo-root `.claude-plugin/marketplace.json` which references this package.)

## Layout

- `.claude-plugin/plugin.json` describes the Claude Code plugin.
- `.codex-plugin/plugin.json` describes the Codex plugin.
- `agents/task-agent.md` is the autonomous task-completion agent definition.
- `skills/linear/` contains the plugin-owned `linear` skill (SKILL.md + maintenance guide + ADR + 25 per-command slash-command docs + 13 resource docs).
- The Claude marketplace entry lives at the repo-root `.claude-plugin/marketplace.json`, which points at this shared package root.

## What you get

Installing this plugin into Claude Code (or pointing Codex at the package) gives an agent session:

- The `linear` skill, auto-loaded by name match — covers the workflow surface, decision frameworks, and resource index.
- 25 `/linear:*` slash commands (`/linear:create`, `/linear:ready`, `/linear:show`, `/linear:close`, ...) under the `linear:` namespace.
- 13 progressive-disclosure resource docs (WORKFLOWS, DEPENDENCIES, MOLECULES, RESUMABILITY, TROUBLESHOOTING, ...) loaded on demand.
- A `task-agent` role definition for autonomous "find ready work and complete it" loops.
- SessionStart + PreCompact hooks that auto-run `linear prime` so workflow context survives compaction.

## Local Development

Claude Code consumes `.claude-plugin/marketplace.json` at the repo root, which points at this shared package root. To iterate on the plugin:

1. Edit files under `plugins/linear/`.
2. In a fresh Claude Code session, `/plugin install linear` from the local marketplace.
3. Verify discovery: `/help` should show the `linear:` namespace; `linear prime` should fire on session start.

## Documentation

- [`skills/linear/SKILL.md`](skills/linear/SKILL.md) — entry point for agents.
- [`skills/linear/README.md`](skills/linear/README.md) — human-facing skill readme.
- [`skills/linear/CLAUDE.md`](skills/linear/CLAUDE.md) — maintenance guide for skill contributors.
- [`skills/linear/adr/`](skills/linear/adr/) — architectural decision records for the plugin/skill bundle.

## Codex schema compatibility

The Codex manifest at `.codex-plugin/plugin.json` is pinned to the
schema in use when this plugin was authored (see the file's
`name` / `version` / `interface` shape). If Codex CLI rejects this
manifest after an update, check whether the schema changed and update
the manifest to match. We do not run a contract test against Codex CLI
in CI.

## License

MIT (same as `linear`).
