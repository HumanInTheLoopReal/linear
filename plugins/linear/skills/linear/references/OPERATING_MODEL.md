# Linear Operating Model

## Purpose

Linear is the durable coordination boundary between humans and agents. It records
product intent, approved work, decisions, dependencies, ownership, review gates,
resumable execution state, and concise evidence.

Linear is not:

- a transcript of an agent's reasoning;
- a command log;
- a replacement for Git, CI, or PR review;
- a database of every observation made during an audit;
- the host agent's temporary task list.

Linear plus Git, CI, and the host's task system already cover every row below. Adding
Notion, Craft, or a second tracker on top splits the durable record and creates a
second place to keep in sync.

## Information ownership

| Information | Authoritative home |
|---|---|
| Product goal, capability, approved work | Linear |
| Status, priority, assignee, dependency, human gate | Linear |
| Durable decision and next action | Linear |
| Temporary execution steps | Agent task system |
| Code and commits | Git |
| Review findings and repair discussion | PR threads |
| Test/build evidence | CI and test artifacts, linked from Linear |
| Unapproved discoveries | Structured findings awaiting triage |

Do not duplicate an authoritative record merely to make it visible elsewhere. Link
to it and summarize the consequence.

Route by what is lost, not by how long the work takes. A decision reached in five
minutes can belong in Linear; two days of mechanical commands can belong in the task
system. Ask whether losing the record would lose shared product state or an
independently resumable boundary — if it would, Linear owns it.

## Three durable work levels

```text
Project
  -> Capability / epic: human-readable outcome
       -> Issue / leaf: approved independently reviewable workflow
            -> Sub-issue: independently resumable part required by that workflow
```

Not every project needs all three levels. Preserve the distinction even when a
small project collapses a level.

## Three kinds of execution information

### Durable contract

Belongs in the issue description:

- why the work exists;
- observable acceptance criteria;
- verification;
- parent/upstream links;
- scope and stop/escalation conditions.

### Durable checkpoint

Belongs in a sparse issue comment when a session, actor, or decision boundary is
crossed:

- outcome so far;
- decisions;
- branch/commit/PR/test evidence;
- blocker or human request;
- exact next action.

### Ephemeral execution

Belongs in Claude tasks, Codex plans, TodoWrite, or equivalent:

- inspect file;
- run test;
- edit function;
- compare output;
- ask reviewer;
- rerun gate.

Ephemeral steps may disappear. The contract, durable checkpoint, Git state, and
tests must still let a fresh agent resume.

## Creation is a commitment gate

An observation becomes a Linear issue only when at least one is true:

- the human or planning process approved it;
- it is required to satisfy an existing issue's acceptance criteria;
- it is a blocker that must be resolved independently;
- it is a correctness, security, privacy, or data-loss incident;
- it falls inside an explicitly authorized campaign with defined creation rules.

Otherwise it remains a finding until triage.

## The human test

Optimize default views for decisions and outcomes, not agent volume. A human should
not need to read hundreds of comments or same-day micro-issues to understand the
project. Use project/capability hierarchy, sparse receipts, project updates, and a
separate findings intake so the main backlog remains intentional.
