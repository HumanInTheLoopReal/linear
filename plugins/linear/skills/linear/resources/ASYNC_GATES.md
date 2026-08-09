# Async Gates

A gate is a wait that outlives your session. Work stops until some condition
elsewhere resolves: a human approves, CI finishes, a PR merges, a clock runs
out, another issue closes.

## Before you create one

Do not create a gate for a wait that some existing record already represents.
An issue sitting in Human Review, an open decision request, a PR, a CI run:
each of those is already the authoritative thing to watch, and a gate beside
it just splits attention. See
[Decisions and Approvals](../references/DECISIONS_AND_APPROVALS.md).

A gate earns its place only when the controller driving the work needs its
own durable object to poll.

## How gates are stored

Linear has no ephemeral or local-only storage, so a gate is an ordinary
issue wearing the `linear:gate` label, with the wait condition written into
its description as `key: value` lines.

That explains the shape of the command surface: there is no `gate create` and
no `gate show`. You create gates with `linear issues create` and read them
with `linear issues read`. What `linear gate` adds is the three verbs that
only make sense for waiting: `list`, `check`, `resolve`.

Condition keys, all optional, case-insensitive, and bullet prefixes are
tolerated:

| Key | Value |
|---|---|
| `await_type` | one of `gh:run`, `gh:pr`, `timer`, `human`, `issue` |
| `await_id` | the thing being waited on: run id, PR number or URL, issue id |
| `timeout` | a duration such as `30m` or `6h`, used by `timer` gates |
| `waiters` | comma-separated agent addresses to notify on resolution |

| Waiting for | `await_type` | `await_id` looks like |
|---|---|---|
| A person to approve | `human` | `deploy-approval` |
| A GitHub Actions run | `gh:run` | `123456789` |
| A pull request | `gh:pr` | `42` or the PR URL |
| Time to pass | `timer` | not used, set `timeout` instead |
| Another Linear issue | `issue` | `ENG-123` |

## Creating a gate

Label the issue and put the condition in the description:

```bash
linear issues create "Approve production deploy" \
  --labels linear:gate \
  --description $'await_type: human\nawait_id: deploy-approval\ntimeout: 4h'

linear issues create "Wait for CI" \
  --labels linear:gate \
  --description $'await_type: gh:run\nawait_id: 123456789\ntimeout: 30m'

linear issues create "Wait for PR approval" \
  --labels linear:gate \
  --description $'await_type: gh:pr\nawait_id: 42\ntimeout: 24h'

linear issues create "Wait for deployment propagation" \
  --labels linear:gate \
  --description $'await_type: timer\ntimeout: 15m'
```

The `linear:gate` label is what makes it a gate; `linear gate list` filters on
exactly that string. For multi-line descriptions use the `$'...\n...'` form
above, or `--body-file <path>`, or `--stdin`.

There are no `--title` or `--notify` flags. The issue title is the
human-readable explanation, so write it so someone scanning the list knows
what is being held up and why.

## Watching and closing

```bash
linear gate list                  # open gates
linear gate list --all            # closed ones too
linear gate list --type gh:run    # one await_type
linear issues read <gate-id>      # the full condition block
```

Each row prints as `<icon> <id>  <await-type>  →  <await-id>  [state]`.

```bash
linear gate check                 # close every gate whose condition resolved
linear gate check --dry-run       # report what would close, change nothing
linear gate check --type timer    # evaluate one type
```

What `check` does per type:

- `timer` closes once `timeout` has elapsed, judged by the clock.
- `gh:run` asks the `gh` CLI about the run and closes on success or failure.
- `gh:pr` asks `gh` about the PR and closes on merge or close.
- `human` never closes on its own. That is the point of it.
- A check that errors, such as `gh` failing, reports `outcome=escalated`
  rather than closing or silently hanging, so the caller can react.

Human gates, and anything you want to close by hand:

```bash
linear gate resolve <gate-id>
linear gate resolve <gate-id> --reason "approved after security review"
```

`--reason` is posted as a comment before the gate closes, which keeps the
rationale attached to the record instead of living in someone's memory.

## Habits that keep gates useful

**Always set a timeout.** A gate without one waits forever, and forever-open
gates are how a queue quietly stops meaning anything.

**Name the gate after what it holds up**, not after itself. "Approve Phase 2:
Core Implementation" tells a reader something; "Gate 4" does not.

**Run `linear gate check` when a session starts.** Conditions resolve while
nobody is looking, and starting from an accurate picture costs one command.

**Look before creating.** `linear gate list | grep "<topic>"` takes a second
and prevents two gates guarding the same thing.

**Close what stopped mattering.** A gate for abandoned work is noise:

```bash
linear gate resolve <id> --reason "no longer needed, approach changed"
```

## Gate against ordinary issue

A gate is an issue, so the difference is intent and lifecycle rather than
type:

| | Gate | Ordinary issue |
|---|---|---|
| Marker | `linear:gate` label | none |
| Exists to | block on an external condition | track a piece of work |
| Closes | automatically via `gate check`, or manually via `gate resolve` | manually |
| Listed by | `linear gate list` | `linear issues list` |

Resolved gates stay in history as completed issues rather than being
destroyed, and the label keeps them filterable afterwards.

## When something is stuck

**A gate will not close.** Read the condition block first; a typo in
`await_id` is the usual culprit. For `gh:run`, confirm the run is real.
Failing that, close it by hand.

```bash
linear issues read <gate-id>
gh run view <run-id>
linear gate resolve <gate-id> --reason "manual override"
```

**You cannot find a gate.** It has probably already closed. `linear gate
list --all` includes closed gates, and piping to `grep` narrows by title.

**GitHub lookups fail.** That is an auth or identifier problem on the `gh`
side, not a gate problem:

```bash
gh auth status
gh run list --branch <branch>
gh run list --workflow ci.yml --branch <branch>
```
