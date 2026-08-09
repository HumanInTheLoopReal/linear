# ADR 0002 — AGENTS.md / CLAUDE.md split (D2)

## Status

Accepted

## Context

Multiple agent tooling conventions look for different file names at the
repo root:

- Codex CLI and "AGENTS.md"-aware tools read `AGENTS.md`.
- Claude Code reads `CLAUDE.md` by default.
- Other ecosystems (Cursor, Factory) honor both, or honor one
  conditionally.

linear-cli initially handled this by making `CLAUDE.md` a **symlink to
`AGENTS.md`** — the two filenames resolved to the same content. That
worked, but it hid that the two filenames are read in different
contexts:

- `AGENTS.md` is the **architecture / contributor brief** — invariants,
  layer rules, anti-patterns, the decision tree for adding
  functionality. It is read once per session by an agent picking up a
  task.
- `CLAUDE.md` is an **entry point** — the file Claude Code loads
  preferentially on session start. It should be small enough to read
  in the first few seconds, and should point at the right deep-dive
  document rather than embed every rule.

Treating both as the same file meant either:

- `AGENTS.md` stayed small (lost detail an architecture brief needs),
  **or**
- `CLAUDE.md` was huge on session start (cost context budget on every
  load).

PROCESS.md §D2 resolved this by separating them into three files with
distinct roles.

## Decision

1. **Drop the `CLAUDE.md` → `AGENTS.md` symlink.** Replace with two
   real files.
2. **`AGENTS.md` stays the architecture / contributor brief.** Content
   is unchanged from the pre-D2 file: identity, audience, quick
   commands, auth resolution, commit rules, architecture, invariants,
   decision tree, testing, anti-patterns, GraphQL workflow, usage
   docs, file map, verification checklist. The only change at the D2
   boundary is a 2-line companion-files header pointing at
   `CLAUDE.md` and `AGENT_INSTRUCTIONS.md`.
3. **`CLAUDE.md` becomes a thin pointer (≤30 lines).** It contains a
   title, a "Read First" link cluster (AGENTS.md, AGENT_INSTRUCTIONS.md,
   PR_MAINTAINER_GUIDELINES.md when present), and a 3–5 bullet
   "Current Ground Rules" block. **It does not duplicate any content
   from the linked sources.**
4. **`AGENT_INSTRUCTIONS.md` ships separately** as the deep-dive
   operational guide: workflow ("land the plane"), visual design
   system, non-interactive shell rules, agent session patterns,
   storage / source-of-truth boundary.

## Consequences

### Positive

- Each filename serves the audience that loads it. Claude Code
  consumers get a fast entry-point read; agents doing architecture
  work get the architecture brief; agents doing daily operational work
  get the operational guide.
- The thin `CLAUDE.md` discipline is enforceable by review — if a fact
  appears in `CLAUDE.md` and in `AGENTS.md`, the reviewer fixes
  `CLAUDE.md` by removing the duplicate.
- Future deep-dive content (e.g., `PR_MAINTAINER_GUIDELINES.md`) lands
  as its own file and joins the "Read First" cluster — no need to
  bloat the entry point.

### Negative

- Three files to keep in sync (AGENTS.md, CLAUDE.md, AGENT_INSTRUCTIONS.md).
  The thin-pointer rule mitigates this: only `CLAUDE.md` is fragile
  to drift, and it is small enough that drift is visible in PR diffs.
- Pre-D2 history-readers who relied on `cat CLAUDE.md` to get the
  architecture brief will see only the pointer; the pointer's "Read
  First" section tells them where the content moved to.
- There is no automated `doctor`-style check on the split today.
  linear-cli has no linter that verifies "CLAUDE.md is ≤30 lines and
  contains only pointers." Discipline is enforced by review only.

## Related

- [`CLAUDE.md`](../../CLAUDE.md), [`AGENTS.md`](../../AGENTS.md),
  [`AGENT_INSTRUCTIONS.md`](../../AGENT_INSTRUCTIONS.md) — the three
  files this ADR governs.

## Date

2026-05-17
