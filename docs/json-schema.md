# `--json` shape reference

`linear`'s `--json` envelope is **Linear's GraphQL-native shape**: camelCase
keys, nested objects (`state.name`, `team.key`), and relation connections
(`relations.nodes[]`). This document is the durable contract for programmatic
consumers.

## Why the JSON mirrors the API directly

The `--json` output is deliberately a thin pass-through of what the Linear API
returns, rather than a flattened or renamed projection:

- **One source of truth.** The JSON mirrors exactly what the Linear API
  returns, so field semantics never drift between the API docs and the CLI. A
  translation layer would be a second schema to keep in sync (and to get
  subtly wrong).
- **No lossy flattening.** Linear's model is rich — a state has both a `type`
  *and* a workspace-specific `name`; an issue has typed relation edges, not
  just counts. Flattening would discard information agents legitimately use.
- **`jq` bridges any simpler shape.** A consumer that wants a flat record can
  project one with `jq` (example below) — visible, versioned by the script
  author, and never silently diverging from Linear's evolving schema.

## Issue object fields

| Field | Meaning |
|-------|---------|
| `id` | Linear UUID. |
| `identifier` | Human key (e.g. `ENG-12`). Prefer this for display and lookups. |
| `title` | Issue title. |
| `description` | Markdown body. |
| `state.type` | Lifecycle **category** (stable, workspace-agnostic) — branch on this. See *Status model*. |
| `state.name` | Workspace-specific label ("Backlog", "In Review", "Done") — varies per team. |
| `priority` | Integer; see *Priority scale*. |
| `labels.nodes[].name` | Label names. Issue type is encoded as a `type:<value>` label (Linear-Hack — Linear has no native issue-type field). |
| `assignee` / `creator` | Full user objects (`null` when unassigned). |
| `createdAt` / `updatedAt` | ISO-8601 timestamps. |
| `completedAt` | ISO-8601; `null` while open. |
| `parent.identifier` | Parent issue (the `parent` object is `null` if none). |
| `relations.nodes[]` / `inverseRelations.nodes[]` | Typed dependency edges — each carries a `type` and both endpoints (not a flat id list). |
| `comments.nodes[]` | Comment connection. |

Counts are derived, not stored — e.g. `.relations.nodes | length`,
`.inverseRelations.nodes | length`, `.comments.nodes | length`.

Additional fields linear surfaces: `branchName`, `estimate`, `dueDate`,
`team.{id,key,name}`, `project`, `cycle`, `projectMilestone`,
`children.nodes[]`.

## Status model

Linear uses a two-level status model:

- `state.type` — the **category**: `triage`, `backlog`, `unstarted`,
  `started`, `completed`, `canceled`, `duplicate`. This is the stable,
  workspace-agnostic token to branch on.
- `state.name` — the **workspace-specific label** ("Backlog", "In Review",
  "Done"), which varies per team.

There is no standalone "blocked" status — blocked is a *relation* property, not
a state: check `hasBlockedByRelations: true`.

## Priority scale

Linear's priority integers:

| value | meaning |
|-------|---------|
| 0 | no priority |
| 1 | urgent |
| 2 | high |
| 3 | medium |
| 4 | low |

Note that `0` ("no priority") sinks to the **end** of priority-ordered views
rather than being the most urgent.

## Projecting a flat shape with `jq`

A consumer that wants a simple flat record can project one explicitly:

```bash
linear issues read ENG-12 --json | jq '{
  id: .identifier,
  title,
  description,
  status: .state.type,
  priority,
  issue_type: ((.labels.nodes[]?.name | select(startswith("type:"))) // null),
  created_at: .createdAt,
  updated_at: .updatedAt,
  dependency_count: (.relations.nodes | length),
  dependent_count: (.inverseRelations.nodes | length)
}'
```

Keeping the projection in the consumer (not the CLI) means it's visible,
versionable by the script author, and never silently diverges from Linear's
evolving schema.
