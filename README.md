# linear

Agent-first command line interface for Linear.app.

[![License](https://img.shields.io/github/license/HumanInTheLoopReal/linear)](LICENSE.md)
[![npm](https://img.shields.io/npm/v/@humanintheloop/linear)](https://www.npmjs.com/package/@humanintheloop/linear)

`linear` gives coding agents a complete Linear workflow from the terminal:
find ready work, claim it, record what happened, and close it out. Linear is
the source of truth and nothing is cached locally, so an agent resuming a
session sees exactly what the web app shows.

Read-only commands print plain text by default. Add `--json` to any of them
for a stable envelope that scripts and agents can parse.

## Requirements

- Node.js 22 or newer
- A Linear API token
- macOS, Linux, or Windows

## Install

```bash
npm install -g @humanintheloop/linear
linear --version
```

The npm package is the only supported install channel today. To run from a
clone instead:

```bash
git clone https://github.com/HumanInTheLoopReal/linear.git
cd linear
npm install
npm run build
node dist/main.js --version
```

Channel details and verification steps live in
[`docs/INSTALLING.md`](docs/INSTALLING.md).

## Quickstart

```bash
# 1. Authenticate. Writes an encrypted token to ~/linear/token.
linear auth login

# 2. Set up your project. Picks a default team and writes an AGENTS.md
#    section so agents can discover the workflow.
cd your-project
linear init

# 3. Work an issue.
linear next                 # ready work, no open blockers
linear show ENG-142         # details, comments, relations
linear start ENG-142        # assign to self and move to In Progress
linear close ENG-142
```

`linear init` is a one-time setup per project. You do not need to clone this
repository into your own project. Use `--stealth` to keep the workflow
snippet out of committed files.

Longer walkthrough: [`docs/QUICKSTART.md`](docs/QUICKSTART.md).

## Wiring it into an agent

`linear prime` prints the full workflow brief that teaches an agent how to
use the CLI. There are three ways to get it in front of one.

**Generic.** `linear init` writes an `AGENTS.md` section pointing at
`linear prime`. This works with any agent that reads `AGENTS.md`.

**Tool-native.** `linear setup <tool>` writes config in the format a
specific tool expects, including a SessionStart hook where the tool supports
one, so the brief loads automatically:

```bash
linear setup claude     # Claude Code hooks (SessionStart, PreCompact)
linear setup codex      # Codex CLI AGENTS.md section
linear setup cursor     # .cursor/rules/linear.mdc
linear setup --list     # all 14 recipes
```

The full recipe set is `agent-skill`, `agents`, `aider`, `claude`, `codex`,
`cody`, `cursor`, `factory`, `gemini`, `junie`, `kilocode`, `mux`,
`opencode`, and `windsurf`.

**Plugin bundle.** [`plugins/linear/`](plugins/linear/) packages 25 commands,
an agent definition, and a skill with 13 reference documents for Claude Code,
Codex, and Copilot:

```bash
claude plugin install ./plugins/linear
```

If your agent is not covered, the minimum viable instruction is:

```markdown
This project uses the linear CLI for issue tracking.

- Run `linear prime` for workflow context and command guidance.
- Use `linear next`, `linear show <id>`, `linear start <id>`, and
  `linear close <id>`.
- Do not track work in markdown TODO lists.
```

## Common commands

| Command | What it does |
| --- | --- |
| `linear prime` | Print the agent workflow brief and current ready work. |
| `linear next` | List issues with no open blockers. |
| `linear show <id>` | Issue details, comments, and relations. |
| `linear create "Title" --team ENG` | Create an issue. |
| `linear start <id>` | Assign to self and move to In Progress. |
| `linear close <id>` | Close an issue. |
| `linear depends add <a> <b>` | Link two issues. |
| `linear blocked` | Open issues waiting on an open predecessor. |
| `linear doctor` | Diagnose workspace and auth health. |

Issue identifiers are assigned by Linear (`ENG-123`). They are immutable and
never collide across branches.

Run `linear usage` for the full command index, or `linear <domain> usage`
for one domain, for example `linear issues usage`.

## Documentation

- [Installing](docs/INSTALLING.md) - install channels and verification
- [Quickstart](docs/QUICKSTART.md) - auth through to closing an issue
- [Configuration](docs/CONFIG.md) - config keys, layers, environment variables
- [Troubleshooting](docs/TROUBLESHOOTING.md) - auth, scope, network, the create gate
- [Uninstalling](docs/UNINSTALLING.md) - removing the CLI; issues stay in Linear
- [Agent workflow](AGENT_INSTRUCTIONS.md) - operational deep dive
- [Architecture](AGENTS.md) - layout and invariants
- [Plugin maintenance](docs/PLUGIN-MAINTENANCE.md)
- [Architecture decision records](docs/adr/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the build, test, and pull request
flow.

## Security

Report vulnerabilities through GitHub private vulnerability reporting rather
than a public issue. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE.md](LICENSE.md).
