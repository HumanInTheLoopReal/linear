# Troubleshooting Guide

Common issues encountered when using `linear` and how to resolve them.

## Interface-Specific Troubleshooting

**CLI:**
- Every `linear` invocation reaches the Linear GraphQL API; there is
  no local server or database. All state lives in your Linear
  workspace.
- Check health: `linear doctor`
- Check auth + viewer: `linear info --json`

**Sandboxed / CI environments:**
- Set `LINEAR_API_TOKEN` as an environment variable rather than
  relying on `~/linear/token` (the encrypted token file written by
  `linear auth login`, which won't exist in CI).
- `linear auth login` is interactive (TTY-only) and will fail in CI;
  rely on the env var.

**Most issues below apply to all environments** — the underlying
behavior is the same: every command makes one or more HTTPS GraphQL
requests.

## Contents

- [Auth Resolution Fails](#auth-resolution-fails)
- [Team Key Not Recognized](#team-key-not-recognized)
- [Rate Limited (HTTP 429)](#rate-limited-http-429)
- [Issue Identifier Not Found](#issue-identifier-not-found)
- [State Updates Rejected](#state-updates-rejected)
- [`linear auth login` Hangs in CI](#linear-auth-login-hangs-in-ci)
- [Cache / Staleness](#cache--staleness)
- [Version Requirements](#version-requirements)

---

## Auth Resolution Fails

### Symptom
```bash
linear info
# Error: not authenticated (no API token resolved)
```

Or:
```bash
linear list
# Error: HTTP 401 (Authentication required)
```

### Root Cause
`linear` resolves tokens in this order (highest precedence first):

1. `LINEAR_API_TOKEN` env var
2. Encrypted token file at `~/linear/token` on macOS, or
   `~/.config/linear/token` on Linux with `$XDG_CONFIG_HOME` set
   (written by `linear auth login`)
3. Legacy `~/.linear_api_token` (deprecation warning)

(Per-project / per-user CLI preferences — `team.default`, endpoint,
etc. — live separately at `~/.linear/config.json` and are managed
via `linear config set <key> <value>`. The token is **not** stored
there.)

If none resolves, you get the "not authenticated" error. If one
resolves but is invalid/revoked, the API responds with 401.

### Resolution

**1. Check what's resolving:**
```bash
linear info --json 2>&1 | head
echo "LINEAR_API_TOKEN set? ${LINEAR_API_TOKEN:+yes}"
ls -la ~/linear/token 2>/dev/null || ls -la ~/.config/linear/token 2>/dev/null
```

**2. Log in interactively (TTY):**
```bash
linear auth login
# Follow prompts; writes the encrypted token file (path above)
```

**3. Or set the env var:**
```bash
export LINEAR_API_TOKEN=lin_api_XXXXXXXXXXXXXXXXXX
linear info
```

**4. Rotate a revoked token:** generate a new personal API key in
Linear settings → API, then repeat step 2 or 3.

---

## Team Key Not Recognized

### Symptom
```bash
linear create "Test" --labels type:bug
# Error: team "ENG" not found (or no default team configured)
```

### Root Cause
Linear requires a `teamId` for every issue. `linear` resolves the team
in this order:

1. `--team <key>` flag on the command
2. `LINEAR_TEAM` env var
3. `team.default` config (`~/.linear/config.json`)

If none resolves — or the resolved key doesn't exist in your
workspace — the create / list / search call fails.

### Resolution

**1. List the teams you can see:**
```bash
linear teams list
```

**2. Set a default team:**
```bash
linear config set team.default ENG
```

Or for a single command:
```bash
linear create "Test" --team ENG --labels type:bug
LINEAR_TEAM=ENG linear create "Test" --labels type:bug
```

**3. If the team isn't listed**, you likely don't have access. Ask a
workspace admin to add you, then re-run `linear teams list`.

---

## Rate Limited (HTTP 429)

### Symptom
```bash
# Bulk-closing many issues via a shell loop or parallel xargs:
for id in ENG-{100..200}; do linear close "$id" --reason batch & done
# Error: HTTP 429 Too Many Requests
```

### Root Cause
Linear enforces per-token rate limits on their GraphQL endpoint. The
CLI retries with backoff on 429 and 5xx (see `src/common/retry.ts`),
but bursts of bulk writes can exhaust the budget.

### Resolution

**1. Throttle your bulk operations:**
```bash
# Instead of xargs -P 20:
for id in $(cat ids.txt); do
  linear close "$id" --reason "batch"
  sleep 0.2
done
```

**2. Use the script / bulk endpoints where available:**
```bash
# Multi-op script (close/update/create/dep), one mutation per line:
linear batch --file ops.txt
linear batch --file ops.txt --dry-run   # validate first

# Native bulk dependency / issue creation:
linear depends add --file edges.jsonl   # JSONL: {from,to,type?}
linear import issues.jsonl              # JSONL of issue inputs
```

These funnel many writes through fewer requests, easing rate-limit
pressure compared to one CLI invocation per item.

**3. Wait and retry**: the CLI's built-in backoff handles short
spikes; if you see 429 repeatedly, pause for 1–2 minutes.

---

## Issue Identifier Not Found

### Symptom
```bash
linear show ENG-9999
# Error: issue "ENG-9999" not found
```

### Root Cause
Either:

1. The team prefix is wrong (`ENG-9` exists, `eng-9` does not — keys
   are case-sensitive)
2. The issue was archived (Linear hides archived issues from queries
   by default)
3. The issue was deleted (`linear delete <id>`) — not recoverable
4. You don't have access to that team's issues

### Resolution

**1. Search by partial title:**
```bash
linear search "auth refresh"
```

**2. Include archived:** `linear list` does **not** support
`--include-archived`. To probe archived issues, use `linear export`
(JSONL only; exposes the `--all` flag for archived inclusion):
```bash
linear export --all -o /tmp/all.jsonl
grep '"identifier":"ENG-9999"' /tmp/all.jsonl
```

**3. Check team access:** `linear teams list` — if ENG isn't listed,
you don't have read access.

**4. Confirm it isn't deleted:** `linear delete <id>` permanently
removes an issue; there is no `undelete` and no archive trail.

---

## State Updates Rejected

### Symptom
```bash
linear update ENG-42 --status Blocked
# Error: workflow state "Blocked" not found in team ENG
```

### Root Cause
Linear workflow states are **per-team**. "Blocked" must exist as a
state on the ENG team's workflow. The CLI does not auto-create
states. (Note: `linear issues set-state` is for `<dimension>=<value>`
*labels*, not workflow status — use `update --status` for status
transitions.)

### Resolution

**1. List the team's states (with category mapping):**
```bash
linear issues statuses --team ENG
```

**2. Use an existing state name** (case-sensitive):
```bash
linear update ENG-42 --status "In Review"
```

**3. Add the state via Linear's UI** if your workspace genuinely
needs it, then retry.

---

## `linear auth login` Hangs in CI

### Symptom
A CI job calling `linear auth login` never completes (or fails after
the timeout).

### Root Cause
`linear auth login` is interactive: it opens a browser and waits for
the user to paste a token. There is no `stdin` to paste into in CI,
so it hangs.

### Resolution

**Always pre-provision the token in CI** via the env var:

```yaml
# GitHub Actions example
- name: Run linear
  env:
    LINEAR_API_TOKEN: ${{ secrets.LINEAR_API_TOKEN }}
  run: linear ready --json
```

To verify auth before calling other commands, use
`linear info >/dev/null 2>&1` — it exits non-zero if no token
resolves. Scripts must rely on pre-existing auth or fail clearly when
it's missing rather than try to authenticate themselves.

---

## Cache / Staleness

### Symptom
Two terminals: terminal A updates an issue, terminal B's `linear show`
still shows the old value for a moment.

### Root Cause
Linear is the source of truth and serves consistent reads. There is no
cache in the `linear` CLI itself. Any apparent staleness is one of:

1. The previous command hadn't finished writing when the second
   command's read query was sent.
2. Linear's own server-side propagation across replicas (usually
   sub-second).

### Resolution

For most workflows, no action needed — both terminals will see the
new state within milliseconds. If you need strict ordering, chain the
commands in one shell:

```bash
linear ready --claim && linear show <id-just-claimed>
# or, for an explicit claim:
linear update ENG-42 --assignee <you> --status "In Progress" \
  && linear show ENG-42
```

There is no local DB to flush or sync. There is no `linear sync`
command (deliberately — Linear is the source of truth).

---

## Version Requirements

### Check the linear-cli version
```bash
linear --version
```

### Updating
```bash
# Via npm
npm install -g @humanintheloop/linear@latest

# Via Homebrew
brew upgrade HumanInTheLoopReal/linear/linear
```

The Linear GraphQL API is versioned by Linear (their schema is
backward-compatible most of the time). If you see a schema error after
upgrading the CLI, regenerate codegen if you're working on `linear`
itself (`npm run generate`).

---

## When you need to escalate

### Collect the state first

Four commands describe the environment well enough that nobody has to guess:

```bash
linear --version
linear doctor      # auth and team probe; emits JSON by default
linear where       # resolved config, token, and repo root
linear info --json # viewer and workspace
```

### Filing a bug against the CLI

Search the project's open issues before writing a new one; the same
environment problems recur. A useful report carries the version, the
operating system, the output of the four commands above with **the API token
removed**, the shortest command that reproduces the problem, and what you
expected instead of what happened.

### Filing a bug against this skill

If the guidance itself is wrong rather than the tool, note the `version:`
field in the SKILL.md frontmatter and report the incorrect passage along with
what it should have said.

---

## Fixes at a glance

| Problem | Quick Fix |
|---------|-----------|
| Not authenticated | `linear auth login` or `export LINEAR_API_TOKEN=...` |
| Team not found | `linear config set team.default <KEY>` |
| HTTP 429 | Throttle bulk loops; prefer `--file` bulk endpoints |
| Issue not found | Check key case; dump archived with `linear export --all` |
| State name rejected | `linear issues statuses --team <KEY>` to list valid names; use `linear update --status` (not `set-state`) |
| `auth login` hangs in CI | Use `LINEAR_API_TOKEN` env var; never call `auth login` |
| Apparent staleness | No cache; chain `&&` if order matters |

---

## Related Documentation

- [CLI Reference](CLI_REFERENCE.md) — Complete command documentation
- [Dependencies Guide](DEPENDENCIES.md) — Understanding relation types
- [Workflows](../references/WORKFLOWS.md) — Step-by-step workflow guides
- [Resumability](../references/RESUMABILITY.md) — Linear-as-source-of-truth model
