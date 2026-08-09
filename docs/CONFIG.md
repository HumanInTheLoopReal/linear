# Configuration

`linear` keeps a small set of local key/value preferences. There is **no
local database, no sync, no auto-commit/push** — Linear's hosted API is the
source of truth. Config only stores per-user / per-repo CLI behavior.

## Overview

Config is plain JSON, stored in two layers:

| Layer    | Path                          | Scope                |
| -------- | ----------------------------- | -------------------- |
| `global` | `~/.linear/config.json`       | per-user             |
| `local`  | `<repo-root>/.linear/config.json` | per-repo (needs git) |

Files are created on first write with `0600` perms (dir `0700`).

**Precedence (highest wins):**

```
env var  >  local layer  >  global layer  >  built-in default
```

Only a few keys honor env overrides (see [Environment variables](#environment-variables)).
The default team also consults `scope.team` (local) ahead of `team.default`.

**Layer selection on writes:** inside a git repo, `set` / `unset` / `set-many`
default to the **local** layer; outside a repo they fall back to **global**
with a stderr notice. Force a layer with `--local` or `--global` (mutually
exclusive). `list` defaults to **global**.

## Commands

```
linear config get <key>            # print value only (env overrides apply)
linear config set <key> <value>    # write one key
linear config unset <key>          # delete one key
linear config set-many <pair...>   # atomic batch write (key=value ...)
linear config list                 # keys in one layer (sorted)
linear config show                 # effective config + per-key source
linear config edit                 # open file in $EDITOR (interactive)
```

`get`, `set`, `unset`, `set-many` take `--local` / `--global`. `list` takes
`--local` (default global). `edit` takes `--global`.

```bash
# Set a default team once, stop typing --team
linear config set team.default ENG

# Read it back (value only — script-safe)
TEAM=$(linear config get team.default)

# Per-repo override (writes <repo>/.linear/config.json)
linear config set --local scope.team ENG

# Atomic batch write (all-or-nothing validation)
linear config set-many team.default=ENG validation.on-create=warn

# See every effective key and where it came from
linear config show
#   team.default        = ENG    (global)
#   scope.team          = ENG    (local)
#   validation.on-create= warn   (env)

# Remove a key
linear config unset scope.team
```

`set-many` validates **all** pairs before writing; if any key is invalid the
file is left untouched. Keys cannot be empty or contain `=`.

`config get` exits non-zero when the key is unset, so `$(linear config get …)`
fails loudly rather than returning an empty string silently.

## Settings reference

| Key                       | Purpose                                                                 | Values / format            | Default     |
| ------------------------- | ----------------------------------------------------------------------- | -------------------------- | ----------- |
| `team.default`            | Fallback team for every `--team`-taking command.                        | team key / name / UUID     | (unset)     |
| `scope.team`              | Per-repo team override; beats `team.default`. Set by `linear init --team` in a repo. | team key            | (unset)     |
| `scope.label`             | Implicit per-repo scope label AND-ed into `next`/`list` filters; auto-derived from the git remote (default `git:<repo>`). Migrate existing issues with `linear adopt`. | label name | (unset) |
| `scope.default_project`   | Per-repo default project; drives scope-coverage doctor checks.          | project name / id          | (unset)     |
| `validation.on-create`    | Strictness of the required-section gate on `create`/`epic`/`batch` (`## Context`, `## Acceptance Criteria`, `## Test Plan`). | `off` \| `warn` \| `error` | `error` |
| `validation.on-comment`   | Wall-of-text nudge on comment bodies (`discuss`/`reply`/`edit`/`edit-reply`, projects included): bodies ≥ 400 chars with no line break get a markdown-formatting reminder. `warn` prints to stderr and still posts; `error` blocks. | `off` \| `warn` \| `error` | `warn` |
| `template.create`         | Markdown create template; its `#` headings define the required sections. Managed via `linear template set/unset`. | markdown text | built-in template |
| `agents.file`             | AGENTS.md filename written by `linear init`; persisted on first `--agents-file`. | filename            | `AGENTS.md` |
| `doctor.suppress.<slug>`  | Hide a specific `linear doctor` WARNING. One key per check.             | `"true"` to suppress       | (not suppressed) |

`validation.on-create` is overridable per-call with `--validate` (force
`error`) / `--no-validate` (skip).

Enumerate the `doctor.suppress.<slug>` keys with:

```bash
linear doctor --list-suppressible
# e.g. doctor.suppress.closed-not-archived, doctor.suppress.stale,
#      doctor.suppress.auth, doctor.suppress.scope-drift, ...
linear config set doctor.suppress.closed-not-archived true
```

### Reserved / advanced keys

These are registered but rarely set by hand:

| Key                         | Purpose                                                       | Env override               |
| --------------------------- | ------------------------------------------------------------ | -------------------------- |
| `linear.endpoint`           | Override the GraphQL endpoint (default `https://api.linear.app/graphql`). | `LINEAR_ENDPOINT` |
| `linear.api_token`          | Auth token slot — **prefer `linear auth`**, not config (see [Notes](#notes)). | `LINEAR_API_TOKEN` |
| `linear.last_seen_version`  | Internal: last CLI version acknowledged by `linear upgrade`.  | `LINEAR_LAST_SEEN_VERSION` |

The config store accepts **any** string key, but only the keys above carry
defined behavior. Arbitrary keys are inert.

## Environment variables

Env vars override the on-disk value for their key (precedence above). Only the
mapped keys participate.

| Variable                   | Overrides key                | Effect                                            |
| -------------------------- | ---------------------------- | ------------------------------------------------- |
| `LINEAR_API_TOKEN`         | `linear.api_token`           | Auth token (highest token-resolution priority).   |
| `LINEAR_TEAM`              | `team.default`               | Default team for this invocation.                 |
| `LINEAR_ENDPOINT`          | `linear.endpoint`            | GraphQL endpoint override.                         |
| `LINEAR_LAST_SEEN_VERSION` | `linear.last_seen_version`   | Upgrade bookkeeping (tests / scripted runs).      |
| `LINEAR_AGENT_MODE`        | —                            | `0`/`false` = off; any other non-empty = on. Tunes agent-oriented output (e.g. compact `--json`). Auto-on under Claude Code. |

## Notes

- **The API token is NOT stored in config.** It lives encrypted at
  `~/linear/token`, managed by `linear auth`. Token resolution order:
  `--api-token` flag → `LINEAR_API_TOKEN` env → `~/linear/token` (encrypted) →
  `~/.linear_api_token` (deprecated). Do not put a token in `config.json`.
- **`linear config edit` is interactive** — it spawns `$VISUAL`/`$EDITOR`
  (default `vim`) and blocks on a TTY. Agents must use `linear config set` /
  `set-many` instead, which are non-interactive and atomic.
- Linear is the source of truth; there is nothing to commit, push, or sync.
  Re-fetch on resume rather than caching config-derived state.

---

**See also:** [Installing](INSTALLING.md) · [Quickstart](QUICKSTART.md) ·
[Troubleshooting](TROUBLESHOOTING.md) · [Agent workflow](../AGENT_INSTRUCTIONS.md)
