---
description: Load AI-optimized Linear workflow context for this session
argument-hint: [--memories-only] [--stealth]
---

Print an agent-optimized workflow brief (markdown) for driving the `linear` CLI in this workspace.

`linear prime` is the SessionStart hook payload — Claude Code wires it into the plugin's `plugin.json` so agents starting in a `linear`-installed repo automatically load the brief before doing tracked work.

## Options

- `--memories-only`: Print only the memory section (durable per-project facts written via `linear memory remember`). Used by PreCompact hooks to re-inject persistent project context after Claude's context window compaction.
- `--stealth`: Omit the git-ops session-close protocol (managed-branch / no-push workflows). Use in environments where the agent must not push to remotes itself.
- `--full`: Force the full brief even with `--memories-only`. Useful when diffing or auditing what the hook would otherwise hide.
- `--mcp`: Prepend an "MCP-available" hint pointing at `linear mcp`. Use when the agent host supports MCP and you want the brief to advertise it.
- `--export <path>`: Write the brief to `<path>` in addition to printing it. Useful for cache-warming SessionStart hooks (write once, agents read the file thereafter).

## When the plugin invokes prime

- **SessionStart**: full brief — workflow recipe, key verbs, memories, decision rules. Reloads the agent's understanding of the linear surface at the start of every Claude session.
- **PreCompact**: `--memories-only` — keeps durable project knowledge alive across context compaction without re-loading the full CLI reference.

## Manual usage

```bash
# Read the full brief yourself
linear prime

# Just the memories section
linear prime --memories-only

# Pipe into an external system
linear prime | pbcopy

# In a no-push environment
linear prime --stealth
```

## What's in the brief

`linear prime` is the source of truth for CLI workflow context (see plugin ADR-0001). It covers:

- Available verbs and their aliases (`list`/`show`/`ready`/`close`/`dep tree`).
- The default text / `--json` output contract.
- Auth resolution order (`LINEAR_API_TOKEN` → `~/linear/token` encrypted → legacy `~/.linear_api_token`).
- Team-resolution mechanics (`--team` vs `team.default` vs fully-qualified IDs).
- The dependency-direction trap (`linear dep add A B` reads as "A depends on B").
- Linear-Hack conventions (`type:*` labels, `## Design` description sections, typed-comment edge types).
- Local memories the agent has written via `linear memory remember`.

Because `prime` is dynamic, the skill's SKILL.md and resource docs **don't** re-state the CLI reference — they assume `prime` has been loaded. That's the DRY principle in the plugin's maintenance guide.

## See also

- `/linear:workflow` — short static workflow recipe
- `/linear:quickstart` — short tutorial pointer
- `linear onboard` — AGENTS.md snippet pointing at `linear prime` (CLI verb; no slash-command surface)
- `linear memory list` — what `--memories-only` will print
- `linear info` — workspace identity + viewer
