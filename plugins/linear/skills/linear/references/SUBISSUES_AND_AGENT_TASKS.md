# Sub-issues and Agent Tasks

## The boundary

Use a Linear sub-issue for durable, independently resumable work required by the
parent. Use the agent task system for temporary steps used to execute that work.

```text
Temporary action?
  -> agent task

Required by parent and independently resumable/verifiable?
  -> Linear sub-issue

Unrelated to parent scope?
  -> finding for triage
```

## Create a sub-issue when

At least one is true:

- it may cross a context/session boundary;
- another actor can own it independently;
- it has a separate blocker or dependency;
- it produces its own verifiable outcome;
- it needs a durable checkpoint before the parent can continue;
- failure or completion materially changes the parent's next action.

It must still be necessary to satisfy the parent's existing acceptance criteria.

Creating a child does not assign it. Return it to the outer controller unless the
original assignment explicitly authorizes same-worker, same-branch decomposition.
Parent-child containment also does not require a `blocks` relation; add one only when
another issue's ready state must literally wait on the child.

## Keep it as an agent task when

- it is a command, file inspection, edit, test run, or review request;
- it can be reconstructed from the issue and repository state;
- it has no independent outcome or ownership;
- losing it would be inconvenient but would not lose a decision or product state.

Examples:

```text
Linear sub-issue: Implement keyboard navigation state
Agent tasks:
  - inspect the existing store
  - locate keyboard handlers
  - write the failing test
  - update the reducer
  - run focused tests
```

## Avoid mechanical phase children

Do not automatically create `Research`, `Plan`, `Implement`, `Test`, `Review`, and
`Fix` sub-issues for every task. Those are workflow phases and clean-context jobs,
not automatically durable project objects.

Promote a phase into a sub-issue only when its result needs independent ownership,
approval, blocking, resume, or evidence.

## Parent completion

The parent remains active while required children are active. Complete the parent
only when:

- required children are complete;
- parent-level acceptance criteria pass;
- integration/review is resolved;
- the repository's merge and human-gate rules are satisfied;
- the parent carries a concise final receipt.

Do not mechanically close a parent merely because every child is closed when the
integrated outcome has not been verified.
