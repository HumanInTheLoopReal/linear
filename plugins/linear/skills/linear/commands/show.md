---
description: Show full details for an issue
argument-hint: <issue-id> [--with-comments] [--with-attachments]
---

Display the full record for one Linear issue: title, description, status, priority, assignee, team, labels, parent, relations, and (optionally) comments, attachments, and reactions.

`linear show` is an alias for `linear issues read`. Text output uses a header card + sections layout. `--json` returns the full issue object as a single JSON document.

## Arguments

- `<issue>`: Issue identifier (`ENG-123`) or UUID. Required.

## Options

- `--with-comments`: Include every comment (root threads + replies, flattened). The CLI pages through long discussions, so nothing is cut off; `comments.pageInfo.hasNextPage` is always `false`. Without this flag the read carries only the first 50 comments as `{id, body}`.
- `--with-comment-threads`: Same data, but group replies under their root thread instead of flattening.
- `--with-attachments`: Include attachments attached to the issue.
- `--with-reactions`: Include reactions on the root issue.

All four are off by default — the base view is the issue card alone so the most common invocation stays cheap.

## Examples

```bash
# Basic show
linear show ENG-42

# Full context for a code-review-style read
linear show ENG-42 --with-comments --with-attachments --with-reactions

# JSON for piping into another tool
linear show ENG-42 --json | jq '.description'

# Just the description body
linear show ENG-42 --json | jq -r '.description'
```

## When to use which add-on

- **--with-comments**: agent is about to respond to a discussion thread, or you need the full history before reopening.
- **--with-comment-threads**: same use case, but you want the tree structure preserved (e.g. to render replies indented).
- **--with-attachments**: agent is auditing whether a spec/screenshot is attached.
- **--with-reactions**: agent is checking whether teammates have already signaled +1/-1 on the issue.

If the issue has dependencies and you need the full graph, follow up with `/linear:dep tree <id>`.

## See also

- `/linear:list` — broader filtered listing
- `/linear:dep` — full dependency tree rooted at this issue
- `/linear:comments` — comments-only view (lighter than `--with-comments`)
- `/linear:update` — edit fields after reading
