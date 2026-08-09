# Workflows

Load the specific process reference named in each workflow before mutating Linear.
Use `linear prime` and `linear <command> --help` for current syntax.

## Plan approved work

Read [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) and
[ISSUE_CREATION.md](ISSUE_CREATION.md).

1. Confirm the Project front door and approved scope.
2. Keep unapproved candidates in research/findings intake and resolve required human
   decisions.
3. Create or update human-readable capability parents for approved outcomes.
4. Decompose only approved scope into bounded leaves.
5. Add blocker relations only where work literally cannot proceed.
6. Review the graph for orphans, duplicates, and unparented implementation work.
7. Promote only the first eligible slice to ready work when the project uses staged
   release of tasks.

## Execute one leaf

Read [ISSUE_LIFECYCLE.md](ISSUE_LIFECYCLE.md),
[SUBISSUES_AND_AGENT_TASKS.md](SUBISSUES_AND_AGENT_TASKS.md), and
[GIT_AND_REVIEW.md](GIT_AND_REVIEW.md).

1. Receive/select an eligible approved leaf.
2. Read the issue, parent, relations, and repository instructions.
3. Claim through the single selector and confirm state.
4. Prepare a green base plus issue branch/worktree.
5. Create only justified durable child issues; return them to the controller for
   assignment unless the original assignment explicitly covered same-PR decomposition.
6. Create temporary agent tasks for immediate actions.
7. Implement, test, verify, review, and repair.
8. Capture unrelated discoveries as findings.
9. Tend the PR until the human gate is truly ready.
10. Merge/close according to authority, post the receipt, then return control to the
    outer controller.

## Split unexpectedly complex work

1. Re-read the parent's acceptance criteria.
2. Separate required scope from newly discovered unrelated scope.
3. Keep reconstructable actions in agent tasks.
4. Create a child only for a required independently resumable/verifiable outcome.
5. Set the parent. Add a blocker relation only when another issue's readiness must
   literally wait on this child.
6. Post one checkpoint explaining the split and next action.

## Handle a discovery

Read [FINDINGS_AND_TRIAGE.md](FINDINGS_AND_TRIAGE.md).

1. Capture title, kind, severity, location, evidence, impact, and recommendation.
2. Determine whether it blocks the current contract or qualifies as an emergency.
3. If not, batch it with other findings and continue authorized work.
4. At triage, promote, combine, child, park, dismiss, or fix inline.
5. Only promoted findings become backlog issues.

## Ask for human judgment

Read [COMMUNICATION.md](COMMUNICATION.md).

1. Keep the issue in the workspace's human-review state/label.
2. State the exact decision and smallest useful evidence set.
3. Explain approve/reject consequences.
4. Link the PR/document/artifact where judgment occurs.
5. Return the request to the outer controller for the next Project Update.
6. Continue independent work; stop only when nothing eligible can progress.

## Resume after session loss

Read [RESUMABILITY.md](RESUMABILITY.md).

1. Locate the assigned active issue.
2. Read contract, hierarchy, checkpoint, Git, PR, and CI.
3. Verify current state.
4. Reconstruct temporary tasks.
5. Continue from the recorded `Next` action.

## Publish a batch Project Update

The outer controller summarizes decisions and outcomes, not events:

```text
Completed: N
Awaiting human: N
Active: N
Blocked: N
Findings captured: N
Findings promoted: N
Next eligible slice: <link or none>
```

Post at meaningful wake/batch boundaries. Do not force the human to open every issue
receipt to understand the project.
