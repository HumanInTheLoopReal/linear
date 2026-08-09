# Installing linear

`linear` is an agent-first CLI for Linear.app. It is backed by Linear's
hosted GraphQL API: no local database, no server to run, no compiler.
Install the CLI, authenticate, point your agent at it.

Install model: `linear` is installed system-wide, not cloned into your
project. Your project gets only an `AGENTS.md` snippet and editor
integration files (written by `linear init` / `linear setup`).

## Requirements

- Node.js 22+ (`engines.node` is `>=22.0.0`; the install scripts enforce
  `REQUIRED_NODE_MAJOR=22` and abort below it).
- npm (ships with Node). Used by every install channel.
- A Linear account and an API key (created during `linear auth login`).
- macOS, Linux, or Windows.

Check Node:

```bash
node --version   # must be >= v22
```

## Install methods

| Method | Best for | Updates | Prerequisites |
|--------|----------|---------|---------------|
| Homebrew | macOS / Linux | `brew upgrade linear` | Homebrew, Node 22+ |
| npm | Node.js ecosystems, CI | `npm update -g @humanintheloop/linear` | Node 22+ |
| `install.sh` | quick / one-liner / CI | re-run the script | curl, Node 22+ |
| `install.ps1` | Windows PowerShell | re-run the script | PowerShell, Node 22+ |

All channels install the same npm package (`@humanintheloop/linear`) and the same `linear`
binary, and all of them go through npm, which checks the registry's
integrity hash on every install (see
[Security & verification](#security--verification)).
npm is the only channel available today. Homebrew, `install.sh`, and
`install.ps1` are planned and land with the first published release.

### Homebrew (macOS / Linux)

> **Planned - not yet available.** Use npm until the tap is published.

The formula is published from a tap (Homebrew-core submission is deferred).
Tap first, then install:

```bash
brew tap HumanInTheLoopReal/linear
brew install linear
```

Or in one line:

```bash
brew install HumanInTheLoopReal/linear/linear
```

Update:

```bash
brew upgrade linear
```

Tap details and the release update flow live in
[docs/homebrew/README.md](homebrew/README.md).

### npm (any platform)

```bash
npm install -g @humanintheloop/linear
```

Update:

```bash
npm update -g @humanintheloop/linear
```

### install.sh (macOS / Linux)

> **Planned - not yet available.** Use npm until the first release is published.

```bash
curl -fsSL https://raw.githubusercontent.com/HumanInTheLoopReal/linear/main/install.sh | bash
```

The script:

- Checks Node is >= 22 and prints platform-specific install hints if not.
- Installs the `@humanintheloop/linear` npm package globally, over HTTPS
  from the npm registry.

Re-run the same command to update.

### Windows (PowerShell)

> **Planned - not yet available.** Use npm until the first release is published.

```powershell
iwr -useb https://raw.githubusercontent.com/HumanInTheLoopReal/linear/main/install.ps1 | iex
```

Same behavior as `install.sh`: Node 22+ check, then a global npm
install. Re-run to update.

## Authenticate

`linear` resolves an API token in this order:

1. `--api-token <token>` flag
2. `LINEAR_API_TOKEN` environment variable
3. `~/linear/token` (encrypted, written by `linear auth login`)
4. `~/.linear_api_token` (legacy, deprecated — migrate with `linear auth login`)

### Interactive

```bash
linear auth login
```

Opens <https://linear.app/settings/account/security/api-keys/new> in your
browser, prompts for the key, validates it against the API, and stores it
encrypted at `~/linear/token`.

### Non-interactive (CI / agents)

Pipe the token to `auth login` to persist it encrypted:

```bash
echo "$TOKEN" | linear auth login
```

Or skip persistence and provide the token per-process:

```bash
export LINEAR_API_TOKEN="lin_api_..."
```

### Check / clear auth

```bash
linear auth status   # confirm the token works and which source it came from
linear auth logout   # remove the stored token
```

## Verify installation

```bash
linear --version       # prints the installed version
linear doctor          # health checks, incl. cli_in_path
linear where           # on-disk locations + resolved token source
linear auth status     # confirms the token authenticates
```

`linear where --viewer` additionally calls the API to confirm which Linear
workspace the token authenticates against. `linear doctor --check cli_in_path`
runs just the PATH check.

## Editor & agent integration

The `plugins/linear/` bundle wires `linear` into Claude Code and Codex in
one install:

```bash
# Public marketplace
claude plugin install linear

# Local-dev (after cloning this repo)
claude plugin install ./plugins/linear
```

For finer-grained, per-editor setup, `linear setup` ships 14 recipes:

```bash
linear setup --list      # list all recipes
linear setup claude      # Claude Code hooks (SessionStart, PreCompact)
linear setup codex       # Codex CLI AGENTS.md section
linear setup cursor      # Cursor IDE rules file
linear setup aider       # Aider config + workflow brief
```

Recipes cover: `agent-skill`, `agents`, `aider`, `claude`, `codex`,
`cody`, `cursor`, `factory`, `gemini`, `junie`, `kilocode`, `mux`,
`opencode`, `windsurf`.

The `claude` recipe installs SessionStart and PreCompact hooks that run
`linear prime`, injecting the agent workflow brief into context
automatically. Use `--global` to install for the user instead of the
project, and `--stealth` to wire `linear prime --stealth` (omits git-ops
in the session-close protocol).

Verify and manage a recipe:

```bash
linear setup claude --check    # is it installed?
linear setup claude --remove   # remove it
```

See [plugins/linear/README.md](../plugins/linear/README.md)
and [docs/PLUGIN-MAINTENANCE.md](PLUGIN-MAINTENANCE.md).

## Security & verification

The `install.sh` and `install.ps1` scripts hand the install to `npm`, which
fetches over HTTPS and checks the registry's own integrity hash for the
tarball. They do not add a separate signature or checksum check of their own.

To verify a tarball yourself before trusting it:

```bash
npm pack @humanintheloop/linear                  # downloads humanintheloop-linear-<version>.tgz
npm view @humanintheloop/linear dist.integrity   # the sha512 the registry recorded for it
```

## Troubleshooting install

For broader issues, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

### `linear: command not found`

The global npm bin directory is not on your `PATH`. It is
`$(npm config get prefix)/bin`. Add it to `PATH` in your shell profile
(`~/.zshrc` / `~/.bashrc`), then reopen the shell:

```bash
npm config get prefix                          # prints the npm prefix
export PATH="$PATH:$(npm config get prefix)/bin"
```

Then confirm:

```bash
linear doctor --check cli_in_path
```

### Wrong version / multiple binaries

If `linear --version` doesn't match what you just installed, you likely
have more than one copy on `PATH` (e.g. Homebrew and npm both installed):

```bash
which -a linear        # list every linear on PATH
linear where           # show the resolved install location
```

Remove the stale one (`npm uninstall -g @humanintheloop/linear` or `brew uninstall linear`)
and keep a single channel.

### Node too old

```
Node.js >= 22 required (found: vXX)
```

The install scripts abort below Node 22. Upgrade Node, then reinstall:

```bash
node --version         # check current
brew install node      # macOS, or use your platform's installer
```

On Windows: `winget install --exact --id OpenJS.NodeJS.LTS`. If you manage
Node via nvm/volta and the check misfires, the scripts honor
`LINEAR_INSTALL_SKIP_NODE_CHECK=1`.

---

See also: [Quickstart](QUICKSTART.md) · [Configuration](CONFIG.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Uninstalling](UNINSTALLING.md) · [Agent workflow](../AGENT_INSTRUCTIONS.md)
