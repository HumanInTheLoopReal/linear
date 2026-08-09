# Resumability

## Resume from authoritative state

A fresh agent resumes from:

- the Linear issue contract and latest durable checkpoint;
- parent/children/dependency state;
- the issue branch/worktree and commits;
- the PR and CI state;
- tests and generated artifacts.

It does not need the previous agent's full transcript or temporary task list.

To catch up on one issue, `linear issues activity <id>` returns comments and
history events as a single newest-first timeline, so "what changed since the
last checkpoint" is one call rather than a manual merge of `issues comments`
and `issues history`. Linear writes history asynchronously; a very recent
transition may not have landed yet, so trust the issue's current state over
the absence of an event.

## Durable checkpoint threshold

Write a checkpoint when:

- a session or context is ending with incomplete work;
- responsibility changes actor;
- a material decision changes the path;
- work becomes blocked;
- human judgment is required;
- a sub-issue reaches a meaningful boundary.

Do not write heartbeats, command logs, or one checkpoint after every edit.

## Checkpoint contents

```markdown
## Checkpoint

### Outcome
- What works now.

### Evidence
- Branch, commit, PR, tests, artifacts.

### Decisions
- Durable choices and rationale.

### Findings
- Batched unapproved discoveries, if any.

### Next
- Exact next durable action.

### Blockers
- None, or what must change and who owns it.
```

The branch/commit makes code durable. Linear explains why that code exists, its state,
and what follows. Do not paste working source code or large test output into comments
when a repository/CI link is the authoritative evidence.

## Recovery procedure

1. Run `linear where` and `linear prime`.
2. Find the assigned In Progress issue or receive it from the controller.
3. Read the issue, parent, children, blockers, and latest checkpoint.
4. Inspect the referenced branch/worktree, commits, PR, and CI.
5. Verify the repository state rather than trusting the receipt blindly.
6. Reconstruct temporary agent tasks from `Next` and the acceptance criteria.
7. Continue without reopening already-settled decisions.

## Resume quality test

A fresh agent should be able to answer:

- What outcome is required?
- What has been durably completed?
- What decision constrains the implementation?
- What is currently blocked or awaiting a human?
- What exact action comes next?
- Where is the code and evidence?

If not, add one concise checkpoint. Do not compensate by preserving every internal
step.
