---
description: Create a new issue
argument-hint: <title> [--team] [--priority] [--description]
---

Create a new Linear issue.

Creation commits shared attention. Before using this command, apply
[the creation gate](../references/ISSUE_CREATION.md): ordinary product work must be
approved and correctly parented; unrelated discoveries remain findings until triage.

`linear create` is an alias for `linear issues create`. The title is the only required argument; everything else is a flag.

## Arguments

- `<title>`: Issue title. Required. Quote multi-word titles.

## Options

### Body

- `--description <text>`: Issue body (markdown).
- `--body-file <path>`: Read body from file (use `-` for stdin).
- `--stdin`: Read body from stdin (alias for `--body-file -`).

`--description`, `--body-file`, `--stdin` are mutually exclusive.

### Metadata

- `--team <team>`: Target team (key, name, or UUID). Defaults to `team.default` config / `LINEAR_TEAM`.
- `--priority <1-4>`: 1=urgent, 2=high, 3=medium, 4=low.
- `--assignee <user>`: Email or display name.
- `--status <status>`: Workflow-state name on the chosen team.
- `--labels <labels>`: Comma-separated label names or UUIDs. Labels are auto-created on first use.
- `--estimate <n>`: Numeric estimate.
- `--due-date <date>`: `YYYY-MM-DD`.

### Project / cycle / parent

- `--project <project>`: Add to a project.
- `--project-milestone <ms>`: Set a project milestone (requires `--project`).
- `--cycle <cycle>`: Add to a cycle (requires `--team`).
- `--parent-ticket <issue>`: Set parent (makes this a subtask).

### Design

- `--design <text>`: Architectural rationale. Appended as a `## Design` section after the description body (Linear-Hack — Linear has no native design field).
- `--design-file <path>` / `--design-stdin`: Read design from file or stdin.

### Relations (create + link in one call)

- `--blocks <issue>`: This issue blocks `<issue>`.
- `--blocked-by <issue>`: This issue is blocked by `<issue>`.
- `--relates-to <issue>`: Soft "related" link.
- `--duplicate-of <issue>`: Mark as duplicate of `<issue>`.

## Examples

```bash
# Minimum — just a title
linear create "Fix flaky login test"

# With team, priority, and a description
linear create "Add request-id header" \
  --team ENG --priority 2 \
  --description "Propagate request-id from edge to all services."

# Read body from a file
linear create "RFC: new auth flow" --body-file ./rfc.md

# Pipe stdin into the body
git log -1 --format=%B | linear create "Investigate regression in $(git rev-parse --short HEAD)" --stdin

# Subtask of an epic, with a label and a blocker
linear create "Add migration" \
  --team ENG --priority 2 \
  --parent-ticket ENG-99 \
  --labels backend,migration \
  --blocked-by ENG-100

# Create a finding only after authorized triage promotes it to durable work
new_id=$(linear create "Add retry on 429" --team ENG --priority 3 --json | jq -r .identifier)
linear depends add "$new_id" ENG-42 --type discovered-from
```

## After creating

- `/linear:show <new-id>` — verify the issue rendered correctly.
- Confirm the project, parent, state, owner, and relations match the approved plan.
- `/linear:dep` — wire up any blocks/blocked-by relationships you didn't pass at create time.
- `/linear:label add` — tag with extra labels.

## Notes

- `--design`, `--design-file`, `--design-stdin` write to the same `## Design` section; they're mutually exclusive.
- Labels are matched by display name first, UUID second; unknown names are auto-created workspace-wide.
- The `provides:*` label namespace is reserved — use `linear issues ship <capability>` instead of setting it directly.
- Execution workers may create only necessary children beneath their assigned issue;
  they do not create unrelated siblings or top-level backlog work.

## See also

- `/linear:update` — edit after create
- `/linear:dep` — wire relations after the fact
- `/linear:label` — tag with additional labels
- `/linear:molecules pour` — spawn a whole template tree (epic + children + deps) at once
