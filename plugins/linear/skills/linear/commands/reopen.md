---
description: Reopen one or more closed issues
argument-hint: <issues...> [-r reason]
---

Reopen one or more closed Linear issues. Transitions each issue back to an `unstarted`-category workflow state and (optionally) posts a comment explaining why.

`linear reopen` is an alias for `linear issues reopen`. More explicit than `linear update --status unstarted` — purpose-built for the reopen workflow.

## Arguments

- `<issues...>`: One or more closed issue identifiers (`ENG-123`) or UUIDs. Required.

## Options

- `-r, --reason <text>`: Reason for reopening. Posted as a comment on each issue.
- `--reason-file <path>`: Read the reason from a file (use `-` for stdin).
- `--reason-stdin`: Read the reason from stdin.

`--reason`, `--reason-file`, and `--reason-stdin` are mutually exclusive.

## Examples

```bash
# Reopen one issue
linear reopen ENG-42

# Reopen several with a shared reason
linear reopen ENG-42 ENG-43 -r "regression discovered in QA"

# Reason from a file
linear reopen ENG-42 --reason-file ./bug-report.md
```

## Common reasons to reopen

- Regression discovered after close.
- Requirements changed.
- Implementation found incomplete during review.
- New information surfaced (production logs, customer report).

## After reopening

- `/linear:show <id>` — confirm the new state and surface the reason comment.
- `/linear:ready` — see whether the reopened issue is now blocking anything that was claimed.

## See also

- `/linear:close` — the inverse
- `/linear:update` — change other fields when reopening
- `/linear:comments` — read prior discussion before deciding why to reopen
