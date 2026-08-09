---
description: Capture architectural decisions as Linear issues, with the reasoning attached
argument-hint: record|list|show|supersede
---

Keeps architectural decisions where the work is, as Linear issues tagged
`type:decision` and carrying a four-part body: Decision, Rationale,
Alternatives Considered, Affects.

Use `linear decision record` for a choice that has already been made. A choice
still waiting on a human is a different thing: open a single pending decision
request and resolve that same record, as described in
[Decisions and Approvals](../references/DECISIONS_AND_APPROVALS.md). Do not
write down a candidate as though it were settled, and do not add a second gate
just to represent the waiting.

Linear has no native decision type, so a decision is an ordinary issue plus the
workspace-scoped `type:decision` label plus the structured body. The label is
created the first time it is needed and reused after that. A label rather than
an issue type, so it behaves the same on every team.

## Recording one

Collect these first, asking for whatever is missing:

| Field | |
|---|---|
| Title | what was decided, in one line. Required. |
| Rationale | why this option won. Required. |
| Alternatives | what else was on the table. Optional, but the field future readers most often wish had been filled in. |
| Affects | issue IDs or areas this lands on. Optional. |
| Team | key, name, or UUID. Falls back to the `team.default` config. |
| Priority | 1 to 4, or P1 to P4. Defaults to 2; omit it for no priority. |

```bash
linear decision record \
  --title "Adopt OAuth 2.1 for service-to-service auth" \
  --rationale "Standardizes on the latest spec; drops PKCE workaround." \
  --alternatives "- mTLS: rejected, too much certificate ops overhead\n- API keys: rejected, no rotation story" \
  --affects "ENG-12, ENG-45, infra/gateway" \
  --team ENG \
  --priority 2
```

The body is assembled for you from those flags:

```markdown
## Decision

<the title, restated as the decision>

## Rationale

<the --rationale text>

## Alternatives Considered

<the --alternatives text, or "- (none recorded)">

## Affects

<the --affects text, or "- (none recorded)">
```

The command prints the new identifier, such as `ENG-123`. Pass it back to the
user.

## Reading them back

```bash
linear decision list              # 50 rows by default
linear decision list --limit 200
```

The list sweeps the whole workspace for the `type:decision` label. Before any
decision exists the label does not either, and the result is simply empty
rather than an error.

```bash
linear decision show ENG-123
```

That prints the title and the full body so all four sections are visible. It
is a thin alias for `linear show <id>`, so when you want the complete issue
view or the discussion threads, go straight to:

```bash
linear show ENG-123
linear issues discussions ENG-123
```

## Replacing one

A decision that has been overtaken is superseded, not edited.
`linear decision supersede` records the replacement, links it, and retires the
original in one call:

```bash
linear decision supersede ENG-123 \
  --title "Adopt OAuth 2.1 with mandatory DPoP" \
  --rationale "Threat model now includes token-replay; DPoP closes the gap." \
  --alternatives "- Keep plain OAuth 2.1: rejected, replay risk unacceptable" \
  --affects "ENG-123"
```

Three things happen: the new decision is written using the same template, a
`Related` relation ties it to the old one, and the old one moves to the team's
completed state. Each step is attempted on its own and the output says which
succeeded, so a partial failure still leaves a readable trail rather than an
ambiguous half-state.

Omitting `--team` inherits the team of the issue being superseded, falling back
to `team.default` if that is somehow absent.

## Adding to one later

Implementation notes and second thoughts belong in the discussion, not in a
rewritten body:

```bash
linear issues discuss ENG-123 --body "Implementation note: gateway rollout in two phases."
```

## Finding one

```bash
linear search "OAuth" --label type:decision
linear decision list --limit 200 | grep -i oauth
```

## Conventions

- **State.** A recorded decision sits in the workspace's ordinary current
  state. The human-review state means an unresolved request, not a recorded
  decision. Closed or canceled means superseded or reversed. Follow workspace
  policy here; do not infer a state from the `type:decision` label alone.
- **Body.** Always the four-section template. The verb generates it, so let it.
- **Linking.** Connect a decision to what it touches with
  `linear depends relate <decision-id> <affected-id>`. The new-to-old link
  during a supersede is handled for you.
- **Labels.** Layer your own on top for categorization, such as
  `architecture`, `tooling`, or `process`. `type:decision` belongs to the verb.
- `linear decision usage` prints the full domain reference, which also appears
  in `USAGE.md`.

## See also

- `/linear:create` for a plain issue with no decision template
- `/linear:list` and `/linear:show` for generic listing and detail
- `/linear:dep` for wiring dependency edges
