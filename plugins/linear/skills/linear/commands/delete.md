---
description: Delete an issue
argument-hint: <issue-id>
---

Delete a single Linear issue.

`linear delete` is an alias for `linear issues delete`. Deletion is **permanent**: the issue is removed from the Linear workspace and cannot be recovered through the API. Prefer `/linear:close` for completed work; reserve `/linear:delete` for genuine garbage (typos, accidentally-created issues, test artifacts).

## Arguments

- `<issue>`: Issue identifier (`ENG-123`) or UUID. Required.

## Options

None. The Linear API performs the delete without confirmation; the CLI does not require `--force` because the verb itself is the explicit signal.

## Examples

```bash
# Delete one issue
linear delete ENG-42

# Confirm via show first if you're unsure
linear show ENG-42 && linear delete ENG-42
```

## When NOT to delete

- The issue represents real, completed work — close it (`/linear:close`) and let the history remain.
- The issue is a duplicate — use `linear duplicate <id> --of <canonical>` so the relationship is recorded instead of erased.
- The issue is wrong but salvageable — `/linear:update` (title, description, status) is almost always better.

## What gets removed

Linear deletes the issue itself plus any `IssueRelation` edges it participated in. Comments and reactions on the deleted issue are dropped with it. References to the identifier in **other** issues' descriptions or comments become dead links — the CLI does not rewrite text references, because Linear has no comparable bulk-edit API.

## See also

- `/linear:close` — the safer option for finished work
- `/linear:update` — fix mistakes without losing history
- `/linear:show` — sanity-check before deleting
