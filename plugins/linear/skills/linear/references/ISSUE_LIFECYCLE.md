# Issue Lifecycle

## State semantics

Map these semantic states to the workspace's actual status names:

```text
Backlog -> Ready -> In Progress -> Human Review -> Done
                         ^              |
                         |-- repair ----|

Blocked / Canceled / Superseded are explicit side paths.
```

Status carries where the work stands and whose judgment is next. Do not duplicate
routine state narration in comments.

## 1. Select

The outer controller or human selects eligible approved work. Workers do not invent
or self-select arbitrary backlog scope. Confirm:

- parent/capability and project placement;
- no active blockers;
- acceptance criteria and test plan are executable;
- required context is reachable;
- no conflicting active claim exists.

## 2. Claim

Claim and transition to the active state before code. Use an atomic CLI operation when
available. Re-read to confirm ownership/state. If claim atomicity is unavailable, one
selector must own selection to prevent duplicate workers.

## 3. Prepare

- start from the repository's required green base;
- create the issue branch/worktree;
- inspect current Git/PR/Linear state;
- create only justified durable sub-issues;
- create ephemeral agent tasks for immediate execution.

## 4. Execute

Run the repository's task workflow. Keep the issue contract stable; record only
material decisions, blockers, handoffs, and sparse checkpoints. Capture unrelated
discoveries as findings.

## 5. Review gate

Before moving to human review, require:

- acceptance criteria satisfied;
- tests and CI green;
- independent review completed where required;
- conflicts cleared;
- PR and receipt complete;
- explicit human question/action.

Opening a draft PR is not the human gate.

## 6. Repair

Changes requested return the issue to active work. Repair the same branch, update tests,
reply on PR threads with evidence, refresh the receipt, and re-enter review.

## 7. Complete

Respect the workspace's completion authority. If humans own approval/merge, agents do
not set Done early. Close with a concise reason only after the actual terminal event.

## 8. Bridge

After merge/completion:

- verify the merge/result state;
- clean the worktree according to policy;
- sync the base branch;
- check post-merge CI;
- recompute blockers/eligible work;
- publish a batch Project Update when appropriate;
- let the outer controller select the next leaf.

The worker that completed one leaf does not silently widen itself into the board
controller.
