---
description: Full-text search across issues
argument-hint: <query> [--team] [--status] [--label]
---

Full-text search across Linear issues. Matches `<query>` against the issue title, description, and identifier in a single call — cheaper to drive from an agent than chaining `list --title-contains` / `list --desc-contains` filters.

`linear search` is an alias for `linear issues search`.

## Arguments

- `<query>`: Free-text query. Quote multi-word queries. Required.

## Options

- `-l, --limit <n>`: Max results (default 50).
- `--after <cursor>`: Pagination cursor from the previous page's `pageInfo.endCursor`.
- `--team <team>`: Filter by team (key, name, or UUID). Defaults to `team.default` config / `LINEAR_TEAM`.
- `--all-teams`: Ignore the default team; search the whole workspace.
- `--assignee <user>` / `--creator <user>`: Filter by person.
- `--project <project>`: Filter by project.
- `--status <statuses>`: Comma-separated workflow-state names (requires `--team`).
- `--state-type <types>`: Comma-separated workflow-state types (`backlog`, `started`, `completed`, ...). Works without `--team`.
- `--label <labels>`: Label names; comma-separated or repeated, and an issue must carry every one. An unknown label returns no results and a stderr warning.
- `--cycle <cycle>` / `--milestone <ms>` / `--parent <issue>`: Scope further.
- `--priority <0-4>` / `--estimate <n>`: Filter by metadata.
- `--due-before` / `--due-after`, `--created-{after,before}`, `--completed-{after,before}`, `--updated-{after,before}`: Date filters (`YYYY-MM-DD`).
- `--has-blockers` / `--is-blocking`: Block-state filters.

## Examples

```bash
# Bare keyword search in your default team
linear search "auth"

# Across the whole workspace
linear search "rate limit" --all-teams

# Open bugs matching a keyword
linear search login --status "In Progress,Todo" --label bug

# Search by partial identifier (Linear indexes the identifier itself)
linear search ENG-4

# Pipe matches into jq for downstream work
linear search "memory leak" --json | jq -r '.nodes[].identifier'
```

## When to use `search` vs `list`

| Use case | Reach for |
|---|---|
| Quick exploratory query, you don't know which field | `/linear:search` |
| Filtering by known fields (status, label, date, assignee) | `/linear:list` |
| You want all results, no limit | `/linear:list` (no default cap) |
| Lowest-context discovery for an agent | `/linear:search` (defaults to 50) |

## Notes

- Linear's search index is API-side; results may lag by a few seconds after an issue is created or updated.
- The query is matched as a phrase against title/description; there is no fielded-query syntax (no `title:` / `body:`). For fielded filters, layer `--label`, `--assignee`, `--status` on top.
- Search includes closed issues by default (Done/Canceled show up in results). Archived issues are **excluded** — the underlying GraphQL `searchIssues` call hard-codes `includeArchived: false` and there is no flag to override.

## See also

- `/linear:list` — when you know the field
- `/linear:show` — drill into a single match
- `/linear:dep tree` — explore relationships from a match
