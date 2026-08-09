# Multi-agent Authority

## Roles

### Human / accountable owner

- approves product scope and promoted findings;
- makes designated judgment calls;
- owns merge when repository policy requires it;
- remains the Linear assignee when the workspace models accountability rather than
  executor identity.

### Outer controller / selector

- reads project state and eligible work;
- selects and claims one leaf per worker;
- prevents duplicate claims;
- owns cross-leaf promotion, bridge processing, and Project Updates;
- stops when no eligible work can progress without human judgment.
- checks likely touched surfaces, shared schemas/configuration, migration order, and
  integration order before dispatching work in parallel; serializes uncertain overlap.

### Execution worker

- receives one assigned issue;
- may update that issue;
- may create necessary children beneath it;
- uses agent tasks for microsteps;
- returns a structured result, findings, and next action;
- never self-promotes unrelated discoveries into the backlog.
- returns new-child and human-request events to the controller for assignment and
  project-level reporting.

### Reviewer

- reviews the specified result independently;
- writes code findings on the PR;
- returns required repair to the same workflow;
- reports unrelated findings for triage rather than opening arbitrary work.

## Linear mutation ownership

Prefer one writer per issue at a time. Use race-safe checklist/description operations.
Agent-to-agent coordination belongs in the host's team/task messages, not a flood of
Linear comments.

## Claim discipline

- One selector owns ready-work selection for a loop.
- A worker validates its claim before changing code.
- If another active claim exists, stop and notify the controller.
- The current CLI does not have compare-and-swap claim semantics; keep one selector.
- Do not spawn parallel workers merely to create many issues.

## Newly created child ownership

A worker may create a necessary child, but creation does not grant a new assignment.
The controller must either:

- assign the child back to that worker and explicitly authorize it to continue; or
- place it in the eligible queue and select another worker.

The worker may keep executing the parent workflow without a separate claim only when
the child is a durable checkpoint inside the same parent branch/PR and the controller's
original assignment explicitly covered it.

## Parallel merge safety

Issue independence is not code independence. Before parallel dispatch, compare likely
ownership of files/modules, public contracts, generated artifacts, migrations, and
shared configuration. If two leaves can invalidate each other's base or proof, define
an integration order or run them serially. Do not invent blocker edges solely as a
worker-locking mechanism.

## Identity and provenance

When agents share a human Linear account, status represents workflow and the branch,
PR, receipt, and optional structured actor field represent execution provenance. Do
not pretend the authenticated human manually performed every operation.

When a dedicated agent account is available, keep human accountability and agent
execution distinct rather than changing assignees on every phase unless the workspace
explicitly chooses that model.

## Structured worker result

Return a stable result such as:

```yaml
task_id: ENG-42
branch: eng-42-keyboard-navigation
commits: [abc123]
pr_url: https://...
summary: Keyboard navigation implemented and verified
checks: [unit, typecheck, ci]
decisions: []
findings: []
next: Await human review
```

Use this result to render the PR body, Linear receipt, and controller bridge decision.
