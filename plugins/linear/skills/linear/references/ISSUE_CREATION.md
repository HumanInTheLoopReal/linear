# Issue Creation

## Creation gate

Creating an issue commits shared attention. Do not create one merely because an agent
noticed something.

Before creation, answer:

1. What approved outcome does this advance?
2. Where is its parent or project-level exception?
3. Why must it be durable and independently resumable?
4. Why now?
5. Who is authorized to create it?
6. Is an equivalent issue already open?

If those answers are missing, record a finding and request triage.

## Who may create what

| Actor | Authorized creation |
|---|---|
| Human / planner | Projects, capabilities, approved leaves, promoted findings |
| Outer controller | Pre-approved leaves from an approved plan or campaign |
| Execution worker | Necessary child beneath its assigned issue |
| Reviewer | Normally none; return findings to the current issue/PR |
| Any agent | Emergency incident when repository policy permits it |

An execution worker never creates unrelated siblings or top-level work on its own.

## Search first

Search open and recently completed issues using the title, behavior, affected surface,
and broken rule. If an existing issue covers the outcome:

- update or relate it;
- append new evidence if material;
- do not create a duplicate with narrower wording.

## Required issue contract

Use the repository's configured template. At minimum include:

### Context

- the observable problem or outcome;
- upstream capability/document/issue;
- why it matters now;
- relevant location without dumping the entire project.

### Acceptance Criteria

- observable, verifiable outcomes;
- scope boundaries;
- stop/escalation condition when the agent must not improvise.

### Test Plan

- literal automated commands where possible;
- required human actions for visual/product judgment;
- integration or production verification when relevant.

Keep implementation choices in a Design section when they are actual decisions, not
in acceptance criteria.

## Create the correct object

- **Approved product work:** child of its capability.
- **Required decomposition:** child of the current issue.
- **Blocking incident:** incident/bug with a blocker relation.
- **Decision:** decision record under the project's decision log.
- **Research:** Document unless it has an independently approvable deliverable.
- **Unrelated discovery:** finding, not an issue.

## Mutation safety

- Confirm `linear where` before writing.
- Use explicit team/project/parent when repository defaults are not proven.
- Use `--dry-run` for complex creates.
- Keep validation enabled.
- Re-read the created issue and verify placement, state, owner, and relations.
- Do not bulk-create until the decomposition has been reviewed or is covered by an
  explicitly authorized campaign.
