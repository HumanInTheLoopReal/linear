# Molecules Reference

This reference covers `linear`'s reusable work-template system —
**molecules**: TOML files that spawn sub-issue trees on Linear.

There is no ephemeral / draft tier and no second storage backend;
every molecule poured becomes real Linear issues with an epic + child
trees + typed relations.

## Concept

A **molecule** is a TOML template on disk describing a parameterized
DAG of issues:

- A **proto** — the TOML file (template definition)
- A **pour** — the act of spawning the proto into Linear, with
  variable substitution
- A **molecule instance** — the resulting tree in Linear: one
  auto-generated **epic** (titled from the proto's `description`
  field) plus all the `[[issues]]` children, wired with `parent` and
  `blocks` relations

| Concept | Storage | Synced | Use Case |
|---------|---------|--------|----------|
| Proto | TOML on disk | n/a (file) | Reusable template |
| Pour / molecule instance | Linear (real issues + relations) | Yes (server-side) | Persistent work |

There is **no ephemeral / one-shot tier**. If you want one-shot
operational work that doesn't pollute history, archive (or delete) the
spawned issues after.

## When to Use Molecules

### Use molecules when:
- **Repeatable patterns** — same workflow structure used multiple
  times (releases, reviews, onboarding)
- **Team knowledge capture** — encode tribal knowledge as executable
  templates
- **Audit trail matters** — work that needs to be tracked in Linear
- **Cross-session persistence** — work spanning multiple days /
  sessions (Linear is the source of truth)

### Don't use molecules when:
- A one-off task — just `linear create` directly
- The DAG has fewer than 3 children — overhead isn't worth it
- The template would have zero variables — copy-paste is fine

---

## Proto Management

### Search paths

`linear molecules list` walks these directories in precedence order:

1. `./.linear/molecules/` — **project-local** overrides (committed
   into the repo)
2. `~/.linear/molecules/` — **user-global** protos
3. `<package>/molecules/builtin/` — starters bundled with `linear`

Same-name protos in higher-precedence paths shadow lower ones. A
project can tweak a bundled formula without forking the package.

### Proto file shape

A proto is a TOML file. The schema (per
`src/services/molecules-toml.ts`):

- Top-level: `name = "..."`, `description = "..."`
- `[[variables]]` blocks with `name` and `description`
- `[[issues]]` blocks with **`key`** (referenceable id), **`title`**,
  and optional `type`, `priority`, `description`, `depends_on` (array
  of other `key`s). No `parent`, no `assignee` field — the pour
  auto-creates one epic from the top-level `description`, and every
  `[[issues]]` becomes its child.

Minimal example (`./.linear/molecules/release.toml`):

```toml
name = "release"
description = "Standard release workflow"

[[variables]]
name = "version"
description = "Semver version being released"

[[issues]]
key = "tests"
title = "Run regression suite for {{version}}"
type = "task"
priority = 2

[[issues]]
key = "tag"
title = "Cut git tag v{{version}}"
type = "task"
priority = 2
depends_on = ["tests"]

[[issues]]
key = "publish"
title = "Publish v{{version}} to npm"
type = "task"
priority = 2
depends_on = ["tag"]
```

`{{var}}` placeholders resolve at pour time from `--var key=value`
flags. There are no default values for variables — every declared
variable must be passed or the pour errors.

### Listing protos

```bash
linear molecules list
linear molecules list --json
```

Output is grouped by source (project / user / builtin) so you can
see which protos a teammate could see in CI vs locally.

### Inspecting a proto

```bash
linear molecules show release
linear molecules show release --json
```

Shows the resolved variables, child issue list, and any
`depends_on` edges.

---

## Spawning Molecules

### Basic pour

```bash
linear molecules pour release --var version=1.2.0 --var owner=@me
```

This:

1. Resolves the proto from the search path
2. Substitutes `{{var}}` placeholders
3. Creates the epic in Linear's default team (or `--team <key>`)
4. Creates each child with `parent = <epic.id>` so it shows as a
   sub-issue
5. Creates `blocks` relations for every `depends_on` edge in the
   TOML
6. Labels the epic with `linear-molecule:<name>` and
   `linear-molecule-instance`

### Dry run

```bash
linear molecules pour release --var version=1.2.0 --dry-run
```

Prints the plan (titles, parents, deps) without calling Linear's
GraphQL mutations. No issues are created, no relations established.

### Team selection

```bash
linear molecules pour release --team ENG --var version=1.2.0
```

Order: `--team` flag → `LINEAR_TEAM` env → `team.default` config →
error.

---

## Inspecting Molecules in Linear

### List currently spawned molecules

```bash
linear molecules current
linear molecules current --team ENG
```

Lists every poured molecule epic in the workspace (or one team) with
its completion percentage. The epic is the one auto-created from the
proto's `description` field at pour time and labeled
`linear-molecule:<name>` + `linear-molecule-instance`. You can also
filter on the same label manually:

```bash
linear list --label linear-molecule:release
```

### Drill into one molecule's progress

```bash
linear molecules progress ENG-501
linear molecules progress ENG-501 --json
```

Shows per-child status (Todo / In Progress / Done / etc.) and any
intra-molecule `blocks` edges. Use this after `linear molecules
current` to see exactly which child is blocking the epic from
closing.

---

## What Linear's Molecules Do Not Do

Molecules in `linear` are intentionally minimal:

- **No ephemeral / draft instances.** Everything a pour creates lands
  in Linear immediately; there is no second storage backend.
- **No compound templates or chained pours.** Multi-template chaining
  isn't planned for v1 — use two `pour` calls if you need it.
- **No "extract proto from existing epic" flow.** Define the TOML by
  hand.
- **No archive / discard sugar.** Archive issues directly in Linear
  if needed.
- **Only one phase: `pour`.** There are no draft-vs-commit flags.
- **No cross-team / cross-workspace template deps.** Use Linear's
  typed relations across teams within a single workspace.

These gaps are deliberate. If your team needs the ephemeral or
extract flows, file an issue against `linear-cli`.

---

## Common Patterns

### Pattern: Weekly review

```toml
# ./.linear/molecules/weekly-review.toml
name = "weekly-review"
description = "Weekly review {{week}}"

[[variables]]
name = "week"
description = "ISO week label, e.g. 2026-W21"

[[issues]]
key = "audit-open"
title = "Audit open issues for {{week}}"
type = "task"

[[issues]]
key = "priorities"
title = "Update priorities for {{week}}"
type = "task"

[[issues]]
key = "archive"
title = "Archive stale work for {{week}}"
type = "task"
```

Then:
```bash
linear molecules pour weekly-review --var week=2026-W21
```

The pour creates one epic (`Weekly review 2026-W21`, from the proto's
`description`) and attaches the three children to it.

### Pattern: Release with rollback prereq

```toml
[[issues]]
key = "staging-validation"
title = "Validate {{version}} on staging"
type = "task"

[[issues]]
key = "deploy"
title = "Deploy {{version}}"
type = "task"
depends_on = ["staging-validation"]

[[issues]]
key = "rollback-runbook"
title = "Prepare rollback runbook for {{version}}"
type = "task"
# (no depends_on — runs in parallel with deploy prep)
```

After the pour, `linear list --parent <epic-id>` surfaces the children;
`linear ready` (no `--parent` flag) surfaces whatever's unblocked
across the workspace.

### Pattern: Capture tribal knowledge from an existing epic

Linear molecules don't have a `distill` verb. The manual workflow:

```bash
# 1. Look at the existing epic
linear depends tree ENG-300 --json > /tmp/release-shape.json

# 2. Hand-write the proto in ./.linear/molecules/release.toml
#    (use the JSON as a structural reference)

# 3. Verify
linear molecules show release
linear molecules pour release --var version=test --dry-run

# 4. Commit
git add .linear/molecules/release.toml
git commit -m "molecules: add release proto"
```

---

## CLI Quick Reference

| Command | Purpose |
|---------|---------|
| `linear molecules list` | List available protos (project / user / builtin) |
| `linear molecules show <name>` | Show proto's structure and variables |
| `linear molecules pour <name>` | Spawn proto into Linear (epic + children + deps) |
| `linear molecules pour <name> --dry-run` | Preview the pour without writing |
| `linear molecules pour <name> --team <key>` | Override default team |
| `linear molecules current` | List poured molecule epics with completion % |
| `linear molecules progress <epic-id>` | Per-child progress of one molecule |

---

## Troubleshooting

**"Proto not found"**
- Run `linear molecules list` to confirm the proto's `name` matches
  exactly
- Project-local protos must live under `./.linear/molecules/`

**"Variable not substituted"**
- Use `--var key=value` syntax
- Check the proto for `{{key}}` placeholders with
  `linear molecules show`

**"Team not resolved"**
- Pass `--team <KEY>` or `linear config set team.default <KEY>`
- See [TROUBLESHOOTING.md](TROUBLESHOOTING.md#team-key-not-recognized)

**"Dependency cycle"**
- `linear molecules pour` rejects protos whose `depends_on` graph has
  a cycle. `linear molecules show <name>` highlights the offending
  edge.

**"Issues created but no `linear-molecule-instance` label on epic"**
- The pour partially failed. Check `linear show <epic-id>` — if the
  label is missing, re-run `pour` (Linear is idempotent for relations
  but not for issue creation; you may end up with duplicate
  children).
