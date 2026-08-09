# Linear Skill Maintenance Guide

## Architecture

`SKILL.md` is the process-first router. Keep it concise and put one maintainable
concern in each `references/*.md` file.

`linear prime`, `linear <command> --help`, and generated `USAGE.md` remain the sources
of truth for live CLI syntax. Do not duplicate flag/command manuals in the skill.

## File roles

| File | Owns |
|---|---|
| `SKILL.md` | Invariants, classification gate, reference router, mutation safety |
| `references/OPERATING_MODEL.md` | Durable-vs-ephemeral information boundary |
| `references/PROJECT_STRUCTURE.md` | Project/capability/leaf/sub-issue hierarchy |
| `references/ISSUE_CREATION.md` | Creation authority, contracts, and search gate |
| `references/SUBISSUES_AND_AGENT_TASKS.md` | Durable child vs temporary task decision |
| `references/ISSUE_LIFECYCLE.md` | Select through bridge state machine |
| `references/FINDINGS_AND_TRIAGE.md` | Discovery capture and promotion |
| `references/COMMUNICATION.md` | Contracts, checkpoints, receipts, human requests |
| `references/GIT_AND_REVIEW.md` | Git/PR/CI ownership and completion semantics |
| `references/RESUMABILITY.md` | Session-loss and handoff recovery |
| `references/MULTI_AGENT.md` | Selector, worker, reviewer, and human authority |
| `references/WORKFLOWS.md` | Concrete end-to-end procedures |
| `resources/*.md` | Advanced CLI concepts |

## Maintenance rules

- Put process judgment in references and exact command syntax in `prime`/`--help`.
- Avoid duplicating the same rule across references; link to its owner.
- Keep references one level below `SKILL.md`.
- Update `linear prime`, setup templates, and task-agent instructions whenever a
  process invariant affects their compact guidance.
- Keep plugin and non-plugin consumers identical. `linear setup agent-skill` installs
  the router, references, resources, and `agents/openai.yaml` from this canonical tree.
- Do not prepend the snapshot notice to the canonical `SKILL.md`; setup adds it only
  to `.agents/skills/linear/SKILL.md` consumers.

## Validation

```bash
/opt/homebrew/bin/python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  plugins/linear/skills/linear
npm run check:ci
npx tsc --noEmit
npm test
npm run build
jq . plugins/linear/.claude-plugin/plugin.json >/dev/null
```

Also verify every Markdown link in `SKILL.md` resolves and forward-test at least these
cases without revealing expected answers:

- a worker notices unrelated debt while executing;
- a task becomes too large for one session;
- a reviewer finds required and unrelated problems;
- a human-authorized campaign needs phone-visible progress;
- a fresh agent resumes from a checkpoint after context loss.
