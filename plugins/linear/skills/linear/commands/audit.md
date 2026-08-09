---
description: Append agent interactions and their labels to a local JSONL trail
argument-hint: record|label|path
---

Writes a durable, append-only trail of agent activity (prompts, responses, tool
calls) to `.linear/audit.jsonl`.

The trail lives beside the repo at `<repo>/.linear/audit.jsonl` and is meant to
be committed with it. Add `--global` to any subcommand to write the per-user
trail at `~/.linear/audit.jsonl` instead. Outside a git repo the per-user path
is chosen automatically.

Nothing in the file is ever rewritten. One line is one event, and a judgment
about an earlier event is itself a new `"label"` event pointing back through
`parent_id`. That is what keeps the trail trustworthy as a dataset.

## Usage

Record an interaction:

```bash
linear audit record --kind llm_call --model "claude-sonnet-5" --prompt "..." --response "..."
linear audit record --kind tool_call --tool-name "npm test" --exit-code 1 --error "..." --issue-id ENG-7
```

Feed a complete JSON entry through stdin. This is detected automatically when
stdin is piped and no record flags are present; `--stdin` states it explicitly:

```bash
cat event.json | linear audit record
cat event.json | linear audit record --stdin
```

Judge an earlier entry:

```bash
linear audit label int-a1b2 --label good --reason "did exactly the right thing"
linear audit label int-a1b2 --label bad --reason "invented a file path"
```

Find the file:

```bash
linear audit path            # the repo trail
linear audit path --global   # the per-user trail
```

Target the per-user trail from anywhere:

```bash
linear audit record --global --kind llm_call --model "..." --prompt "..." --response "..."
linear audit label int-a1b2 --global --label good
```

## Notes

- Corrections happen by appending, never by editing. A `label` entry carrying
  `parent_id` supersedes an earlier judgment while leaving the original intact.
- Every entry uses the same field set, so downstream pipelines can depend on
  the shape: `id`, `kind`, `actor`, `issue_id`, `model`, `prompt`, `response`,
  `tool_name`, `exit_code`, `error`, `parent_id`, `label`, `reason`, `extra`,
  `created_at`.
- A JSON payload piped in must carry a non-empty `kind`.
- `linear audit usage` prints the full domain reference, which also appears in
  `USAGE.md`.

## See also

- `/linear:prime` reloads workflow context after compaction
- `linear memory list` covers adjacent local-only agent state
