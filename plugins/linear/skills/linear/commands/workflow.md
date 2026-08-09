---
description: Show the AI-supervised Linear workflow guide
argument-hint: []
---

Display the canonical workflow for driving Linear from an AI agent or shell.

`workflow` is a static guide — not a CLI verb. For agent-onboarding context that adapts to the configured workspace, run `/linear:prime` instead.

## Linear Workflow

`linear` is a CLI for Linear.app designed for both humans and AI agents. Before using
the commands, classify the work with
[the operating model](../references/OPERATING_MODEL.md). Here is the durable issue loop:

### 1. Find ready work

```
/linear:ready
```

or `linear ready` (alias for `linear next`) — open issues with no active blockers. Add `--priority 1` to focus on the urgent queue.

### 2. Claim the work

```
linear ready --priority 1 --claim
```

`--claim` selects the first match, assigns it to you, and transitions it to a
`started`-category state. Linear does not provide compare-and-swap claim semantics, so
one outer selector must own selection when parallel agents are running.

The non-atomic equivalent:

```
linear update ENG-42 --assignee fahad --status "In Progress"
```

### 3. Do the work

Implement, test, and document. Keep reconstructable commands and steps in the host
agent task system. While working, batch unrelated discoveries as structured findings
on the current result/checkpoint; do not turn them into backlog automatically.

- If a human or authorized planner promotes a finding, create it in the approved
  hierarchy and preserve provenance with `discovered-from`:
  ```
  new_id=$(linear create "Retry on 429" --team ENG --json | jq -r .identifier)
  linear depends add "$new_id" ENG-42 --type discovered-from
  ```

If the current contract itself requires an independently resumable child, follow
[Sub-issues and Agent Tasks](../references/SUBISSUES_AND_AGENT_TASKS.md).

### 4. Tend Git and review

Push the issue branch, open or update its PR, satisfy required checks, resolve review,
and respect the repository's merge authority. A draft PR is not completion.

### 5. Close

```
linear close ENG-42 --reason "merged in #123; required checks green"
```

Close only after the workspace's real terminal gate. See
[Git and Review](../references/GIT_AND_REVIEW.md).

### 6. Check what's unblocked

```
/linear:ready
```

After closing, anything previously blocked by ENG-42 is now eligible.

## Reference table

| What you want | Verb |
|---|---|
| Pick up work | `/linear:ready` |
| Inspect one issue | `/linear:show <id>` |
| Filter | `/linear:list --status ... --label ...` |
| Free-text search | `/linear:search "<q>"` |
| Create | `/linear:create "<title>" --team ENG` |
| Edit fields | `/linear:update <id> --priority 1` |
| Add a dependency | `/linear:dep add ENG-200 ENG-100` |
| See the dependency tree | `/linear:dep tree <id>` |
| What's stuck? | `/linear:blocked` |
| Comment / discuss | `/linear:comments create <id>` |
| Tag | `/linear:label add <id> <label>` |
| Close | `/linear:close <id>` |
| Reopen | `/linear:reopen <id>` |
| Epic progress | `/linear:epic` (a.k.a. `linear issues epic-status`) |
| Health snapshot | `/linear:stats` |
| Record a decision | `/linear:decision record` |
| Audit log an interaction | `/linear:audit record` |
| Bulk-create from a file | `/linear:import <file>` |

## Conventions

- **Priority**: `1=urgent`, `2=high`, `3=medium`, `4=low` (Linear uses 0 for "no priority", but the CLI exposes 1-4 in arg parsing).
- **Type**: encoded as `type:<value>` labels (`type:bug`, `type:feature`, ...). `/linear:list -t bug` filters transparently.
- **Status categories**: `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`, and `duplicate`. Per-team workflow-state names are queried via `linear issues statuses --team <team>`.
- **Relations**: `blocks` / `blocked-by` (hard, affect `ready`/`blocked`), `relates-to` (soft), `duplicate-of` (often used with `linear duplicate`).
- **Default team**: set once with `linear config set default-team <key>` so verbs that need a team can omit `--team`.

## Output modes

- **Text (default)**: columnar layout, tree characters, footer summaries.
- **`--json`**: structured envelope; the data itself (no `{ok, data}` wrapper). Paginated list verbs (`list`, `teams list`, etc.) return `{nodes, pageInfo}`; filtered view verbs (`ready`, `blocked`) return raw arrays; detail verbs (`show`) return objects. Use `jq '.nodes[]'` for paginated pipelines and `jq '.[]'` for view-verb pipelines.

## See also

- `/linear:prime` — workspace-aware agent context (run me at SessionStart)
- `/linear:quickstart` — short tutorial pointer
- `/linear:init` — first-run setup
- `linear usage` — full per-domain CLI reference
