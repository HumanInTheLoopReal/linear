# Process Patterns

## Good: strategic Linear, tactical agent tasks

```text
ENG-42 Add keyboard navigation
  ENG-43 Implement navigation state      <- durable child

Agent tasks while executing ENG-43:
  inspect store
  write failing test
  update reducer
  run focused tests
```

The child survives a context loss. The microsteps do not pollute the backlog.

## Good: discovery waits for triage

While working on ENG-43, the agent notices an unrelated tooltip radius problem. It
adds one structured finding to the handoff. The planner later combines it with an
approved design-system cleanup. No spontaneous top-level issue appears.

## Good: immediate incident

The test suite corrupts the real repository Git configuration. Repository policy
permits incident creation, so the agent creates an urgent bug, relates it as a blocker,
records the promotion reason, and stops affected execution.

## Good: authorized campaign dashboard

A human explicitly asks for one phone-visible campaign issue with a component
checklist. The issue is a dashboard exception with a named owner, update cadence, and
exit condition. Agent-to-agent coordination still stays in the agent runtime; Linear
receives batch checkpoints rather than hundreds of root comments.

## Bad: discovery becomes commitment

An audit finds 40 minor inconsistencies and immediately creates 40 top-level backlog
issues. Each issue is individually accurate, but the board no longer communicates
priority or approved product intent.

Correct response: one report, categorized findings, then a small triaged promotion
set.

## Bad: mechanical workflow children

Every leaf receives `Research`, `Plan`, `Implement`, `Test`, and `Review` sub-issues.
The hierarchy records process ceremony rather than independently resumable outcomes.

Correct response: use clean agent contexts/tasks for phases; create a sub-issue only
when a phase produces an independent durable boundary.

## Bad: Linear as an event log

The agent posts comments for claim, file read, edit, test start, test failure, repair,
test pass, commit, push, and branch cleanup.

Correct response: rely on native activity/Git/CI and post one meaningful checkpoint or
completion receipt.
