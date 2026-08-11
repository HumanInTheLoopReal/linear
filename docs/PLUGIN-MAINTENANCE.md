# Plugin Bundle Maintenance Guide

This guide documents how to maintain `plugins/linear/` — the Claude
Code + Codex + Copilot plugin bundle shipped by linear-cli. The bundle is the
agent-facing surface: slash commands, resources, skills, agent prompts,
and the three plugin manifests that wire them into the IDEs.

For the **why** of the bundle layout, see
[`docs/adr/0001-plugin-bundle-distribution-model.md`](adr/0001-plugin-bundle-distribution-model.md).

Version bumps happen automatically during a release; see
[`RELEASING.md`](../RELEASING.md).

## Table of Contents

1. [Overview](#1-overview)
2. [Adding a new slash-command doc](#2-adding-a-new-slash-command-doc)
3. [Updating a resource doc](#3-updating-a-resource-doc)
4. [Updating SKILL.md](#4-updating-skillmd)
5. [Plugin version bumps](#5-plugin-version-bumps)
6. [Validating manifests locally](#6-validating-manifests-locally)
7. [Adding a new ADR](#7-adding-a-new-adr)
8. [Release coordination with RELEASING.md](#8-release-coordination-with-releasingmd)

## 1. Overview

The plugin bundle lives at `plugins/linear/`. Its layout:

```
plugins/linear/
  README.md                                # bundle-level README
  .claude-plugin/plugin.json               # Claude Code manifest
  .codex-plugin/plugin.json                # Codex manifest
  .copilot-plugin/plugin.json              # GitHub Copilot manifest
  skills/
    linear/
      SKILL.md                             # the skill entry point
      CLAUDE.md                            # plugin-internal maintenance guide
      README.md                            # human-facing docs
      adr/                                 # plugin-internal ADRs
        0001-linear-prime-as-source-of-truth.md
      commands/                            # ~25 slash-command docs
        ready.md, show.md, create.md, ...
      resources/                           # 8 advanced-concept docs
        CLI_REFERENCE.md, DEPENDENCIES.md,
        MOLECULES.md, TROUBLESHOOTING.md, ...
      agents/                              # OpenAI agent prompt
        openai.yaml
  agents/
    task-agent.md                          # task-orchestration agent prompt
```

The marketplace pointer at the repo root,
`.claude-plugin/marketplace.json`, references this bundle for local-dev
installs.

## 2. Adding a new slash-command doc

A slash command added to the bundle becomes available as `/linear:<verb>`
in Claude Code and `$linear <verb>` in Codex.

1. Add the file at `plugins/linear/skills/linear/commands/<verb>.md`.
2. Use the standard slash-command frontmatter:

   ```markdown
   ---
   description: One-line summary of what the command does.
   allowed-tools: Bash
   argument-hint: <id> [--option]
   ---

   # /linear:<verb>

   <command description>

   ## Usage

   ```bash
   linear <verb> <args>
   ```

   ## Examples

   ```bash
   linear <verb> ENG-123
   ```

   ## Related

   - `linear <verb> --help` for full flag reference.
   - `plugins/linear/skills/linear/resources/<RELEVANT>.md` for the
     concept doc, if applicable.
   ```

3. Cross-link from `SKILL.md` if the new command introduces a workflow
   shift (e.g., a new mode of working with epics). Pure flag additions
   to existing commands do **not** need a SKILL.md edit — agents
   discover them via `linear <verb> --help`.
4. Bump the plugin version per section 5.
5. Validate per section 6 before pushing.

## 3. Updating a resource doc

Resource docs at `plugins/linear/skills/linear/resources/*.md` provide
depth for advanced features that `linear prime` and `--help` do not
explain.

**Update vs. leave stale:**

| If the resource describes... | And `linear prime` covers it now... | Action |
|---|---|---|
| A CLI-flag matrix | Yes | Remove the resource (avoid duplication; see ADR 0001 for the plugin) |
| A conceptual framework | No | Update the resource for the new linear version |
| A workflow checklist | Yes | Trim the resource to the part `prime` does not cover |
| An advanced pattern | No | Update — patterns are the resource layer's reason for existing |

When in doubt, run `linear prime` and check whether the current output
already covers the content. If yes, the resource is redundant and a
candidate for removal.

The plugin-internal CLAUDE.md
(`plugins/linear/skills/linear/CLAUDE.md`) codifies this discipline as
"DRY via linear prime."

## 4. Updating SKILL.md

`plugins/linear/skills/linear/SKILL.md` is the skill entry point —
agents load it when the `linear` skill is invoked. **It is the index,
not the reference.**

**SKILL.md must contain:**

- Decision frameworks (when to reach for linear, when not to).
- Prerequisites (install check, auth check).
- Resource index (progressive disclosure: shortest needed read).
- Pointers to `linear prime` and `linear <verb> --help`.

**SKILL.md must NOT contain:**

- Inline CLI command reference. That is `linear prime`'s job and
  `--help`'s job.
- Workflow checklists that `linear prime` already prints.
- Duplicated resource content.

Target length: 400–700 words. If SKILL.md grows past 700 words, the
content likely belongs in a resource doc.

After editing SKILL.md, verify the word count:

```bash
wc -w plugins/linear/skills/linear/SKILL.md
```

The `agent-skill` setup recipe writes a snapshot of `SKILL.md` to
`.agents/skills/linear/SKILL.md` in consumer repos. Treat `SKILL.md`
as a public contract: changes propagate to every consumer of that
recipe on their next run.

## 5. Plugin version bumps

The plugin bundle uses the CLI's CalVer version and bumps in lockstep at every
release, as required by ADR 0001. Releases in the same UTC month increment the
patch component; a new month resets it to zero. Prereleases from `next` append
the same `-next.N` suffix as the CLI package.

Bump every manifest, marketplace entry, and skill snapshot in one command:

```bash
node scripts/release/plugin-versions.mjs X.Y.Z
```

Verify every version-bearing surface matches `package.json`:

```bash
npm run verify:plugin-versions
```

The release workflow enforces this before semantic-release and synchronizes
the next version again during semantic-release's prepare phase.

## 6. Validating manifests locally

Before pushing a bundle change, validate the manifests and the
discoverable surface.

### JSON validity

```bash
jq . plugins/linear/.claude-plugin/plugin.json > /dev/null
jq . plugins/linear/.codex-plugin/plugin.json > /dev/null
jq . plugins/linear/.copilot-plugin/plugin.json > /dev/null
jq . .claude-plugin/marketplace.json > /dev/null
```

Any parse failure here will silently break the plugin in the IDE.

### Local install

```bash
# Claude Code: install the bundle from the repo
claude plugin install ./plugins/linear

# Verify slash commands appear
# In the Claude Code session, the / menu should list:
#   /linear:ready, /linear:show, /linear:create, ...

# Codex: install via the same bundle path
codex plugin install ./plugins/linear
```

### Smoke-test the slash command surface

After install, exercise at least one slash command per category
(read-only, mutation, agent-orchestration) to confirm the manifest
wired everything correctly:

- `/linear:ready` — read-only smoke.
- `/linear:show ENG-1` (any real ID) — argument-passing smoke.
- `/linear:prime` — hook-injected context smoke.

## 7. Adding a new ADR

linear-cli has two ADR locations. Pick by scope:

- **Repo-level decisions** (architecture, distribution model, the
  AGENTS/CLAUDE split) live at `docs/adr/`. The numbering at this
  location is the canonical sequence.
- **Plugin-internal decisions** (skill structure, source-of-truth for
  CLI reference, hook configuration) live at
  `plugins/linear/skills/linear/adr/`. The numbering at this location
  is local to the plugin bundle.

When in doubt, repo-level. Plugin-internal ADRs should explain
choices that only affect the bundle's structure / contents — never
choices that affect the CLI itself.

ADR format (both locations):

```markdown
# ADR NNNN — Title

## Status

Accepted | Proposed | Superseded by ADR NNNN

## Context

Why is this decision needed? What forces apply?

## Decision

What did we decide? Be specific.

## Consequences

### Positive

- ...

### Negative

- ...

## Related

- Links to PROCESS.md decisions, spec sections, other ADRs.

## Date

YYYY-MM-DD
```

## 8. Release coordination with RELEASING.md

Every plugin version bump ships with a CLI release, and the release
pipeline described in [`RELEASING.md`](../RELEASING.md) does the bumping:

- `scripts/release/plugin-versions.mjs` runs during the prepare step and
  writes the release version into `package.json` and every plugin
  manifest, all in the one `chore(release):` commit. That keeps "what
  plugin version shipped with linear vX.Y.Z" answerable from `git log`.
- `npm run verify:plugin-versions` gates the release and fails it if any
  manifest drifts out of lockstep.
- Submitting to the Claude Code marketplace is still a manual `claude
  plugin publish` invocation, done after the release lands.

Never hand-edit a plugin manifest version. There is no plugin-only
release: the bundle's contract is that its version matches the CLI it was
tested against, so consumers never have to wonder which bundle pairs with
which CLI version.
