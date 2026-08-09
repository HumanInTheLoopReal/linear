---
description: Show ready-to-work issues with no active blockers
argument-hint: [--team] [--priority] [--assignee] [--claim]
---

Show ready work: open Linear issues with no active `blocks` predecessor. This is the primary "what should I pick up?" verb for agents.

`linear ready` is an alias for `linear next`. Both invocation paths are stable.

## Options

- `--team <team>`: Scope to one team (key, name, or UUID).
- `-n, --limit <n>`: Max results (default 100).
- `-p, --priority <n>`: Filter by priority (1-4, or `P1`-`P4` shorthand).
- `-a, --assignee <user>`: Filter by assignee (email or display name).
- `-u, --unassigned`: Only unassigned issues.
- `-l, --label <labels>`: Filter by labels (comma-separated, AND semantics).
- `-t, --type <type>`: Filter by Linear-Hack `type:<value>` label (e.g. `task`, `bug`).
- `--include-deferred`: Include issues carrying `deferred` or `deferred-until:<future>` labels (excluded by default).
- `--claim`: Claim the first match — assigns the issue to the current viewer and transitions it to a `started`-category state. One selector must own concurrent queue selection.

## Examples

```bash
# Just give me something to work on
linear ready

# Highest priority only
linear ready --priority 1

# Bugs assigned to nobody
linear ready --type bug --unassigned

# Selector-owned claim: assigns me + sets In Progress, returns the issue
linear ready --priority 1 --claim

# Pipe identifiers for downstream automation
linear ready --json | jq -r '.[].identifier'
```

## How "ready" is defined

An issue is ready iff:

1. It is in the open to-do bucket (`unstarted`, `backlog`, or `triage`), not already `started`.
2. Every inbound `blocks` predecessor is in a completed-category state.
3. It does not carry a `deferred` label (or a `deferred-until:<future-date>` label that hasn't elapsed), unless `--include-deferred` is passed.

`parent-child` does not block readiness — a subtask of an open epic is ready as soon as its own direct `blocks` predecessors are clear.

## Claim semantics

`--claim` collapses the usual two-command workflow (`linear ready` -> pick ->
`linear update --assignee viewer --status "In Progress"`). Linear does not expose a
compare-and-swap claim, so two concurrent selectors can choose the same candidate. Let
one outer controller own queue selection, then re-read the claimed issue before code.

## See also

- `/linear:blocked` — the inverse
- `/linear:show <id>` — drill into a candidate before claiming
- `/linear:update --assignee <u> --status <s>` — the explicit alternative when you don't want the started transition
- `/linear:dep tree <id>` — verify the readiness reasoning
