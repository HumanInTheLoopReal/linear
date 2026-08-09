---
description: Work-template system — list, show, pour reusable issue DAGs
argument-hint: list|show|pour|current|progress [name|epic-id]
---

Manage **molecules**: reusable issue-DAG templates that spawn a full epic + children + dependencies into Linear in one call. Linear has no native template feature; molecules are local TOML files (in `.linear/molecules/`, `~/.linear/molecules/`, or bundled with the CLI) that the `pour` command instantiates against your workspace.

`molecules` covers the template lifecycle with `list`, `show`, `create`, `pour`, `current`, and `progress` verbs — the latter three drive the spawn / track loop.

## Subcommands

### list

```
linear molecules list
```

Enumerate molecule templates from all three sources: project (`.linear/molecules/`), user (`~/.linear/molecules/`), and bundled. Templates are grouped by source.

### show

```
linear molecules show <name>
```

Display a template's structure: top-level epic, child issues, dependency edges, and the variable schema (each `--var k=v` slot the template declares).

### pour

```
linear molecules pour <name> [--var k=v ...] [--team <team>] [--dry-run]
```

Spawn the template into real Linear issues — creates the epic, all children as subtasks of that epic, and wires the declared `blocks` / `blocked-by` / `related` edges between them.

- `--var k=v`: Substitute template variables (repeatable). E.g. `--var pkg=src/foo --var owner=fahad`.
- `--team <team>`: Target team (defaults to `team.default` config / `LINEAR_TEAM`).
- `--dry-run`: Print the plan (what would be created, with what relations) without touching Linear.

### current

```
linear molecules current [--team <team>]
```

List molecule epics currently spawned in the workspace, with completion % per epic. Useful to answer "which molecules are still in flight?".

### progress

```
linear molecules progress <epic-id>
```

Per-child progress for one poured molecule. `<epic-id>` is the identifier or UUID of the epic returned by `pour`.

## Examples

```bash
# Discover what's available
linear molecules list

# Inspect a template
linear molecules show new-service

# Dry-run a pour to see what would land in Linear
linear molecules pour new-service --var name=billing --var owner=alice --dry-run

# Actually pour it
linear molecules pour new-service --var name=billing --var owner=alice --team ENG

# Track in-flight molecules
linear molecules current --team ENG
linear molecules progress ENG-200
```

## Where templates live

| Source | Path | Use case |
|---|---|---|
| Project | `.linear/molecules/*.toml` | Repo-scoped templates checked into git |
| User | `~/.linear/molecules/*.toml` | Personal templates across repos |
| Bundled | shipped with the CLI | Built-in defaults (`bug-investigation`, `feature-with-tests`, `refactor-package`) |

A project-level template with the same name wins over user, which wins over bundled.

## Design notes

Molecules are local TOML files that produce **full DAGs** (epic + children + dependency edges), not just one-shot issues. Use `/linear:create` when you want a single issue; use `/linear:molecules pour` when you want a whole sub-issue tree.

## See also

- `/linear:create` — single-issue creation
- `/linear:dep` — manually wire relations on issues already in Linear
- `/linear:show` — drill into an epic created by a pour
