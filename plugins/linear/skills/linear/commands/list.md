---
description: List issues with optional filters
argument-hint: [--status] [--priority] [--label] [--assignee] [--team]
---

List Linear issues with optional filtering. The default view includes every non-terminal issue in the configured default team; flags narrow further. The logical `--status open` bucket means not-started work only; use `--status open,in_progress` for every non-terminal state.

`linear list` is an alias for `linear issues list`. Text output uses a columnar layout; `--json` returns a paginated envelope `{nodes: [...], pageInfo: {endCursor, hasNextPage}}`.

## Common filters

- `--team <team>`: Filter by team (key, name, or UUID). Defaults to `team.default` config or the `LINEAR_TEAM` env var.
- `--all-teams`: Ignore the default team and scan the whole workspace.
- `--status <statuses>`: Comma-separated workflow-state names (requires `--team`, because state names live on a team).
- `--priority <0-4>`: 0=no priority, 1=urgent, 2=high, 3=medium, 4=low.
- `--label <labels>`: Label names or UUIDs. Comma-separate them, repeat the flag, or both; an issue must carry every one (AND). Names match case-insensitively. A label that does not exist matches nothing, so the result is empty and a warning goes to stderr.
- `--assignee <user>`: Email or display name.
- `--creator <user>`: Email or display name.
- `--project <project>`: Filter by project name or UUID.
- `--milestone <ms>`: Project milestone (requires `--project`).
- `--cycle <cycle>`: Filter by cycle (requires `--team`).
- `--parent <issue>`: Direct children of one parent issue.

## Date-range filters

All accept `YYYY-MM-DD` or full ISO 8601:

- `--created-after`, `--created-before`
- `--updated-after`, `--updated-before`
- `--completed-after`, `--completed-before`
- `--due-before`, `--due-after`

## Blocked-state filters

- `--has-blockers`: Only issues currently blocked by an open predecessor.
- `--is-blocking`: Only issues that are themselves blocking other open issues.

## Pagination

- `-l, --limit <n>`: Max results (default 50). Linear caps a single API page at 250.
- `--after <cursor>`: Cursor returned by the previous page's JSON envelope (`pageInfo.endCursor`).

## Examples

```bash
# Default — open issues in your default team
linear list

# Urgent open issues across the workspace
linear list --all-teams --priority 1

# Backend bugs assigned to alice
linear list --label backend,bug --assignee alice
linear list --label backend --label bug --assignee alice   # same filter

# Everything that landed yesterday
linear list --completed-after 2026-05-16 --completed-before 2026-05-17

# Subtasks of an epic
linear list --parent ENG-99

# Pipe-friendly: just the IDs (envelope is {nodes, pageInfo})
linear list --json | jq -r '.nodes[].identifier'
```

## When to use `list` vs `search`

| Use case | Reach for |
|---|---|
| You know the field you want to filter (status / label / date / assignee) | `/linear:list` |
| You want full-text matching against title + description | `/linear:search` |
| You need the full graph rooted at one issue | `/linear:dep tree` |
| You want only what's unblocked | `/linear:ready` |

## See also

- `/linear:search` — full-text fallback when you don't know the field
- `/linear:ready` — narrower: open + no active blockers
- `/linear:blocked` — narrower: only blocked work
- `/linear:show` — drill into one result
