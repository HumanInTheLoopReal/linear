# Findings and Triage

## Discovery is not commitment

During execution, agents will notice bugs, debt, inconsistencies, opportunities, and
possible refactors. Preserve the information without automatically inflating the
approved backlog.

## Capture format

Accumulate findings in the current TaskResult, handoff, audit report, or one batched
checkpoint on the current issue:

```yaml
findings:
  - title: Tooltip surface bypasses the radius role
    kind: bug
    severity: low
    location: app/src/.../tooltip.tsx
    evidence: Uses a raw radius where the project rule requires a role token
    impact: Visual inconsistency; no current-task blocker
    recommendation: Combine with the design-system cleanup
```

Do not post one comment per finding. Do not create one top-level issue per finding.

## Immediate promotion exceptions

An authorized agent may create an issue immediately when the finding:

- blocks the current acceptance criteria;
- is a security, privacy, correctness, or data-loss incident;
- risks corrupting the repository or production state;
- belongs to an explicitly approved campaign whose rules authorize creation.

Create it in the correct hierarchy, relate/block the current issue, and state the
promotion reason.

## Triage outcomes

For each finding, the human or authorized planner chooses:

- **Promote:** create an approved issue under a capability.
- **Combine:** add evidence to an existing issue or campaign.
- **Child:** create beneath the current issue because it is required scope.
- **Park:** preserve in the audit/findings record for a future release.
- **Dismiss:** record why no action is warranted.
- **Fix inline:** only when the current contract or an explicit campaign/human rule
  pre-authorizes cleanup in that exact surface, the correction cannot change behavior,
  and existing gates prove it. Otherwise preserve it as a finding even if the edit
  looks trivial.

## Promotion contract

A promoted finding records:

- its source issue/audit;
- why it was promoted now;
- the parent capability;
- acceptance criteria and test plan;
- priority and owner;
- whether it blocks current work.

## Batch audits

An audit should normally produce:

1. one human-readable report or campaign receipt;
2. a categorized findings list;
3. a small set of promoted issues after triage.

The number of observations is not the number of backlog issues. Measure the audit by
decision quality and risk coverage, not by ticket volume.
