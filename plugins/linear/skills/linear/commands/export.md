---
description: Export issues to JSONL
argument-hint: [-o output-file] [-t team] [--all]
---

Export Linear issues to JSON Lines (one JSON object per line) for snapshot / backup / migration use cases.

`linear export` is an alias for `linear issues export`. The output is one issue per line with a stable field shape so downstream pipelines can rely on it.

## Options

- `-o, --output <file>`: Write JSONL to `<file>` atomically (via temp file + rename) instead of stdout.
- `-t, --team <key>`: Filter to a single team (key or UUID). Omit to export every team.
- `--all`: Include archived issues (sets the Linear `includeArchived=true` filter).

## Examples

```bash
# Stream to stdout, all teams, open + closed
linear export

# To a file
linear export -o snapshot-$(date +%Y-%m-%d).jsonl

# Single team only
linear export --team ENG -o eng-snapshot.jsonl

# Include archived issues
linear export --all -o full-snapshot.jsonl

# Diff snapshots quickly with jq
linear export -o /tmp/now.jsonl
diff <(jq -c '{id, identifier, title, state: .state.name}' /tmp/before.jsonl | sort) \
     <(jq -c '{id, identifier, title, state: .state.name}' /tmp/now.jsonl    | sort)
```

## When to export

- **Backup**: capture a point-in-time snapshot for cold storage.
- **Migration**: hand the JSONL to a downstream system (data warehouse, analytics, another tracker) — paired with `/linear:import` going the other direction.
- **Diff for review**: snapshot before + after a large change so the delta is auditable.
- **Offline analysis**: pipe into `jq`, DuckDB, or a notebook without re-hitting the API on every query.

## Note

Linear's backend is the Linear API (no local DB to export from), so `linear export` is a network operation. Expect rate-limit pacing on large workspaces.

For routine sync between Linear and another system, build an integration against the Linear webhook + API directly; `export` is a one-shot tool, not a streaming sync primitive.

## See also

- `/linear:import` — the inverse: bulk-create issues from a JSONL file
- `/linear:list --json` — narrower export with all of `list`'s filters
- `linear issues snapshot` — capture a labeled snapshot under `~/.linear/snapshots/` for `linear issues diff`
