#!/usr/bin/env bash
#
# Install git hooks from scripts/hooks/ into .git/hooks/.
#
# This is a fallback for contributors who opt out of lefthook (the
# default `npm install` runs `lefthook install` via the `prepare`
# script). If you're using lefthook you do NOT need this script.
#
# Usage: ./scripts/install-hooks.sh
#
# Per docs/parity-ux/specs/F-install.md §2.6.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/scripts/hooks"
GIT_HOOKS_DIR="$REPO_ROOT/.git/hooks"

if [ ! -d "$REPO_ROOT/.git" ]; then
    # Worktrees use a .git file pointing at the gitdir. Resolve that.
    if [ -f "$REPO_ROOT/.git" ]; then
        gitdir_line=$(grep -E '^gitdir:' "$REPO_ROOT/.git" || true)
        if [ -n "$gitdir_line" ]; then
            GIT_HOOKS_DIR="${gitdir_line#gitdir: }/hooks"
        fi
    fi
fi

if [ ! -d "$GIT_HOOKS_DIR" ]; then
    echo "Error: could not locate .git/hooks directory (expected at $GIT_HOOKS_DIR)" >&2
    exit 1
fi

if [ ! -d "$HOOKS_DIR" ]; then
    echo "Error: hooks source directory not found at $HOOKS_DIR" >&2
    exit 1
fi

echo "Installing git hooks from $HOOKS_DIR into $GIT_HOOKS_DIR..."

installed=0
for hook in "$HOOKS_DIR"/*; do
    if [ -f "$hook" ]; then
        hook_name=$(basename "$hook")
        echo "  Installing $hook_name"
        cp "$hook" "$GIT_HOOKS_DIR/$hook_name"
        chmod +x "$GIT_HOOKS_DIR/$hook_name"
        installed=$((installed + 1))
    fi
done

if [ "$installed" -eq 0 ]; then
    echo "No hooks found under $HOOKS_DIR."
    exit 0
fi

echo ""
echo "Done. Installed $installed hook(s)."
echo ""
echo "Note: lefthook (configured in lefthook.yml) is the primary hook"
echo "mechanism and is installed automatically by 'npm install'. This"
echo "script is only useful if you've explicitly opted out of lefthook."
