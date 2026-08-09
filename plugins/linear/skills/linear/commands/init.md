---
description: First-run setup wizard — identity, default team, AGENTS.md, CLAUDE.md, recipes, hooks
argument-hint: [-t team-key] [--non-interactive] [--recipes <list>] [--hooks <list>]
---

First-run setup for the `linear` CLI in a repo. Verifies the configured API token against Linear, persists a default team to `~/.linear/config.json`, and optionally installs agent-facing files (AGENTS.md / CLAUDE.md pointer), workflow recipes, and lefthook/git-hooks shims.

`linear init` is a top-level command (not an alias). Idempotent — safe to re-run.

## Options

### Identity / team

- `-t, --team <key>`: Default team key to save (e.g. `ENG`). Persisted as `team.default`. If omitted and the wizard runs interactively, you'll be prompted; with `--non-interactive` and no flag, falls back to the configured default or errors.

### Wizard control

- `--non-interactive`: Do not prompt; use defaults or explicit flags only. Required in CI.
- `-q, --quiet`: Suppress progress output; implies `--non-interactive`.
- `--role <role>`: Force role — `maintainer` (default) or `contributor`.

### Install selectors

- `--skip-agents`: Skip writing AGENTS.md, CLAUDE.md, and recipes.
- `--skip-hooks`: Skip the lefthook / `.git/hooks/` shim install (no quality-gate wiring). **Not a no-op** — actively skips hook installation.
- `--stealth`: Umbrella — skip agent files, recipes, and hooks. Use for managed-branch / no-push workflows.
- `--contributor`: Contributor mode — skip every local install; just verify identity.

### Recipes / hooks (bypass the wizard prompt)

- `--recipes <list>`: Comma-separated recipe names (`claude,gemini,codex,mux,…`), or `all`, or empty for none. Skips the prompt.
- `--hooks <list>`: Comma-separated hook kinds, or empty for none. Skips the prompt. `--hooks=auto` requests a default-plan install.

### AGENTS.md customization

- `--agents-profile <profile>`: `minimal` (default) or `full` (inline reference for hookless agents).
- `--agents-file <name>`: Override AGENTS.md filename (persisted to config as `agents.file`).
- `--agents-template <path>`: Write a custom template body instead of the managed-block default — caller owns the file after this.

## Examples

```bash
# Full first-run, interactive wizard
linear init

# Pre-pick the team and run non-interactively (CI-friendly)
linear init -t ENG --non-interactive

# Identity-only (no agent files, no recipes, no hooks)
linear init --contributor

# Managed-branch workflow — identity + team, no agent surface
linear init -t ENG --stealth

# Maintainer who already has AGENTS.md/CLAUDE.md but wants quality-gate hooks
linear init -t ENG --skip-agents --hooks=auto

# Wire specific recipes without the wizard
linear init -t ENG --recipes claude,codex --hooks=auto
```

## What init does

1. **Verify auth** — calls `viewer { ... }` to confirm the token resolves. Fails fast with a readable message if `LINEAR_API_TOKEN` / `~/linear/token` / legacy `~/.linear_api_token` all resolve empty.
2. **Save default team** — writes `team.default = "<key>"` to `~/.linear/config.json`. Subsequent verbs that need a team pick it up automatically.
3. **AGENTS.md + CLAUDE.md** (unless `--skip-agents` / `--stealth` / `--contributor`) — writes a managed block pointing at `linear prime`. Profile, filename, and template body are all overridable.
4. **Recipes** (per `--recipes` or wizard) — installs integration files for AI editors (Claude Code plugin manifest, Gemini settings, Codex AGENTS.md, mux, etc.). Same surface as `linear setup <recipe>` but run as a batch.
5. **Hooks** (unless `--skip-hooks` / `--stealth` / `--contributor`) — installs lefthook overlays or `.git/hooks/` shims so commit-msg / pre-commit / pre-push gates run automatically.
6. **Workspace summary** — prints viewer, organization, role/stealth status, recipes installed, hooks installed, and the saved default team.

## What init does NOT do

- Does not create a local database. Linear is the source of truth — no on-disk issue store is maintained.
- Does not interactively prompt for an API token. Run `linear auth login` first (TTY-only) if no token resolves.
- Does not push anything to Linear — all writes are local config / agent files / hooks.

## Re-running

Safe. Re-running with a different `-t <key>` overwrites the saved default. Recipe/hook installers are idempotent — re-running with the same selection is a no-op; passing different selections layers them in. To remove an installed recipe, use `linear setup <recipe> --remove`.

## See also

- `/linear:onboard` — print the AGENTS.md snippet alone (no team save, no hook install)
- `/linear:prime` — the brief the SessionStart hook loads
- `linear setup <recipe>` — install / remove a single integration recipe outside the init flow
- `linear auth login` — interactive token capture (prerequisite)
- `linear info` — verify a token outside the init flow
- `linear where` — print resolved token source + on-disk locations
