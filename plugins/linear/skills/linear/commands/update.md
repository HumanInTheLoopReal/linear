---
description: Update an existing issue's fields
argument-hint: <issue-id> [--title] [--status] [--priority] [--assignee]
---

Update one Linear issue: title, description, status, priority, assignee, labels, parent, project, cycle, milestone, estimate, due date, and dependency relations.

`linear update` is an alias for `linear issues update`. For lifecycle transitions specifically, prefer `/linear:close` and `/linear:reopen` — they're purpose-built and post a closing/reopening comment.

## Arguments

- `<issue>`: Issue identifier (`ENG-123`) or UUID. Required.

## Common updates

- `--title <text>`: New title.
- `--description <text>`: Replace the description body.
- `--body-file <path>` / `--stdin`: Read new description from file or stdin.
- `--status <status>`: Workflow-state name (e.g. `In Progress`, `Done`).
- `--priority <1-4>`: 1=urgent, 2=high, 3=medium, 4=low.
- `--assignee <user>` / `--clear-assignee`: Set the assignee (email or display name), or unassign the issue. `--assignee ""` is silently ignored; use `--clear-assignee`.

## Labels

- `--labels <labels>`: Comma-separated label names (auto-created on first use).
- `--label-mode <mode>`: `add` (default — append) or `overwrite` (replace entire label set).
- `--clear-labels`: Remove every label on the issue.

## Project / cycle / milestone / parent

- `--project <project>`: attach to a project. (No `--clear-project` exists yet; `--project ""` is silently ignored. To detach, edit the issue in the Linear UI.)
- `--project-milestone <ms>` / `--clear-project-milestone`
- `--cycle <cycle>` / `--clear-cycle`
- `--parent-ticket <issue>` / `--clear-parent-ticket`

## Other fields

- `--estimate <n>` / `--clear-estimate`
- `--due-date <YYYY-MM-DD>` / `--clear-due-date`

## Design section (Linear-Hack)

- `--design <text>` / `--design-file <path>` / `--design-stdin`: Replace the `## Design` block appended to the description.

## Relations

`linear update` accepts relation flags so a single call can both edit fields and wire dependencies:

- `--blocks <issue>`: add a `blocks` edge.
- `--blocked-by <issue>`: add a `blocked-by` edge.
- `--relates-to <issue>`: add a soft `related` edge.
- `--duplicate-of <issue>`: add a `duplicate-of` edge.
- `--remove-relation <issue>`: remove any relation with `<issue>` (either direction).

For more relation work (bulk edges, native vs. Linear-Hack edge types, dependency graphs), reach for `/linear:dep`.

## Examples

```bash
# Bump priority
linear update ENG-42 --priority 1

# Reassign + transition + comment in one shot is split: update for the fields,
# /linear:comments for the note.
linear update ENG-42 --assignee fahad --status "In Progress"

# Unassign
linear update ENG-42 --clear-assignee

# Replace body from a file
linear update ENG-42 --body-file ./new-description.md

# Add two labels (default --label-mode add)
linear update ENG-42 --labels needs-review,backend

# Replace the label set entirely
linear update ENG-42 --labels security,critical --label-mode overwrite

# Add a blocked-by relation
linear update ENG-42 --blocked-by ENG-100

# Detach from epic
linear update ENG-42 --clear-parent-ticket
```

## See also

- `/linear:close` / `/linear:reopen` — purpose-built lifecycle transitions
- `/linear:label add` — narrower than `--labels` for single-label tagging
- `/linear:dep` — broader dependency graph operations
- `/linear:comments create` — append a discussion thread instead of mutating the description
