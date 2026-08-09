---
description: Quick-start pointer (deprecated — see prime / onboard)
argument-hint: []
---

Static quick-start guide for `linear`.

`linear quickstart` is **deprecated** in favor of the dynamic workflow brief printed by `linear prime` and the AGENTS.md snippet emitted by `linear onboard`. It's kept for environments where `prime` can't run.

## What it prints

A short orientation: install verification, auth resolution, the available aliases, common verbs, and pointers to deeper docs.

## Prefer instead

```bash
linear prime           # full agent-onboarding context (dynamic — adapts to your workspace)
linear onboard         # short AGENTS.md snippet for hand-installing into another agent IDE
linear info            # workspace identity + viewer + open-issue count
linear usage           # generated full-domain CLI reference
```

## When you'd still reach for quickstart

- No Linear access (or the token is misconfigured) and you want to read about the verb surface without making API calls — `quickstart` is fully static.
- Demo / talk context where you want a stable, non-changing summary.

## See also

- `/linear:prime` — the canonical entry point for agents
- `/linear:workflow` — the static workflow recipe
- `/linear:init` — first-run setup
- `linear onboard` — AGENTS.md snippet for non-Claude-Code agents (CLI verb; no slash-command surface)
