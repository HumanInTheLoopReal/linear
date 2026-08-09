---
description: Close one or more completed issues
argument-hint: [issue-ids...] [-r reason]
---

Close one or more Linear issues. Sets the workflow state to a `completed`-category state on each issue and (optionally) posts a closing comment.

The command does not prove completion. Run it only after the issue's acceptance,
verification, review, and merge/authority gates are satisfied. See
[Issue Lifecycle](../references/ISSUE_LIFECYCLE.md).

`linear close` is an alias for `linear issues close` (also aliased as `done`).

## Arguments

- `<issues...>`: One or more issue identifiers (`ENG-123`) or UUIDs. **At least one ID is required** — the command does not read IDs from stdin. To close a piped list, use `xargs`: `linear list --status Done --json | jq -r '.nodes[].identifier' | xargs linear close`.

## Options

- `-r, --reason <text>`: Reason for closing. Posted as a comment on each issue before transition.
- `--reason-file <path>`: Read the closing reason from a file (use `-` for stdin).
- `--reason-stdin`: Read the closing reason from stdin.

`--reason`, `--reason-file`, and `--reason-stdin` are mutually exclusive.

## Examples

```bash
# Close a single issue
linear close ENG-42

# Close several issues with a shared reason
linear close ENG-42 ENG-43 ENG-44 -r "fixed in #123"

# Close a piped set of IDs — use xargs because close does not read stdin for IDs
# (linear list --json returns {nodes, pageInfo}, so unwrap with .nodes[])
linear list --status Done --json | jq -r '.nodes[].identifier' | xargs linear close

# Pipe a multi-line reason in
git log -1 --format=%B | linear close ENG-42 --reason-stdin
```

## After closing

When an issue closes, check whether anything previously blocked by it is now ready:

- `/linear:ready` — list newly unblocked work
- `/linear:blocked` — confirm the dependency really resolved
- If the task produced unrelated findings, keep them in the batched finding record.
  Create and link a follow-up only after authorized triage promotes it.

## See also

- `/linear:reopen` — undo a close
- `/linear:update` — change status without going through `close`/`reopen`
- `/linear:show` — confirm the new state
