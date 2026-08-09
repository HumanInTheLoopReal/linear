/**
 * `.aider/README.md` body — human-facing onboarding for the
 * `.aider/` directory written by the aider multifile recipe.
 *
 * A short note explaining what the directory is, what each file does,
 * and how to opt out / customize. The agent-loaded brief lives in
 * `.aider/LINEAR.md` — README.md is for the human contributor opening
 * the directory in their editor.
 */
export const AIDER_README_MD = `# .aider/ — Linear integration for Aider

This directory was created by \`linear setup aider\`. It tells aider
how to interact with Linear (the project's issue tracker).

## What's here

| File | Purpose |
|------|---------|
| \`LINEAR.md\` | Workflow brief, auto-loaded by aider on every invocation via the sibling \`.aider.conf.yml\` |
| \`README.md\` | This file (human-facing onboarding; not loaded by aider) |

The companion \`.aider.conf.yml\` lives in the project root (one level
up from this directory) — it's the file aider actually reads on
startup. Removing it disables the auto-load.

## How to opt out

- One session: run \`aider --no-conf\` to skip the conf file.
- Permanently: \`linear setup aider --remove\` deletes
  \`.aider.conf.yml\`, this directory, and the LINEAR.md inside it.

## How to customize

\`LINEAR.md\` is overwritten on every \`linear setup aider\` run, so
local edits don't survive. If you need a customized workflow brief,
add a second entry to \`.aider.conf.yml\`'s \`read:\` block pointing at
your own file (the linear-managed one will still be auto-loaded
alongside it).

## Re-installing

\`linear setup aider\` is idempotent — re-running it refreshes
\`LINEAR.md\` to the latest workflow brief from the linear release
you're using. \`linear setup aider --check\` reports whether the
installed files match the bundled templates.
`;
