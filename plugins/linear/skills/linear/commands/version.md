---
description: Show the linear CLI version (and plugin compatibility)
argument-hint: []
---

Show installed versions and verify compatibility between the `linear` CLI, this Claude Code plugin, and the configured Linear workspace.

The CLI itself has no `linear version` subcommand — version reporting flows through `linear --version` (the standard Commander flag) and `linear info` (workspace identity + open-issue count for the configured token). This slash command wraps both.

## What it prints

Display, in order:

1. **CLI version** — `linear --version` (semver, from `package.json`).
2. **Plugin version** — read from `plugins/linear/.claude-plugin/plugin.json` (`version` field).
3. **Compatibility** — green check if the CLI version satisfies the `compatible-with` constraint declared in the plugin's `SKILL.md` frontmatter; red warning otherwise.
4. **Workspace identity** — output of `linear info` (organization, viewer, open-issue count). Confirms the token is resolvable and the network path to Linear is live.

## Commands

```bash
linear --version            # CLI semver
linear info                 # workspace + viewer + open-issue count
linear info --whats-new     # plus a short blurb of recent CLI features
```

## When versions mismatch

If the CLI version is older than the plugin's `compatible-with` floor, surface the upgrade path:

- **Update the CLI** (whichever channel you installed via):
  - npm: `npm install -g @humanintheloop/linear@latest`
  - Homebrew: `brew upgrade HumanInTheLoopReal/linear/linear` (tap with `brew install HumanInTheLoopReal/linear/linear` if not already added)
- **Update the plugin**: `/plugin update linear` (Claude Code).
- **Restart Claude Code** after updating the plugin so the new SKILL.md / command docs reload.

## See also

- `/linear:info` — workspace identity + open-issue count (the substantive half of what this command shows)
- `/linear:prime` — agent-onboarding context for this repo
- `linear doctor` — broader workspace-health diagnostic
