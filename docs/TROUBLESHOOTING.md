# Troubleshooting linear

`linear` is a thin client over Linear's **hosted GraphQL API**. There is no
local database, no sync, and no background server: Linear is the source of
truth, every command is a live API call. So failures cluster around five
things — **auth**, **team/scope resolution**, **the network/API**, **PATH /
Node**, and the **create validation gate**. This guide maps each symptom to
its cause and the real command that fixes it.

## Table of Contents

- [First-line diagnostics](#first-line-diagnostics)
- [1. Authentication](#1-authentication)
- [2. Team resolution ("Team X not found")](#2-team-resolution-team-x-not-found)
- [3. Scope labels (drift / coverage)](#3-scope-labels-drift--coverage)
- [4. `linear: command not found` / PATH](#4-linear-command-not-found--path)
- [5. Node version](#5-node-version)
- [6. Network, timeouts, and rate limits](#6-network-timeouts-and-rate-limits)
- [7. Create validation gate rejections](#7-create-validation-gate-rejections)
- [8. Debugging and environment variables](#8-debugging-and-environment-variables)
- [See also](#see-also)

## First-line diagnostics

Two read-only commands explain almost everything.

`linear doctor` runs workspace + environment health checks and prints only
warnings/errors by default. Add `-v` to see OK checks, `--agent` for ZFC
fields (`observed_state` / `expected_state` / `explanation` / `commands` /
`severity`), or `--check <name>` for one check.

```bash
linear doctor                       # all checks, warnings/errors only
linear doctor -v                    # include OK checks
linear doctor --check auth          # just the auth check
linear doctor --agent               # machine-readable per-check fields
linear doctor --list-suppressible   # checks + their doctor.suppress.<slug> keys
```

Available checks: `auth`, `stale`, `unassigned`, `labels`,
`scope_label_exists`, `scope_drift`, `scope_coverage`, `closed_not_archived`,
`broken_parent_edges`, `stale_by_team_default`, `claude_plugin`,
`claude_settings`, `claude_hooks`, `cli_in_path`. `linear doctor` is
**read-only advisory** — `--fix` is accepted but a no-op.

`linear where` prints on-disk locations and the **resolved token source**;
`--viewer` additionally calls the API to confirm which workspace the token
authenticates against.

```bash
linear where            # paths + token source (no API call)
linear where --viewer   # also confirm workspace identity (one API call)
```

```text
token:      /Users/you/linear/token  [stored]
Scope:
  label:      repo:linear  [scope.label local]
  team:       ENG          [scope.team local]
```

For a pre-PR sweep, `linear preflight --check` runs the readiness checks
(`--skip-api` for offline mode).

## 1. Authentication

**Symptom.** A command that hits the API exits `42` and prints a JSON
envelope to stderr:

```json
{
  "error": "AUTHENTICATION_REQUIRED",
  "message": "No API token found.",
  "action": "USER_ACTION_REQUIRED",
  "remediation": [ "Set LINEAR_API_TOKEN=<token> ...", "Persist once: ...", "Create a token: ..." ],
  "exit_code": 42
}
```

**Cause.** No token in any source, or a supplied token the API rejected
(401 / expired) — both surface as `AUTHENTICATION_REQUIRED`, because the
agent's next move is identical: supply a working token.

**Token resolution order** (first hit wins):

1. `--api-token <token>` flag
2. `LINEAR_API_TOKEN` env var
3. `~/linear/token` (encrypted store, written by `linear auth login`)
4. `~/.linear_api_token` (legacy plaintext file — prints a deprecation warning)

**Fix.** Create a token at
<https://linear.app/settings/account/security/api-keys/new>, then pick one:

```bash
export LINEAR_API_TOKEN="lin_api_..."        # session / CI
linear next --api-token "lin_api_..."        # one-off
echo "$LINEAR_API_TOKEN" | linear auth login # persist (encrypts to ~/linear/token)
```

**Diagnose.**

```bash
linear auth status        # reports stored-token presence (always exits 0)
linear where              # which source the token came from
linear where --viewer     # confirm the token actually authenticates
linear doctor --check auth
```

`linear auth status` is a status reporter and does **not** exit non-zero on a
missing token; use the exit code of a real API command (e.g. `linear next`)
or `linear where --viewer` to detect a broken token.

## 2. Team resolution ("Team X not found")

**Symptom.** `Team "X" not found`, or a write that complains no team was
provided.

**Cause.** Team resolution takes a key (`ENG`), exact name, or UUID and looks
it up live by `key`, then by `name`. A typo, a team you can't see with this
token, or no default configured all fail here.

**Resolution order for the default team:** `LINEAR_TEAM` env →
`scope.team` (local config) → `team.default` (global config). An explicit
`--team` always wins.

**Fix.**

```bash
linear teams list                              # find the real key
linear create "Title" --team ENG               # pass it explicitly
linear config set team.default ENG --global    # set a global default
linear config set team.default ENG --local     # or per-repo (in a git repo)
export LINEAR_TEAM=ENG                          # or via env
```

**Diagnose.** `linear where` shows the resolved team and its source;
`linear config show` shows effective config with per-key source
(env / local / global).

## 3. Scope labels (drift / coverage)

`linear` tags issues with a **scope label** derived from the git remote
(default prefix `git:`, e.g. `git:linear`) so scoped reads (`linear next`,
`linear list`) see only this repo's work. The derived default is overridable
via `scope.label` — which is why the `linear where` output above shows a custom
`repo:linear` rather than the `git:` default. Three doctor checks cover the
failure modes:

| Check | Warns when | Fix |
|-------|-----------|-----|
| `scope_label_exists` | the configured `scope.label` doesn't exist in Linear yet (label creation is deferred to first write, so scoped reads return zero) | `linear adopt --all` (or create one issue) |
| `scope_drift` | `scope.label` no longer matches what git derivation would produce now (remote / repo basename changed) | adopt the new derivation, or keep the old label if intentional |
| `scope_coverage` | open issues in `scope.default_project` are missing the scope label (untagged work is invisible to scoped reads) | `linear adopt --dry-run` then `linear adopt --all` |

```bash
linear doctor --check scope_label_exists
linear doctor --check scope_drift
linear doctor --check scope_coverage
linear where                       # shows the resolved scope.label + source
linear config get scope.label
git remote get-url origin          # what drift compares against
```

Override the derived label with `LINEAR_SCOPE_LABEL` or
`linear config set scope.label <name>`.

## 4. `linear: command not found` / PATH

**Symptom.** The shell can't find `linear` after a global install.

**Cause.** npm's global bin directory isn't on `PATH`, or a second copy
shadows the one you expect.

**Fix.**

```bash
npm prefix -g                       # e.g. /usr/local or ~/.nvm/.../v22.x.x
# add "$(npm prefix -g)/bin" to PATH in your shell rc, then re-source
which -a linear                     # detect multiple binaries / shadowing
linear doctor --check cli_in_path   # CLI's own PATH check
```

Under nvm/volta the bin lives inside the active Node version
(`~/.nvm/versions/node/<ver>/bin`); switching Node versions can hide a
previously-installed `linear`.

## 5. Node version

**Symptom.** Install aborts, or the CLI throws on syntax/APIs at runtime.

**Cause.** `package.json` requires `node >= 22`. Older Node is unsupported.

**Fix.**

```bash
node --version          # must be v22+
brew install node       # macOS; or your platform's installer / nvm
```

The install scripts abort below Node 22. If you manage Node via nvm/volta and
the check misfires, set `LINEAR_INSTALL_SKIP_NODE_CHECK=1` to bypass it.

## 6. Network, timeouts, and rate limits

**Symptom.** A command hangs then errors, or fails intermittently under load.

**Cause / behavior.** Every API call has a **30-second** timeout
(`REQUEST_TIMEOUT_MS`). Transient failures retry automatically with
exponential backoff (`withRetry`): up to **3 retries**, base delay **500 ms**
(500 → 1000 → 2000 ms). Retries fire on:

- HTTP **429** (rate limited)
- HTTP **5xx**
- network errors — `timed out`, `ECONNRESET`, generic `network`

Non-retryable errors (4xx other than 429, e.g. 401/400) fail immediately. If
all retries are exhausted, the underlying error propagates and the command
exits non-zero (generic `1` unless typed).

**Fix.**

```bash
linear where --viewer    # confirm the token reaches the API at all
curl -sI https://api.linear.app   # reachability / proxy sanity check
```

If you sit behind a proxy or a self-hosted GraphQL endpoint, point the client
at it with `LINEAR_ENDPOINT` (or `linear config set linear.endpoint <url>`).
Persistent 429s mean you're over Linear's API rate limits — slow down or
batch; the built-in backoff only absorbs short bursts.

## 7. Create validation gate rejections

**Symptom.** `linear create` is rejected for a missing structured section.

**Cause.** By default the create gate (`validation.on-create=error`) requires
the description to contain three headings (matched case-insensitively as a
substring, anywhere in the body):

- `## Context` — why the work exists
- `## Acceptance Criteria` — what "done" looks like (verifiable)
- `## Test Plan` — how the change is verified

**Fix.** Provide the sections, or relax the gate:

```bash
linear create "Title" --team ENG \
  --context "..." --acceptance "..." --test "..."   # structured flags assemble the body
linear create "Title" --team ENG --no-validate       # skip the gate for one create
linear config set validation.on-create warn          # warn instead of block (default: error)
linear config set validation.on-create off           # disable entirely
linear create ... --validate                          # force the gate on even if config is off
linear template show                                  # see the active template + its source
```

`--dry-run` previews the resolved issue (team, type, labels, assembled
description) without creating it. `linear issues lint` checks existing issues
against the same sections.

## 8. Debugging and environment variables

There is **no global `DEBUG`/verbose log flag**. Diagnose with the structured
tools instead: `linear doctor --agent`, `linear doctor -v`,
`linear where --viewer`, and `--json` on any command for the machine-readable
envelope.

Environment variables the CLI actually reads:

| Variable | Effect |
|----------|--------|
| `LINEAR_API_TOKEN` | API token (resolution slot 2; see [§1](#1-authentication)) |
| `LINEAR_TEAM` | default team key/name/UUID; overrides config `team.default` |
| `LINEAR_ENDPOINT` | override the GraphQL endpoint URL (proxy / self-host) |
| `LINEAR_SCOPE_LABEL` | override the derived scope label |
| `LINEAR_AGENT_MODE` | `0`/`false` = off, any other non-empty = on; trims default page size and emits compact JSON for bare `--json`. Auto-on when `CLAUDECODE` / `CLAUDE_CODE` is set |
| `LINEAR_NON_INTERACTIVE` | suppress interactive prompts (also implied by non-TTY / CI / `--quiet`) |
| `LINEAR_NO_AUTO_INIT` | (any non-empty) skip auto-init of repo scope on first run |
| `LINEAR_HOOK_TIMEOUT` | seconds before a `linear hooks run` invocation is killed (default 300) |
| `LINEAR_INSTALL_SKIP_NODE_CHECK` | bypass the Node 22 check in the install scripts |

Verify what's actually in effect:

```bash
linear where             # resolved token + scope + their sources
linear config show       # effective config with per-key source (env/local/global)
linear --version
```

## See also

[Installing](INSTALLING.md) · [Quickstart](QUICKSTART.md) · [Configuration](CONFIG.md) · [Uninstalling](UNINSTALLING.md) · [Agent workflow](../AGENT_INSTRUCTIONS.md)
