# Linear Skill for Claude Code

Process guidance for running projects through
[linear](https://github.com/HumanInTheLoopReal/linear), a CLI for Linear.app,
with humans and agents sharing one backlog.

This file is the human-facing overview. `SKILL.md` is what Claude reads, and
`CLAUDE.md` is the maintenance guide for anyone editing the skill.

## What it covers

Command syntax already lives in `linear prime` and `linear <command> --help`.
This skill covers the judgment those cannot: which work is worth recording,
how it should be shaped, and when it is genuinely finished.

- Which work belongs in Linear: approved durable outcomes, dependencies,
  decisions, human gates, resumable handoffs.
- Which work stays out: commands, inspections, edits, test runs, anything the
  host task system can reconstruct.
- How work is shaped: project, capability, leaf, and sub-issues that earn
  their place.
- How discoveries are handled: captured without silently inflating the
  backlog.
- What closing means: Git, CI, review, merge authority, and the Linear record
  kept distinct but connected.

## Install

Through the plugin marketplace:

```
/plugin install linear
```

Or copy the directory into a skills location:

```bash
cp -r linear ~/.claude/skills/     # every project
cp -r linear .claude/skills/       # this project only
```

## What triggers it

Claude reaches for this skill when a conversation involves creating or
closing issues, asking what is ready, multi-session work, dependency
juggling, resuming after a context loss, or any direct use of the `linear`
CLI and its top-level verbs.

## Layout

```
linear/
  SKILL.md      the router Claude reads first
  CLAUDE.md     maintenance guide
  README.md     this file
  adr/          decisions about the skill itself
  agents/       Codex interface declaration
  commands/     one page per slash command
  references/   process playbooks, routed from SKILL.md
  resources/    CLI concepts and compatibility notes
```

`SKILL.md` carries the current index of what is in `references/` and
`resources/`, so it does not get repeated here.

## Concepts worth knowing before you start

### Durable work against execution steps

Linear is for state that has to survive a context loss and still mean
something to the project: an approved outcome, an owner, a dependency, a
decision, a human gate, a checkpoint. Everything reconstructable belongs in
TodoWrite, TaskCreate, Codex plans, or whatever the host provides.

Duration is a bad proxy for this. A ten-minute approval can deserve an issue,
while a multi-hour run of commands may not, as long as the issue contract,
the Git state, and the tests together explain what happened.

### Discovery is not commitment

A worker who trips over a bug, some debt, or an opportunity records it as a
structured finding. Promotion into the backlog is a human or planner
decision. The exception is narrow: a worker may create a child when the
assigned issue requires it and that child stands on its own well enough to be
resumed or verified independently.

### Dependency direction

`linear dep add A B` says A depends on B, so B has to finish first.

```bash
linear dep add implementation setup     # implementation waits for setup
```

Reversing those arguments produces a real edge pointing the wrong way, with
no warning. When in doubt, name the relationship on `linear update` instead
and let the flag carry the direction:

```bash
linear update implementation --blocked-by setup
linear update setup --blocks implementation
```

Both write the same edge. Note that `linear relate <a> <b>` creates a
bidirectional `related` link and takes no direction flags; blocking has to go
through `linear update` or `linear depends add`.

### Surviving compaction

Compaction discards the conversation, not the workspace. Linear is the source
of truth, so re-fetch rather than trying to remember. Write notes for a
future reader who has none of your context:

```bash
linear note TES-123 "DONE: webhook receiver behind the feature flag
DECIDED: retry with exponential backoff, not a dead-letter queue, since
replays are idempotent
OPEN: signature verification still trusts the unparsed header
NEXT: move verification ahead of body parsing, then drop the flag"
```

`linear note` appends under a `## Notes` heading in the issue description and
is the top-level alias for `linear issues note`. For a threaded conversation
instead, use `linear comments create <id> "..."`.

Picking the thread back up:

```bash
linear list --team <key> --status "In Progress" --json
linear show TES-123
linear prime
```

`--status` needs `--team` alongside it, unless you have set `team.default`,
which makes the team implicit.

## Requirements

- The [linear CLI](https://github.com/HumanInTheLoopReal/linear):
  `npm install -g @humanintheloop/linear`
- A Linear API token, either as `LINEAR_API_TOKEN` in the environment or
  written by `linear auth login` (encrypted at `~/linear/token` on macOS,
  `~/.config/linear/token` on Linux)
- A workspace and team. `linear teams list` discovers them, and
  `linear config set team.default <key>` saves you repeating it.

No git repository is needed. The CLI talks to the API and works from any
directory once auth resolves.

## Version compatibility

| linear version | Added |
|---|---|
| 2026.4.x+ | This plugin bundle: `/linear:*` slash commands, SessionStart and PreCompact hooks, task agent |
| 2026.3.x+ | `linear molecules`, building Linear sub-issue trees from local TOML |
| 2026.2.x+ | Top-level verb aliases such as `list`, `ready`, and `dep tree` |
| 2026.1.x+ | Memory store: `linear remember`, `recall`, `memories`, `forget` |
| 2026.0.x+ | Core verbs across issues, dependencies, and workflow |

## Contributing

The skill lives in `plugins/linear/skills/linear/` at
[github.com/HumanInTheLoopReal/linear](https://github.com/HumanInTheLoopReal/linear).

Useful contributions: workflow patterns that came up in real use, corrections
to examples that no longer match the CLI, troubleshooting entries for
failures you actually hit, and anything that makes the guidance shorter
without losing it.

Read [`CLAUDE.md`](CLAUDE.md) first. It sets out what belongs in `SKILL.md`,
what belongs in a reference, and what should stay in `linear --help`.

## License

MIT, same as the CLI.
