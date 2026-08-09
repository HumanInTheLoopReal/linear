# Project Structure

## Start with the project front door

Use one Linear Project for one durable product or bounded initiative. Keep its native
Overview/content current with:

- the outcome and measurable success;
- current scope and exclusions;
- canonical Documents and repository links;
- the current release or active slice;
- the status and next human decision.

Do not mirror live issue status into a checked-in document. Store stable identifiers
and links in repository documentation; query Linear for live state.

## Recommended hierarchy

```text
Project
├── Documents: Overview, Requirements, Architecture, research
├── Decision Log
│   └── Decision issues
├── Capability: <observable outcome>
│   ├── Approved leaf
│   │   └── Optional durable sub-issues
│   └── Approved leaf
└── Foundations / release work when needed
```

### Project

Carries the long-lived product container, human front door, high-level status, and
project updates.

### Capability / epic

Carries a human-readable promise. It groups related implementation leaves and may
outlive a release. Do not use an epic as a giant agent checklist or event log.

### Leaf issue

Carries one approved, bounded workflow that can be reviewed as a coherent result.
Repositories may use one branch and one PR per leaf.

### Sub-issue

Carries a required part of a leaf only when independent resume, ownership, blocking,
or evidence justifies durable state. Never create generic `Plan`, `Code`, `Test`, and
`Review` children by habit.

### Finding

Is not yet backlog work. Keep it in the current TaskResult/checkpoint, an audit
report, or the project's triage intake until promotion.

## Placement rules

- Require a parent for ordinary planned implementation work.
- Permit parentless records only for project-level deliverables, decisions,
  incidents, or explicitly approved exceptions.
- Use native parent/child structure for containment and relations only for real
  dependency or provenance.
- Add a blocker edge only when the downstream work literally cannot start or finish.
- Keep capabilities human-readable; keep implementation detail in their leaves.
- Avoid making every release, label, milestone, and cycle mandatory. Use each only
  when it answers a real planning question.

## Views for human comprehension

Prefer views that separate:

1. product map - capabilities and approved work;
2. active execution - In Progress / In Review / Blocked;
3. needs human - decisions and approvals;
4. findings intake - unpromoted discoveries;
5. recently completed - concise merged receipts.

An explicitly authorized campaign dashboard may use one issue with a checklist for
phone-visible progress. Treat it as an exception with a named owner and exit rule,
not as the default representation for ordinary work.

## Initiative intake before scope approval

Approval to explore or start an initiative authorizes the Project front door, research
Documents/findings intake, and necessary decision requests. It does not automatically
approve every candidate capability or proposed implementation item.

Keep candidates in the research/triage document until the human approves scope. Then
create only the selected capabilities and their first eligible leaves. This preserves
the difference between `we are pursuing this idea` and `all proposed work is committed`.
