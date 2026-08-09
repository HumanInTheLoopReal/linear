# Communication

## Channel ownership

| Channel | Direction and purpose |
|---|---|
| Issue description | Durable work contract |
| Issue comment | Agent -> human receipt, decision, blocker, request, or handoff |
| Document comment | Human -> agent feedback on a durable document |
| PR thread | Reviewer -> implementation feedback and repair discussion |
| Project Update | Outer controller -> human batch summary |
| Agent task/message system | Temporary execution and agent-to-agent coordination |

Do not mirror the same conversation across channels.

Do not mirror the same checkpoint across a parent and child either. Post the detailed
handoff on the issue that owns the execution branch/PR; update the parent only when its
integration state or next action materially changes. Workers return Project Update
inputs to the outer controller rather than publishing project-wide summaries directly.

## What deserves an issue comment

Post when:

- work reaches the human review gate;
- a durable decision changes implementation;
- the issue is blocked;
- human judgment is needed;
- a session or actor hands off incomplete work;
- a meaningful batch of findings needs triage;
- the issue completes.

Do not comment for routine state transitions, commands, every test run, heartbeats, or
minute-by-minute progress. Linear already records state history.

## Checkpoint template

```markdown
## Checkpoint

### Outcome
- What now works or has been decided.

### Evidence
- Branch/commit/PR links.
- Tests or artifacts that prove the state.

### Callouts
- Decisions, findings, blockers, or human questions.

### Next
- The exact next durable action.
```

Update with a new checkpoint only when the prior one is materially stale. Prefer one
complete handoff over a stream of partial notes.

## Completion receipt

```markdown
## Completion

### Delivered
- Observable outcome.

### Evidence
- PR and merge commit.
- Required checks and human verification.

### Decisions
- Durable decisions made while executing, or `None`.

### Findings
- Promoted/parked/dismissed summary, or `None`.

### Next
- Newly unblocked work or `No follow-up`.
```

Generate the PR body and Linear receipt from the same structured task result when
possible so they cannot disagree.

## Human requests

State:

- exactly what judgment is needed;
- the smallest evidence set required;
- the consequence of approve/reject;
- whether independent work can continue while this waits.

Use the repository's human-review status/label and Project Update summary so the human
can find requests without reading every active issue.
