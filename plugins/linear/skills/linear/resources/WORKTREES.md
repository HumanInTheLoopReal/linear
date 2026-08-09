# Git Worktree Support

`linear worktree` is a thin wrapper around `git worktree add` that
derives a branch name from a Linear issue. There is **no per-worktree
database** to redirect — Linear is the source of truth and every
`linear` command in any worktree talks to the same workspace via the
GraphQL API.

## When to Use Worktrees

| Scenario | Worktree? | Why |
|----------|-----------|-----|
| Parallel agent work | Yes | Each agent gets isolated checkout + branch |
| Long-running feature | Yes | Avoids stash/switch dance for interruptions |
| Quick branch switch | No | `git switch` is simpler |
| PR review isolation | Yes | Review without disturbing main work |

## Why `linear worktree` over `git worktree`

`linear worktree` is convenience sugar: it looks up the issue title
to confirm the ID is real, generates a branch name from the
identifier, and runs `git worktree add` for you.

```bash
linear worktree create ENG-42
# Creates ../eng-42 on branch eng-42
# (defaults: sibling of repo root, branch = lowercased identifier)

linear worktree create ENG-42 .worktrees/auth-refresh
# Override the path explicitly
```

You can keep using `git worktree add` directly if you prefer — no
linear-side bookkeeping breaks.

## Architecture

There is no `.linear/` redirect file, no shared database, and no
per-worktree config:

```
main-repo/
├── .linear/               ← Optional: repository policy/config, recipes,
│                            hooks, audit log. NOT a database.
└── .worktrees/
    ├── eng-42/            ← Plain git worktree
    │   └── (no .linear/ needed)
    └── eng-43/
        └── (no .linear/ needed)
```

Every `linear` invocation — in any worktree — resolves the API token
via the same precedence: `LINEAR_API_TOKEN` env > the encrypted token
file (`~/linear/token` on macOS, `~/.config/linear/token` on Linux) >
legacy `~/.linear_api_token`. CLI preferences may come from user config and
repository-local policy/config; run `linear where` to see the resolved values. Then it
queries Linear directly.

**Key insight**: There is no DB to keep in sync between worktrees.
Linear is the synchronization mechanism.

## Commands

```bash
# Create worktree from a Linear issue ID
linear worktree create ENG-42
linear worktree create ENG-42 ../eng-42-alt

# List worktrees (mirrors `git worktree list`, marks the main tree)
linear worktree list

# Removal: use git directly
git worktree remove ../eng-42
git worktree prune
```

`linear worktree` does **not** provide a `remove` subcommand in v1.
Use `git worktree remove <path>` directly; there is nothing else to
clean up.

## Resume Pattern: Re-acquaint with Issue Context

Because the worktree carries no Linear state, **always re-fetch the
issue when you start work in a fresh worktree**:

```bash
cd ../eng-42

# 1. Reload workflow brief + memories
linear prime

# 2. Re-fetch the issue you're working on
linear show ENG-42

# 3. Check ready / blocked so you have current state
linear ready
```

This is the same pattern as resuming after a long break (see
[RESUMABILITY.md](../references/RESUMABILITY.md)) — the worktree filesystem
doesn't remember what you were doing; Linear does.

## What `linear worktree` Does Not Do

`linear worktree` is intentionally minimal. It does not maintain any
worktree-specific local state, manage gitignore entries, or warm any
cache — there is no local database, so there is nothing to redirect
or warm. To inspect or remove worktrees, use `git worktree list` and
`git worktree remove` directly.

The mental model is "re-fetch from Linear on resume" rather than
"keep local state in sync per worktree".

## Parallel Agent Workflow

```bash
# The outer controller selects and assigns ENG-42 to agent A
linear update ENG-42 --assignee <agent-a> --status "In Progress"
linear worktree create ENG-42
cd ../eng-42
# ... work, commit, push ...

# The same controller selects and assigns non-overlapping ENG-43 to agent B
linear update ENG-43 --assignee <agent-b> --status "In Progress"
linear worktree create ENG-43
cd ../eng-43
# ... work in parallel ...
```

Selector-owned alternative: `linear ready --claim` matches the first unblocked issue
and assigns it to the viewer. Linear has no compare-and-swap claim, so workers must not
race this command; one outer controller owns selection and dispatch.

Each worker owns its assigned issue. Before dispatch, the controller checks likely file
and contract overlap and defines integration order; separate worktrees do not make
overlapping changes safe. Linear field updates are last-write-wins, which is another
reason to keep one writer per issue.

For per-agent audit (if you call `linear audit record` from your
agent code), each agent's `~/.linear/audit.jsonl` records the actions
it ran with `--global`. The repo-local `./.linear/audit.jsonl`
records actions performed from within the repo (regardless of
worktree). Note: audit logging is opt-in per call, not automatic.

## Debugging

If `linear` commands misbehave in a worktree:

```bash
# Which Linear config / auth resolution applies here?
linear where
linear info --json

# Is the working directory inside a git worktree?
git worktree list
git rev-parse --show-toplevel    # canonical worktree root
```

Auth and team resolution are **not** worktree-scoped — every shell
gets the same answer regardless of which worktree it's in. If two
worktrees see different teams, you've set `LINEAR_TEAM` differently in
the two shells; check `env | grep LINEAR_`.

## See Also

- [RESUMABILITY.md](../references/RESUMABILITY.md) — "Linear is source of truth;
  re-fetch on resume" model
- [WORKFLOWS.md](../references/WORKFLOWS.md#resume-after-session-loss) — session-start checklist
- `git worktree --help` — the underlying primitive
