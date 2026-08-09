---
description: Epic-management helpers — status, children, close-eligible
argument-hint: status|children|close-eligible [parent-id]
---

Epic management — track parent issues that have children, surface completion progress, and bulk-close epics whose every child is done.

Linear has **no native epic type**. Any open issue that has at least one child (via the `parent` relation) is treated as an epic by these helpers. The CLI surface for epic work lives under `linear issues *`; this slash-command groups the three verbs you'll actually reach for.

## Verbs in scope

### status — `linear issues epic-status`

```
linear issues epic-status [--team <team>] [--eligible-only]
```

Per-epic child-completion progress for every open issue that has children. Each row reports total children, closed children, % complete, and whether the epic is `eligible` (every child closed).

- `--team <team>`: Scope to one team. Without it, scans the whole workspace.
- `--eligible-only`: Only show epics ready to close (every child closed).

### children — `linear issues children`

```
linear issues children <parent> [-l N] [--after <cursor>]
```

List child issues of a parent (all statuses). In text mode the parent is the tree root and descendants are walked depth-first. `--json` returns a `PaginatedResult` of direct children only (the legacy shape).

### close-eligible — `linear issues close-eligible-epics`

```
linear issues close-eligible-epics [--team <team>] [--dry-run]
```

Close every open issue whose every child is closed (transitions to a `completed`-category state).

- `--team <team>`: Scope to one team.
- `--dry-run`: Preview eligible epics without closing them.

## Epic workflow

```bash
# 1. Create an epic
linear create "Migrate billing to v2" --team ENG --priority 1 \
  --labels epic --status "Backlog"

# 2. Add children (either at create time, or after the fact)
linear create "Schema migration" --team ENG --parent-ticket ENG-99
linear create "Data backfill"    --team ENG --parent-ticket ENG-99
linear create "Cutover script"   --team ENG --parent-ticket ENG-99

# 3. Track progress
linear issues epic-status --team ENG
linear issues children ENG-99

# 4. Bulk-close when done
linear issues close-eligible-epics --team ENG --dry-run   # preview
linear issues close-eligible-epics --team ENG             # commit
```

## Design notes

Linear has no first-class epic type — the `epic` label or `type:epic` label is a convention, not a type. The epic helpers live under `linear issues *` and operate on the parent edge, not on the label.

If you want to filter by an explicit epic label, layer it on:

```bash
linear list --label epic --has-blockers
```

## See also

- `/linear:list --parent <id>` — list children with all the standard list filters
- `/linear:dep tree <id> --direction up` — what's blocking this epic from closing
- `/linear:molecules pour` — spawn a fresh epic + child tree from a template
- `/linear:show <id>` — read the epic itself
