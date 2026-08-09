---
description: Bulk-create Linear issues from a JSONL file or stdin
argument-hint: "[file|-]"
---

Bulk-create Linear issues from a newline-delimited JSON (JSONL) stream. Pass a file path or `-` to read from stdin. One-shot migration utility — not a routine sync workflow.

Reads one issue per line. Required field: `title`. Recognized optional fields: `description`, `priority`, `team.key` (Linear team key, e.g. `ENG`), `labels` (string array), `identifier` (used to wire intra-batch dependencies), and `dependencies[]` with `depends_on_identifier`.

## Usage

- **Import from a file**:
  - `linear import issues.jsonl`

- **Import from stdin**:
  - `cat issues.jsonl | linear import -`
  - `some-exporter | linear import -`

- **Dry-run (parse and plan only, no Linear writes)**:
  - `linear import issues.jsonl --dry-run`

- **Skip rows whose title matches an open Linear issue** (case-insensitive):
  - `linear import issues.jsonl --dedup`

- **JSON envelope output for scripting**:
  - `linear --json import issues.jsonl`
  - `linear --json=compact import issues.jsonl`

## JSONL schema

Each line is one issue object:

```jsonl
{"title":"Wire OAuth callback","team":{"key":"ENG"},"priority":2,"labels":["auth","backend"],"identifier":"oauth-1"}
{"title":"Add OAuth callback tests","team":{"key":"ENG"},"identifier":"oauth-2","dependencies":[{"depends_on_identifier":"oauth-1"}]}
{"title":"Update onboarding docs","description":"Mention the new OAuth flow.","team":{"key":"ENG"}}
```

Behavior:

- **Phase A — create issues.** Missing labels are auto-created in the active workspace.
- **Phase B — wire dependencies.** A row's `dependencies[].depends_on_identifier` maps to a Linear `Blocks` relation on the referenced issue (semantically: "this row is blocked by that row").
- Rows with `"_type": "memory"` are dropped (no Linear analog for memory entries) and counted in the result.

## Notes

- This verb is the top-level alias for `linear issues import`; both invocations share the same implementation.
- Comments and parent/child sub-issues are intentionally out of scope for the initial implementation.
- `--dry-run` makes no Linear API mutations and is safe to run against any workspace.
- `linear import usage` prints the full domain reference (also surfaced in `USAGE.md`).

## See also

- `/linear:create` — interactive single-issue creation
- `/linear:export` — dump existing Linear issues to JSONL
- `/linear:decision` — record a structured decision issue
