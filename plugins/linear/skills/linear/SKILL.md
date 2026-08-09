---
name: linear
description: Operate Linear as the durable human-agent project system, including project structure, issue creation, sub-issue decomposition, lifecycle state, findings triage, resumable checkpoints, human approvals, Git and PR linkage, and multi-agent coordination. Use for any Linear read or mutation, when deciding whether work belongs in Linear or an agent task system, when planning or executing tracked work, and for any `linear` CLI invocation.
metadata:
  version: "2026.8.1"
---

# Linear

Treat Linear as shared product truth, not agent working memory. Preserve decisions,
approved outcomes, durable resumable work, human gates, and what happens next. Keep
temporary execution steps in the host agent's task system.

## Start here

1. Read the repository's `AGENTS.md` / `CLAUDE.md` and, if present,
   `.linear/config.json`.
   Project-specific team, project, status, assignee, and approval rules override
   generic examples in this skill.
2. Run `linear where` to confirm the active workspace, viewer, scope, team, and
   project before a mutation.
3. Run `linear prime` for the live CLI surface. Use `linear <command> --help` for
   exact syntax. This skill owns process judgment; `prime` and `--help` own command
   syntax.
   Read a full record before acting, but keep what you carry small: the global
   `--fields <dot-paths>` and `--compact` flags trim any JSON envelope at the
   source, which is cheaper than reading everything and discarding most of it.
4. Read [OPERATING_MODEL.md](references/OPERATING_MODEL.md) before designing or
   changing a workflow.
5. Load only the task-relevant references from the router below.

## Non-negotiable invariants

- Creating an issue commits the shared backlog. Discovery alone is not commitment.
- Use Linear for durable outcomes and independently resumable units. Use Claude
  tasks, Codex plans, TodoWrite, or equivalent for temporary steps.
- An execution worker may update its assigned issue and may create a necessary
  child beneath it. It may not create unrelated siblings or top-level backlog work.
- Record unrelated discoveries as structured findings. Promote them only through
  the triage rules or an explicit emergency exception.
- Descriptions are contracts. Comments are sparse receipts, decisions, blockers,
  human requests, and handoffs - never command-by-command narration.
- Keep code review and CI discussion on the PR. Link it from Linear; do not mirror it.
- A task is not Done merely because code exists. Follow the repository's merge and
  human-approval policy.
- Prefer one authoritative record over duplicated state across issues, comments,
  documents, Git, and PRs.
- Domain skills may define which artifacts, relations, and gates they own; this
  skill owns how those records are discovered and operated. Do not clone the
  CLI process into every domain skill or require a checked-in Linear routing
  document when project configuration and live discovery are sufficient.

## Classify before writing

```text
Temporary action needed only while executing?
  -> agent task system

Durable work required by the current issue's acceptance criteria?
  -> existing issue, or a child issue if it needs independent resume/evidence

Unrelated work merely noticed during execution?
  -> finding on the current task result / checkpoint; triage later

Approved product outcome, incident, or promoted finding?
  -> Linear issue in the correct project hierarchy
```

If uncertain, do not create a top-level issue. Record the finding and request
triage.

## Reference router

| Need | Read |
|---|---|
| Decide what Linear should contain | [OPERATING_MODEL.md](references/OPERATING_MODEL.md) |
| Create or organize a project | [PROJECT_STRUCTURE.md](references/PROJECT_STRUCTURE.md) |
| Decide whether and how to create an issue | [ISSUE_CREATION.md](references/ISSUE_CREATION.md) |
| Split a task into durable children vs agent todos | [SUBISSUES_AND_AGENT_TASKS.md](references/SUBISSUES_AND_AGENT_TASKS.md) |
| Move an issue from ready work through completion | [ISSUE_LIFECYCLE.md](references/ISSUE_LIFECYCLE.md) |
| Handle newly discovered work | [FINDINGS_AND_TRIAGE.md](references/FINDINGS_AND_TRIAGE.md) |
| Request or record a human product decision | [DECISIONS_AND_APPROVALS.md](references/DECISIONS_AND_APPROVALS.md) |
| Write descriptions, checkpoints, receipts, and human requests | [COMMUNICATION.md](references/COMMUNICATION.md) |
| Create, revise, or review a Linear Document | [DOCUMENTS.md](references/DOCUMENTS.md) |
| Connect branches, commits, PRs, CI, review, and merge | [GIT_AND_REVIEW.md](references/GIT_AND_REVIEW.md) |
| Make work survive session loss or agent handoff | [RESUMABILITY.md](references/RESUMABILITY.md) |
| Coordinate selectors, workers, reviewers, and humans | [MULTI_AGENT.md](references/MULTI_AGENT.md) |
| Run concrete end-to-end procedures | [WORKFLOWS.md](references/WORKFLOWS.md) |
| Use dependencies and ready-work selection | [DEPENDENCIES.md](resources/DEPENDENCIES.md) |
| Diagnose auth or command failures | [TROUBLESHOOTING.md](resources/TROUBLESHOOTING.md) |
| Park work on CI, a PR, a timer, or a human approval | [ASYNC_GATES.md](resources/ASYNC_GATES.md) |
| Pour a repeatable sub-issue tree from a template | [MOLECULES.md](resources/MOLECULES.md) |
| Give a task its own Git worktree | [WORKTREES.md](resources/WORKTREES.md) |
| Compare a process shape against worked good and bad examples | [PATTERNS.md](resources/PATTERNS.md) |
| Decide where reference data lives when it is not issue work | [STATIC_DATA.md](resources/STATIC_DATA.md) |
| Survey the command surface when `prime` is unavailable | [CLI_REFERENCE.md](resources/CLI_REFERENCE.md) |

Any other file under `resources/` is a compatibility pointer to the reference that
now owns the topic. Follow the pointer rather than reading it as guidance.

## Safe mutation protocol

Before every create, update, comment, or close:

1. Read the target and its parent/current relations.
2. Confirm the mutation is authorized for this actor.
3. Search before creating; prefer updating or relating an existing record.
4. Preview complex creation with `--dry-run` when supported.
5. After checking live help, use the CLI's supported section updates or guarded
   pull/edit/push flow instead of blind whole-description replacement.
6. Re-read the result after a consequential mutation.

Never use `--no-validate`, `--force`, delete, archive, bulk create, or bulk close to
bypass a process failure unless the user explicitly authorizes that exception.

## Human-facing quality test

Before leaving Linear, ask whether a human opening the project can quickly answer:

- What outcome are we pursuing?
- What is active, blocked, or awaiting my judgment?
- What decision was made and why?
- What durable work remains?
- What happens next?

If the answer requires reconstructing an agent's command log, compress the record.

## Version check

If `linear --version` reports a release newer than `2026.8.1`, use `linear prime` and
`linear <command> --help` as the live syntax source, then check whether this process
skill needs a compatibility update.
