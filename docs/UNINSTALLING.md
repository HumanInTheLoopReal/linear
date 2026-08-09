# Uninstalling linear

Removing the `linear` CLI is **purely local**. `linear` is a thin client over
Linear's **hosted API** — there is no local server to stop, no local database,
and no `.gitattributes` merge driver. Uninstalling removes the binary, git
hooks, editor integration, and the local encrypted token/state.

**Your issues are not deleted.** They live in Linear (hosted). See
[What is NOT removed](#what-is-not-removed).

## Quick Uninstall

```bash
linear where                  # locate binary, token, and local state FIRST
linear hooks uninstall        # remove managed git-hook wiring (per-repo)
linear setup --remove         # remove editor / agent integration files
linear auth logout            # delete ~/linear/token
rm -rf ~/linear/ ~/.linear/   # encrypted token store + global state
rm -f  ~/.linear_api_token    # legacy token (if it exists)
rm -rf .linear/               # per-repo config/audit (run in each repo)
npm uninstall -g @humanintheloop/linear       # or: brew uninstall linear
which linear                  # should print nothing
```

## Detailed Steps

### 1. Remove git hooks

```bash
linear hooks list             # show what is installed
linear hooks uninstall        # remove managed wiring, preserves user content
linear hooks uninstall --shared   # also remove shared .linear-hooks/ + reset core.hooksPath
```

These are the `prepare-commit-msg` / `post-commit` hooks (plus the inert
`pre-commit` / `post-merge` shims). Uninstall preserves any pre-existing hook
content you had.

### 2. Remove editor / agent integration

`linear setup` (and the Claude recipe) write integration files for AI
editors — SessionStart / PreCompact entries, plus edits to `AGENTS.md` and
`.claude` settings.

```bash
linear setup --list           # show available recipes and what they touch
linear setup --remove         # remove the installed integration
linear setup --check          # confirm it's gone
```

Some entries are plain edits to `AGENTS.md` / `.claude/settings.json` and may
need **manual removal**. If a plugin bundle was installed:

```bash
claude plugin uninstall linear
```

### 3. Remove stored credentials & local state

```bash
linear auth logout            # removes ~/linear/token
rm -rf ~/linear/              # encrypted token store
rm -rf ~/.linear/             # global state: memory.json, snapshots
rm -f  ~/.linear_api_token    # legacy token store (deprecated)
rm -rf .linear/               # per-repo: config.json, audit.jsonl (run per repo)
```

Run `linear where` first to confirm these paths on your machine.

### 4. Uninstall the binary

Use the method that matches how you installed (`linear where` shows the path):

```bash
npm uninstall -g @humanintheloop/linear       # npm install
brew uninstall linear         # Homebrew
rm "$(command -v linear)"     # install.sh / manual binary
```

### 5. Verify removal

```bash
which linear                  # → not found
ls ~/linear                   # → No such file or directory
ls ~/.linear                  # → No such file or directory
```

## What is NOT removed

- **Your Linear issues, projects, comments, and history.** These are stored in
  Linear's hosted workspace, not on your machine. Uninstalling the CLI does
  **not** touch them — log into linear.app and they're all there.
- Anything you manually committed to a repo (e.g. an edited `AGENTS.md`)
  remains in git history until you change it.

## Re-installing later

No migration needed — issues are untouched in Linear.

```bash
# Reinstall (see INSTALLING.md), then:
linear auth login
```

---

**See also:** [Installing](INSTALLING.md) · [Quickstart](QUICKSTART.md) · [Troubleshooting](TROUBLESHOOTING.md)
