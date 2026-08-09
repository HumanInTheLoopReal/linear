---
description: View or post comments on an issue
argument-hint: list|create|reply|edit|delete <issue|thread>
---

View, post, edit, delete, and react on discussion threads on a Linear issue.

`linear comments` is a **deprecated compatibility facade**. It still works, but the canonical surface is `linear issues discuss` / `linear issues discussions` / `linear issues reply` / `linear issues replies` / `linear issues edit-reply` / `linear issues delete-reply`. New scripts should target the canonical verbs; existing invocations keep working through this facade.

In Linear, "comments" are **discussion threads**. A thread has a root comment (`discuss`) and optional nested replies (`reply`).

## Subcommands

### list

```
linear comments list [-l N] [--after <cursor>] <issue>
```

List root discussion threads on an issue. Replies live under each thread — fetch them via `linear comments reply` / `linear issues replies` once you have a thread ID.

### create

```
linear comments create [--body <text> | --body-file <path> | --stdin] <issue>
```

Start a new discussion thread on `<issue>`. Equivalent to `linear issues discuss <issue>`.

### reply

```
linear comments reply [--body <text> | --body-file <path> | --stdin] <thread>
```

Reply to a **root** thread. Compatibility mode only accepts root thread IDs — nested reply targets are not supported; for those, switch to `linear issues reply <thread> --body <text>`.

### edit / delete

```
linear comments edit [--body <text>] <comment>
linear comments delete <comment>
```

Accepts root thread IDs or reply IDs. For reply-specific workflows, migrate to `linear issues edit-reply <reply>` and `linear issues delete-reply <reply>`.

### react / unreact

```
linear comments react   [--shortcode <name>] <comment> [emoji]
linear comments unreact [--shortcode <name>] <comment> [emoji]
linear comments unreact-id <comment> <reactionId>
```

All three are deprecated. Migrate to `linear issues threads react <thread>` / `linear issues replies react <reply>` (and the matching `unreact` / `unreact-id` variants).

## Examples

```bash
# Read recent threads on an issue
linear comments list ENG-42

# Start a thread
linear comments create ENG-42 --body "FYI — production saw three of these in the last hour."

# Pipe a multi-line body
git log -1 --format=%B | linear comments create ENG-42 --stdin

# Reply to a root thread
linear comments reply <thread-id> --body "Confirmed; rolling forward with the migration."

# Show one issue with comments inline (cheaper than `comments list` + `show`)
linear show ENG-42 --with-comments
```

## When to comment vs. update

Use `/linear:comments` for **discussion** — design notes, progress updates, links, questions. Use `/linear:update --description` when the canonical record needs to change (the description is the singular, editable field; comments are append-only conversation). Tracking decisions? Reach for `/linear:decision record` instead.

## See also

- `/linear:show --with-comments` — read everything in one call
- `/linear:create` — open a fresh issue rather than commenting on an existing one
- `/linear:decision` — record a tracked decision with structured rationale instead of a free-form comment
