---
description: List open issues blocked by an open predecessor
argument-hint: [--team] [--parent]
---

List open Linear issues with at least one open `blocks` predecessor — the inverse of `/linear:ready`. Useful for triage: what is the workspace stuck on right now?

`linear blocked` is a top-level command (not an alias).

## Options

- `--team <team>`: Scope to one team (key, name, or UUID). Without it, scans the whole workspace.
- `--parent <issue>`: Restrict to direct children of one parent issue (identifier or UUID). Pair with an epic ID to ask "which subtasks of this epic are stuck?".

## Examples

```bash
# Everything blocked across the workspace
linear blocked

# Stuck work for a single team
linear blocked --team ENG

# Subtasks of one epic that are blocked
linear blocked --parent ENG-99

# Pipe blocker IDs for downstream tooling
linear blocked --json | jq -r '.[].identifier'
```

## How "blocked" is defined

An issue is blocked iff at least one of its inbound `blocks` relations comes from an issue that is **not yet in a completed-category state**. Native Linear edges only — Linear-Hack edge types (`tracks`, `discovered-from`, etc.) do not affect blocked status.

`parent-child` is **not** a blocker. A subtask of an open epic is not considered "blocked by" its parent.

## When to use

- Daily triage: "what's stuck? what predecessor would unstick the most work?"
- Sprint review: "which epics ended the week with blocked children?"
- Before a release: ensure nothing in the release scope is waiting on something out of scope.

## See also

- `/linear:ready` — the inverse: open issues with no active blockers
- `/linear:dep tree <id> --direction up` — drill into one issue's blockers
- `/linear:show <id> --with-comments` — find out *why* an issue is blocked
