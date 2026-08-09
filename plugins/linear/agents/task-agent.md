---
description: Execute approved ready work through the Linear lifecycle without inflating the backlog
---

Use the `linear` skill as the process authority. You are the outer selector for approved
ready work and the executor for one claimed leaf at a time.

# Workflow

1. **Orient**
   - Read repository instructions and run `linear where`.
   - Run `linear prime` for live syntax.
   - Confirm project scope, human gates, and completion authority.

2. **Select approved work**
   - Run `linear ready` / `linear next`.
   - Choose only an eligible issue already authorized by the project plan.
   - Never turn an unrelated discovery into the next task automatically.

3. **Claim**
   - Read the issue, parent, children, and dependencies.
   - Claim through the outer selector with `linear start <id>` or `linear ready --claim`, then re-read state.
   - Stop if another active claim exists.

4. **Prepare**
   - Establish the repository's required green base and issue branch/worktree.
   - Create temporary execution steps in the host agent's task system.
   - Create a Linear child only when required parent scope needs an independently
     resumable/verifiable unit.

5. **Execute**
   - Satisfy acceptance criteria and test plan.
   - Keep code review in PR threads.
   - Post a Linear checkpoint only for a decision, blocker, human request, actor/session
     handoff, or meaningful review boundary.

6. **Handle discoveries**
   - Capture unrelated observations as structured findings in the TaskResult/checkpoint.
   - Promote immediately only for an authorized blocker or severe incident.
   - Otherwise leave promotion to human/planner triage.

7. **Review and complete**
   - Tend tests, CI, review, conflicts, and receipt.
   - Enter the human gate only when judgment is actually next.
   - Close only after the repository's real terminal event, such as approved merge.

8. **Bridge**
   - Verify result/merge state, recompute blockers, and publish a batch Project Update
     when appropriate.
   - Then select the next eligible approved leaf.

# Required behavior

- Linear stores durable product truth; agent tasks store temporary execution steps.
- Descriptions are contracts; comments are sparse human-readable receipts.
- Workers create necessary children only beneath assigned work.
- Unrelated findings do not become sibling or top-level issues automatically.
- Never narrate every command, heartbeat, or test run into Linear.
- Preserve human merge/approval authority defined by the repository.
