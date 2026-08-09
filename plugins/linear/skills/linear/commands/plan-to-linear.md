---
description: Turn an approved plan into a Linear epic with parented children and dependency edges
argument-hint: <plan-file|-> [--team]
---

Take a plan that a human has already approved and land it in Linear as one epic,
one child per unit of work, and the blocking edges between them.

The plan is not the authority; the approval is. Before writing anything, apply
[the creation gate](../references/ISSUE_CREATION.md). A plan an agent drafted and
nobody signed off on is a finding, not a backlog. If you are unsure whether the
plan was approved, ask rather than create.

This command has no verb of its own. It reads the plan, produces a children
spec, and hands that to `linear epic create`, which creates the epic, parents
every child under it, and wires the dependency edges in a single call.

## The translation

Read the plan and decide three things:

| From the plan | Becomes |
|---|---|
| The outcome the plan delivers | the epic title |
| Each step that can be finished and verified on its own | one child issue |
| "do X before Y" ordering | `blocked_by` on the later child |

A step that cannot be resumed by a different agent tomorrow is not a child. Fold
it into its parent step and let the executing agent track it in the host task
system.

## The children spec

One JSON object per line. Only `title` is required.

| Field | Meaning |
|---|---|
| `title` | Child issue title. Required. |
| `description` | Markdown body. |
| `priority` | `0` to `4`. `0` is no priority, `1` is urgent, `4` is low. |
| `acceptance` | Appended to the body as `## Acceptance Criteria`. |
| `design` | Appended as `## Design`. |
| `notes` | Appended as `## Notes`. |
| `blocked_by` | Array of **other child titles in this same spec**, not issue IDs. |

`blocked_by` matches on title text, so the titles have to agree exactly between
the line that declares one and the line that references it.

## Running it

```bash
linear epic create "Ship passkey login" --team ENG --children-file plan.jsonl
```

Where `plan.jsonl` holds the translated plan:

```jsonl
{"title":"Add WebAuthn credential table","priority":2,"acceptance":"Migration applies and rolls back cleanly on a copy of prod."}
{"title":"Registration endpoint","priority":2,"blocked_by":["Add WebAuthn credential table"]}
{"title":"Authentication endpoint","priority":2,"blocked_by":["Add WebAuthn credential table"]}
{"title":"Browser flow behind a flag","priority":3,"blocked_by":["Registration endpoint","Authentication endpoint"]}
{"title":"Remove the password fallback","priority":4,"blocked_by":["Browser flow behind a flag"]}
```

Piping works too, which is useful when you generate the spec in the same
session rather than writing it to disk:

```bash
cat plan.jsonl | linear epic create "Ship passkey login" --team ENG --children -
```

Give the epic its own body when the plan has context worth keeping:

```bash
linear epic create "Ship passkey login" \
  --team ENG \
  --children-file plan.jsonl \
  --description "$(cat plan.md)"
```

## Read the spec before you run it

There is no dry run on `linear epic create`, and Linear has no client-side
transaction. If the call fails halfway, everything already created stays. So
check the spec first:

- Every `blocked_by` entry exactly matches another line's `title`.
- No cycles. A blocks B blocks A never becomes ready.
- Every child is something a fresh agent could pick up and finish.
- The team is right. Children inherit the epic's team; there are no cross-team
  children.

If the call does fail partway, the output lists every identifier that was
created. Clean up from that list rather than re-running the whole spec, which
would duplicate the children that succeeded.

## After

```bash
linear show <epic-id>        # confirm the epic body and children
linear dep tree <epic-id>    # confirm the edges point the way you meant
linear epic status --team ENG
```

Then hand out work through the normal path: `linear next` surfaces the children
whose blockers are already closed.

## Notes

- Running the same plan twice creates a second epic. Search before you pour.
- For a shape you land repeatedly, write it as a molecule template instead and
  use `/linear:molecules pour`. This command is for a one-off plan.
- `linear import` is a different tool. It bulk-creates flat issues from JSONL
  and does not do parent/child, so it cannot express a plan's structure.
- Required-section validation applies to the epic and every child. `--validate`
  forces it on and `--no-validate` skips it; skipping it needs the same explicit
  authorization as any other bypass.

## See also

- `/linear:epic` — status and close-eligible checks on the epic afterwards
- `/linear:molecules` — the same shape as a reusable template
- `/linear:dep` — repair or extend the edges later
- `/linear:create` — a single issue with no epic around it
