---
description: Manage dependency relations between issues
argument-hint: add|remove|list|tree|graph|cycles|relate|unrelate <issue> [target]
---

Manage dependency relations between Linear issues. Covers Linear's native edge types (`blocks` / `blocked-by` / `relates-to` / `duplicate-of`) and a small set of Linear-Hack edge types stored as typed comments (`tracks`, `discovered-from`, `until`, `caused-by`, `validates`, `supersedes`).

`linear dep` is an alias for `linear depends`.

## Direction trap — read this first

`linear dep add <issue> <depends-on>` creates an edge where `<depends-on>` **blocks** `<issue>` — i.e. `<issue>` is the downstream consumer. Mnemonic: read it as "`<issue>` depends on `<depends-on>`". Reverse order silently inverts the graph.

If you want to be explicit, set the edge from one issue with `linear update --blocks` / `--blocked-by` instead — those flag names spell out the direction.

## Subcommands

### add

```
linear dep add <issue> <depends-on> [--type <type>]
linear dep add --file <path|->
```

Create a `blocks` edge (the default `--type`). Bulk mode: `--file` reads JSONL `{from, to, type?}` records (use `-` for stdin).

Edge types:

- **Native** (Linear `IssueRelation`): `blocks` (default), `blocked-by`, `related`, `relates-to`.
- **Linear-Hack** (encoded as typed comments since Linear has no native equivalent): `tracks`, `discovered-from`, `until`, `caused-by`, `validates`, `supersedes`.

For duplicate relations, use `linear duplicate <id> --of <canonical>` instead — `dep add --type duplicate-of` is not supported (the verb closes the duplicate and creates the Linear `duplicate` relation in one shot).

### remove

```
linear dep remove <issue> <depends-on>
```

Delete the edge between two issues (either direction).

### list

```
linear dep list <issue> [--direction down|up|both] [-t <type>]
```

List edges incident on one issue. `down` (default) = outbound (this blocks X), `up` = inbound (X blocks this), `both` = union. In text mode the listing includes a synthetic `via parent-child` row when the issue has a parent; the JSON envelope omits the synthetic row.

### tree

```
linear dep tree <issue> [--direction down|up|both] [-d N] [--status <s>] [--format mermaid] [--show-all-paths]
```

Transitive dependency tree rooted at one issue. Text mode renders a `🌲 Dependency tree for <id>` header + ANSI `[READY]`/`[BLOCKED]` marker on the root. `--format mermaid` emits a Mermaid.js flowchart (raw text — a documented text-output exception, not JSON). `--reverse` is a deprecated alias for `--direction=up`.

### graph

```
linear dep graph [issue] [--all] [--team <team>] [--max-depth N] [--dot]
```

Visualize an issue's dependency subgraph. With `--all`, scans every open issue and groups by connected component (mutually exclusive with a positional `[issue]`). `--dot` emits Graphviz DOT for piping to `dot -Tsvg`. Layering uses longest-path on `blocks` edges only — `related` / `duplicate` edges appear in the output but do not influence layer placement.

### cycles

```
linear dep cycles [--team <team>]
```

Detect dependency cycles across the workspace. Useful before a `pour` or batch close to make sure the graph is acyclic.

### relate / unrelate

```
linear dep relate <issue-a> <issue-b>
linear dep unrelate <issue-a> <issue-b>
```

Create or remove a bidirectional `related` link — Linear stores `relates-to` symmetrically.

## Examples

```bash
# ENG-200 depends on ENG-100 (i.e. ENG-100 blocks ENG-200)
linear dep add ENG-200 ENG-100

# Soft "related"
linear dep relate ENG-42 ENG-43

# Capture work discovered mid-task (Linear-Hack edge)
linear dep add ENG-300 ENG-42 --type discovered-from

# Tree view: what blocks ENG-200?
linear dep tree ENG-200

# Inverse: what does ENG-200 block?
linear dep tree ENG-200 --direction up

# Mermaid for README inclusion
linear dep tree ENG-200 --format mermaid > tree.md

# Big-picture: full workspace graph as DOT, render with graphviz
linear dep graph --all --dot | dot -Tsvg > graph.svg

# Cycle check before a release
linear dep cycles
```

## When to reach for the relation type

- **blocks / blocked-by** — hard sequencing. Both `next` and `blocked` honor these.
- **relates-to / related** — soft context. Doesn't affect readiness.
- **duplicate-of** — close one issue in favor of another; prefer `linear duplicate` for the close-too workflow.
- **discovered-from** — capture work surfaced mid-task without losing the lineage.

## See also

- `/linear:ready` — what's unblocked right now
- `/linear:blocked` — the inverse
- `/linear:update --blocks <id>` — direction-explicit alternative to `dep add`
- `/linear:show` — see relations on one issue
