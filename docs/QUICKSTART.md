# linear Quickstart

The agent-first CLI for [Linear](https://linear.app). A zero-friction,
dependency-aware issue workflow backed by Linear's hosted GraphQL API. No
local DB: Linear is the source of truth, and you get a browser/mobile UI plus
team visibility for free.

## Ultra-short path

1. **Install** — `npm install -g @humanintheloop/linear` (also brew / curl — see
   [Installing](INSTALLING.md) for all channels).
2. **Authenticate** — `linear auth login`. Token from
   <https://linear.app/settings/account/security/api-keys/new>.
   Non-interactive: `echo "$TOKEN" | linear auth login`.
3. **Set a default team** (optional) —
   `linear config set team.default <TEAM-KEY>`.
4. **Get the workflow brief** — `linear prime`.
5. **Find work** — `linear next` (open issues with no active blockers;
   alias of `linear ready`).
6. **Create** — `linear create "Title" --team <KEY> --description "..."`.
   Create enforces a structured body (`## Context` / `## Acceptance Criteria`
   / `## Test Plan`) — see `linear template show`. You can also pass `--context`,
   `--acceptance`, `--test`, `--design`, and `--notes`.
7. **Inspect / progress** — `linear show <id>`,
   `linear update <id> --status "In Progress"`.
8. **Close** — `linear close <id>`, then commit/push. The post-commit hook
   can auto-close via `Closes ENG-123` trailers.

Issue IDs are Linear-native (`ENG-123`) and immutable.

## Good to know

- **Top-level aliases:** `linear list` / `show` / `create` / `close` /
  `ready` map to their `linear issues ...` equivalents.
- **`--json`** emits the structured envelope for agents and scripts.
- **`linear doctor`** diagnoses workspace + setup health.
- **`linear prime`** is meant to be wired as a Claude Code SessionStart hook
  (`--hook-json` emits the hook envelope directly).

## Why linear?

An agent-first issue workflow backed by Linear's hosted API instead of a local
database — agents drive a scriptable CLI while humans get a real browser/mobile
UI and teams get visibility into agent work.

---

**See also:** [Installing](INSTALLING.md) · [Configuration](CONFIG.md) ·
[Troubleshooting](TROUBLESHOOTING.md) · [Agent workflow](../AGENT_INSTRUCTIONS.md)
