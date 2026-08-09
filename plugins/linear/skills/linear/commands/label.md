---
description: Manage labels on issues
argument-hint: list|add|remove|show|propagate [issue] [label]
---

Manage Linear labels: list them, add/remove from individual issues, and propagate a label down to every direct child of a parent issue.

`linear label` is an alias for `linear labels` (the underlying domain is plural). Labels are auto-created workspace-wide on first use, so `linear label add` doubles as a label-creator.

## Subcommands

### list

```
linear label list [--type issue|project] [--scope workspace|team] [--team <team>] [-l N] [--after <cursor>]
```

Print the label catalog.

- `--type`: `issue` (default) or `project`.
- `--scope`: `workspace` or `team`. With `team` scope, pass `--team`.
- `--team <team>`: Team key/name/UUID for team-scoped labels.
- `-l, --limit <n>`: Max results (default 50).

### add

```
linear label add <issue> [issue...] <label>
```

Add one label to one or more issues. **The last positional arg is the label**; everything before it is parsed as issue identifiers. Auto-creates the label workspace-wide on first use. Idempotent — already-labeled issues report `changed: false`.

### remove

```
linear label remove <issue> [issue...] <label>
```

Same shape as `add`, inverse effect. Idempotent.

### show

```
linear label show <issue>
```

List the labels currently assigned to one issue.

### propagate

```
linear label propagate <parent> <label>
```

Apply one label to every **direct** child of `<parent>`. Per-child idempotent. Use this when an epic gains a cross-cutting concern (`security-review`, `needs-tests`) you want every subtask to inherit.

## Reserved namespaces

- `provides:*` is reserved. Use `linear issues ship <capability>` to publish a capability; the CLI rejects direct `provides:` writes.
- `type:*` is the Linear-Hack convention for issue typing (since Linear has no native `type` field). `/linear:list -t bug` filters by `type:bug` label transparently.

## Examples

```bash
# Browse the catalog
linear label list
linear label list --type project
linear label list --scope team --team ENG

# Tag one issue
linear label add ENG-42 needs-review

# Tag several issues at once (label is LAST arg)
linear label add ENG-42 ENG-43 ENG-44 backend

# Remove a label
linear label remove ENG-42 needs-review

# What's on an issue right now?
linear label show ENG-42

# Cascade "security-review" to every subtask of an epic
linear label propagate ENG-99 security-review
```

## See also

- `/linear:list --label <l>` — filter by label
- `/linear:create --labels` — set labels at creation
- `/linear:update --labels` — bulk edit on a single issue (with `--label-mode overwrite` to replace)
