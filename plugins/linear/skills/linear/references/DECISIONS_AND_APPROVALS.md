# Decisions and Approvals

## One record per judgment

Do not create both a decision issue, a human gate, and a generic approval task for the
same judgment. The record whose outcome changes product scope is authoritative.

## Pending decision request

Use one project-linked decision issue in the workspace's `Needs Human` / human-review
state. A pending request contains:

```markdown
## Question
The one choice the human must make.

## Options
- Option A: consequence and evidence.
- Option B: consequence and evidence.

## Recommendation
The recommended choice and why.

## Affects
Candidate capabilities, leaves, documents, or releases blocked by the choice.

## Next
What approval and rejection each unlocks.
```

Use the workspace decision label (commonly `type:decision`). State distinguishes an
unresolved request from a settled decision. Do not invoke `linear decision record` for
an unresolved choice because that command records a decision already made.

At creation, explicitly associate the request with the Project, apply the decision
label, and re-read it to verify project, state, owner, and affected links. Do not rely
on a workspace-global label alone to make the request visible in the Project.

## Resolve the same record

When the human decides:

1. preserve the selected option and rationale in the same issue;
2. rewrite/complete it using the recorded-decision sections: Decision, Rationale,
   Alternatives Considered, and Affects;
3. link affected work;
4. transition the issue according to workspace policy;
5. let the planner promote only the scope the decision actually approved.

Do not create a second settled-decision issue unless workspace policy explicitly uses
immutable request and decision records.

## When an async gate is appropriate

A `linear:gate` issue is an orchestration primitive for a durable external waiter such
as a timer, CI run, PR event, or an approval that has no existing authoritative issue.
Use it only when the controller must poll/resolve that condition across sessions.

- If a leaf issue already waits for review/merge, its state plus PR is the gate.
- If a decision request already waits for a human, that issue is the gate.
- Never create an async gate merely to make the same request visible twice.

## Worker and controller responsibilities

Workers return human requests in their structured result and keep the affected issue in
the correct state. The outer controller owns the Needs Human view and Project Update.
Workers notify the controller; they do not publish project-wide summaries themselves.
