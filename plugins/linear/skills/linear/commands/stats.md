---
description: Issue-database health snapshot — counts by bucket
argument-hint: [--assigned] [--no-activity]
---

Issue-database health snapshot: counts of issues grouped by status, priority, and type. The Linear analogue of `git status` — a quick "where does the workspace stand?" read.

`linear stats` is an alias for `linear issues status` (the canonical path is `linear issues status`; `stats` is the alias).

## Options

- `--all`: The underlying behavior is the default — no narrowing applied. Pass it for clarity in scripts.
- `--assigned`: Scope counts to issues assigned to the current viewer.
- `--no-activity`: Documented as "skip the recent-activity section" but currently a **no-op** — the `recent_activity` field is always `null` and the key is still present in the JSON envelope regardless of this flag.

## Examples

```bash
# Whole workspace
linear stats

# Just my work
linear stats --assigned

# Skip the always-null activity section (currently a no-op — see options note)
linear stats --no-activity

# Pipe to jq for one bucket
linear stats --json | jq '.summary.open_issues'
```

## What you get

Text mode prints a `📊 Issue Database Status` panel: `Total Issues`, `To Do`, `In Progress`, `Blocked`, `Deferred`, `Done`, `Ready to Work`.

JSON mode (`--json`) returns:

```jsonc
{
  "summary": {
    "total_issues": N,
    "open_issues": N,
    "in_progress_issues": N,
    "blocked_issues": N,
    "deferred_issues": N,
    "closed_issues": N,
    "ready_issues": N,
    "pinned_issues": 0,            // no Linear analog
    "epics_eligible_for_closure": 0, // no Linear analog
    "average_lead_time": 0          // no Linear analog
  },
  "recent_activity": null            // no Linear analog
}
```

There are no per-status / per-priority / per-type bucket maps in the envelope. For a per-status drill-down use `linear list --status <state>` and `linear count`.

## Notes

Linear has no count-only API, so this command paginates through every non-closed issue plus a count of closed issues. For large workspaces, expect a few hundred ms.

Four fields **always read inert** because they have no Linear-side equivalent:

- `pinned_issues` — Linear has no per-team pin concept (always 0).
- `epics_eligible_for_closure` — exposed instead via `linear issues epic-status --eligible-only` and `linear issues close-eligible-epics --dry-run`.
- `average_lead_time` — not tracked.
- `recent_activity` — no Linear equivalent (always null).

The fields are kept in the `summary` object for compatibility with downstream parsers — they always read 0 (or null for `recent_activity`).

## When to use

- Daily standup: "how many issues moved yesterday?" — combine with `linear list --updated-after $(date -v-1d +%Y-%m-%d)`.
- Pre-release gating: "how many open bugs at priority 1?"
- Workspace audit: spot bucket imbalance (lots of `unstarted`, very little `started`).

## See also

- `/linear:list` — drill into one bucket
- `/linear:ready` — what's ready now
- `/linear:blocked` — what's stuck
- `/linear:epic` — epic-completion view
