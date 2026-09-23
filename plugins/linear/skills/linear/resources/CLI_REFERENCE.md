# CLI Command Reference

**For:** AI agents and developers using the `linear` command-line
interface
**Version:** see `linear info --json`

## Quick Navigation

- [Health & Status](#health--status)
- [Agent Context & Memory](#agent-context--memory)
- [Basic Operations](#basic-operations)
- [Issue Management](#issue-management)
- [Dependencies & Labels](#dependencies--labels)
- [Filtering & Search](#filtering--search)
- [Visualization](#visualization)
- [Advanced Operations](#advanced-operations)
- [Workspace & Sync](#workspace--sync)

## Health & Status

### Doctor (Start Here for Problems)

```bash
# Basic health check
linear doctor                  # Check auth, team config, connectivity
linear doctor --json           # Machine-readable output

# Specific checks (use `linear doctor --help` for the complete current list)
linear doctor --check=auth     # Auth-only probe
linear doctor --check=stale    # Find stale issues
linear doctor --check=unassigned # Find open issues without an assignee
linear doctor --check=labels   # Verify required labels exist
```

`linear doctor` validates the API token, default team, and read access
against your Linear workspace. It does not modify any state.

### Status Overview

```bash
# Quick workspace snapshot
linear status                  # Summary of ready/in-progress/blocked
linear status --json           # JSON format
linear status --assigned       # Show issues assigned to you (LINEAR_USER)
linear stats                   # Alias for `linear status`
```

### Prime (AI Context)

```bash
# Output AI-optimized workflow context
linear prime                   # Default: full workflow brief
linear prime --memories-only   # Print persistent memories only
linear prime --export <path>   # Also write the brief to <path> (path required)
linear prime --mcp             # Prepend an "MCP-available" hint
linear prime --stealth         # Omit the git-ops session-close protocol
linear prime --full            # Force full brief even with --memories-only
```

`linear prime` is the canonical session-start command. Run it before
any tracked work; it loads team conventions, custom states, label
taxonomy, and persistent memories. See [WORKFLOWS.md](../references/WORKFLOWS.md) for
the session-start checklist.

**Customization:** Place `.linear/PRIME.md` (project) or
`~/.linear/PRIME.md` (user) to override the default output.

## Agent Context & Memory

### Prime

`linear prime` prints AI-optimized workflow context. Hooks can run it
automatically at session start and before compaction; hookless agents
should run it manually when they need the current workflow rules.

```bash
linear prime                   # Default: workflow brief
linear prime --memories-only   # Print persistent memories only
linear prime --export <path>   # Also persist to <path> (e.g. for cache-warming hooks)
```

Customize the default context by placing a `.linear/PRIME.md` file in
the project or `~/.linear/PRIME.md` globally.

### Persistent Memories

Use memories for durable project facts that should survive account
rotations and context compaction. Do not use `MEMORY.md` files for this
purpose.

```bash
linear remember "always run auth tests with TEST_DB=postgres"
linear remember "auth module uses JWT, not server sessions" --key auth-jwt
linear memories                # List all memories
linear memories auth           # Search memory keys and values
linear recall auth-jwt         # Print one full memory
linear forget auth-jwt         # Delete one memory
```

Memories are injected by `linear prime`. For low-token hooks, use
`linear prime --memories-only`.

## Basic Operations

### Check Status

```bash
# Check auth and team config
linear info --json

# Example output (the actual envelope — no "ok" wrapper):
# {
#   "cli_version": "2026.9.1",
#   "platform": { "key": "linear" },
#   "workspace": { "id": "…", "name": "…", "url_key": "…" },
#   "viewer":    { "id": "…", "name": "…", "email": "you@example.com" },
#   "counts":    { "open": 25, "open_saturated": false }
# }
# Use `linear info >/dev/null 2>&1` as a "did auth resolve?" probe;
# exits non-zero if no token resolved.
```

### Find Work

```bash
# Find ready work (no blockers)
linear ready --json            # Aliased to `linear next`
linear next --json
# Note: `linear list` has no --ready flag — use `linear ready` for this.

# Find blocked work
linear blocked --json
linear blocked --parent ENG-100 --json   # Blocked descendants of an epic

# Find stale issues
linear stale --days 30 --json            # Default: 30 days
linear stale --days 90 --status in_progress --json
linear stale --limit 20 --json
```

## Issue Management

### Create Issues

```bash
# Basic creation
# IMPORTANT: title is positional (NOT a --title flag), and quote it.
# Type is set via the 'type:<value>' label convention (--labels type:bug).
linear create "Issue title" --labels type:bug --priority 1 --description "Description" --json

# Use stdin for descriptions with special characters
echo 'Description with `backticks` and "quotes"' | \
  linear create "Title" --labels type:task --priority 1 --stdin --json
echo 'Updated text with $variables' | linear update ENG-42 --description=-

# Longer bodies are easier to keep in a file
linear create "Title" --body-file=description.md --json

# Create with labels (--labels, plural; auto-creates on first use)
linear create "Issue title" --labels type:bug,critical --priority 1 --json

# Examples with special characters (all require quoting):
linear create "Fix: auth doesn't validate tokens" --labels type:bug --priority 1 --json
linear create "Add support for OAuth 2.0" \
  --description "Implement RFC 6749 (OAuth 2.0 spec)" --json

# Create multiple issues from markdown / JSON file
linear import feature-plan.md --json
linear import issues.jsonl --json

# Create epic with hierarchical child tasks
# (Linear has no native epic type — any open issue with children is an epic.
# Use --labels type:epic by convention; --parent-ticket attaches children.)
linear create "Auth System" --labels type:epic --priority 1 --json   # Returns: ENG-101
linear create "Login UI" --priority 1 --parent-ticket ENG-101 --json
linear create "Backend validation" --priority 1 --parent-ticket ENG-101 --json
linear create "Tests" --priority 1 --parent-ticket ENG-101 --json

# Create and link an approved promoted finding — two commands (there is no --deps flag on create)
new_id=$(linear create "Promoted auth bug" --labels type:bug --priority 1 --json | jq -r .identifier)
linear depends add "$new_id" ENG-100 --type discovered-from
```

### Quick Capture (q)

```bash
# Create issue and output only the ID (for scripting)
linear q "Fix login bug"                  # Outputs: ENG-201
linear q "Task" -t task -p 1
linear q "Bug" -t bug -l critical

# Scripting examples
ISSUE=$(linear q "New feature")           # Capture ID in variable
linear q "Task" | xargs linear show       # Pipe to other commands
```

### Update Issues

```bash
# Update one or more issues
linear update <id> [<id>...] --priority 1 --json
# Note: --claim is a flag on `linear ready/next`, NOT on `update`.
# To claim work: `linear ready --claim` (one selector must own queue selection).
# To assign + transition explicitly:
linear update <id> --assignee <user> --status "In Progress" --json

# Edit issue fields in $EDITOR (HUMANS ONLY - not for agents)
# Agents should use 'linear update' with field-specific parameters instead
linear edit <id>                # Edit description
linear edit <id> --title        # Edit title
linear edit <id> --notes        # Append a note
```

### Close/Reopen Issues

```bash
# Complete work (supports multiple IDs)
linear close <id> [<id>...] --reason "Done" --json

# Reopen closed issues (supports multiple IDs)
linear reopen <id> [<id>...] --reason "Reopening" --json
```

### View Issues

```bash
# Show dependency tree
linear depends tree <id>
linear dep tree <id>                      # alias

# Get issue details (single ID only — `show` does NOT accept multiple IDs)
linear show <id> --json
linear read <id> --json                   # alias

# Include extra sections (--long does NOT exist; use these instead):
linear show <id> --with-attachments      # attach list
linear show <id> --with-comments         # every comment, flat
linear show <id> --with-comment-threads  # threaded comments
linear show <id> --with-reactions        # root-issue reactions
```

### Comments

```bash
# List discussions on an issue
linear discussions ENG-123                # Human-readable
linear discussions ENG-123 --json         # JSON format

# Add a top-level discussion (canonical)
linear discuss ENG-123 "This is a comment"

# Add a reply to an existing thread
linear reply <thread-id> "..."
```

### Activity timeline

```bash
# Comments and history events merged, newest first — one call instead of
# `issues comments` plus `issues history`
linear issues activity ENG-123 --json
linear issues activity ENG-123 --limit 20
linear issues activity ENG-123 --comments-only   # discussion only
linear issues activity ENG-123 --after <entry-id> # resume after an entry
```

Each entry is tagged `kind: "comment" | "event"`; replies carry
`parent_id` so a threaded view needs no second fetch. `--after` takes an
entry id from a previous page, not an opaque cursor. Linear populates
history asynchronously, so a change made seconds ago may not appear yet —
comments do appear immediately.

## Dependencies & Labels

### Dependencies

```bash
# Link an approved promoted finding (two-command form — create has no --deps flag)
linear depends add <discovered-id> <parent-id> --type discovered-from
```

Linear's relation types:

- `blocks` / `blocked-by` (native)
- `relates-to` / `related` (native, bidirectional)
- `duplicate-of` (native; **not** accepted by `linear depends add` —
  use `linear duplicate <id> --of <canonical>`, which closes the
  duplicate and links it in one shot)
- Linear-Hack types (`tracks`, `discovered-from`, `until`, `caused-by`,
  `validates`, `supersedes`) materialize as a `relates-to` plus a
  `dep-type:<type>` label on the source issue

See [DEPENDENCIES.md](DEPENDENCIES.md) for the full type table.

### Labels

```bash
# Label management (supports multiple IDs — last positional is the label)
linear label add <id> [<id>...] <label> --json
linear label remove <id> [<id>...] <label> --json
linear label show <id>                    # labels currently on one issue
linear labels list --json                 # workspace-wide labels (paginated)

# Label entity CRUD (the label itself, not its use on an issue)
linear labels create <name> --description "..."   # idempotent
linear labels update <label> --name <new-name>    # rename everywhere at once
linear labels update <label> --description "..."  # only the fields you pass change
linear labels delete <label>                      # removes it from every issue
```

`labels remove` takes a label off one issue; `labels delete` destroys the
label workspace-wide. A TTY session is asked to confirm the delete;
`--force` and non-interactive agent runs proceed without prompting, so
treat it like any other destructive verb under the mutation protocol.

## Filtering & Search

### Basic Filters

```bash
# Filter by status, priority, assignee, type-label
linear list --status "In Progress" --priority 1 --json
linear list --assignee alice --json
# Type is a `type:<value>` label, so filter via --label:
linear list --label type:bug --json
# Note: `linear list` has no --id flag. To fetch specific issues, use `linear show <id>`
# per ID (or pipe a list of IDs into xargs).
```

### Label Filters

```bash
# Labels (AND: must have ALL — comma-separated, repeatable, or both)
linear list --label bug,critical --json
linear list --label bug --label critical --json   # same filter
# A label that does not exist matches nothing: empty result, stderr warning.
# Note: there is no --label-any (OR) flag. For OR semantics, run multiple
# queries and union the results, or rely on Linear's web UI search.

# State type: the workspace-wide lifecycle category, whatever the team
# named the state. Server-side, no --team needed.
linear list --all-teams --state-type started --json
```

### Search Command

```bash
# Full-text search across title, description, and ID
linear search "authentication bug"
linear search "login" --status "In Progress" --json
linear search "database" --label backend --limit 10
linear search "ENG-5"                              # Partial ID

# Filtered search (no --priority-min/--priority-max; --priority is a single value 0-4)
linear search "security" --priority 1
linear search "bug" --created-after 2026-01-01
linear search "refactor" --assignee alice
# Note: there is no --sort / --reverse / --long on `search`. Sort downstream
# in jq (`jq 'sort_by(.priority)'`) or use the Linear web UI for advanced sorting.
```

### Text Search (use `linear search`)

`linear list` does NOT support `--title`, `--title-contains`, `--desc-contains`,
or `--notes-contains` filters. For free-text matching against title /
description / identifier, use `linear search`:

```bash
linear search "auth" --json
linear search "implement" --status "In Progress" --json
linear search "TODO" --label backend --json
```

Search hits title, description, and identifier in one query. It's
cheaper than chaining list filters and matches Linear's own search index.

### Date Range Filters

```bash
# Date range filters (YYYY-MM-DD)
linear list --created-after 2026-01-01 --json
linear list --created-before 2026-12-31 --json
linear list --updated-after 2026-06-01 --json
linear list --updated-before 2026-12-31 --json
# Closure dates use "--completed-*", not "--closed-*":
linear list --completed-after 2026-01-01 --json
linear list --completed-before 2026-12-31 --json
# Also available: --due-before, --due-after
```

### Empty/Null Checks

`linear list` does not currently expose `--empty-description`,
`--no-assignee`, or `--no-labels` flags. Filter downstream in jq:

```bash
linear list --json | jq '.nodes[] | select(.description == null or .description == "")'
linear list --json | jq '.nodes[] | select(.assignee == null)'
linear list --json | jq '.nodes[] | select(.labels.nodes | length == 0)'
```

For "issues that block / are blocked", use the built-in filters:

```bash
linear list --has-blockers --json   # only issues that are blocked
linear list --is-blocking --json    # only issues that block others
```

### Priority Filter

`linear list` accepts a single `--priority <0-4>`. There is no
`--priority-min` / `--priority-max` range form. For ranges, filter in jq:

```bash
linear list --json | jq '.nodes[] | select(.priority <= 1)'   # P0 + P1
linear list --json | jq '.nodes[] | select(.priority >= 2)'   # P2 and lower
```

### Combine Filters

```bash
linear list --status "In Progress" --priority 1 \
  --label urgent --json | jq '.nodes[] | select(.assignee == null)'
```

## Visualization

### Graph (Dependency Visualization)

```bash
# Show dependency graph for an issue
linear depends graph ENG-123              # JSON (default for agents)
linear depends graph ENG-123 --dot        # Graphviz DOT (use --dot, NOT --format dot)

# Show graph for an epic (includes all children)
linear depends graph ENG-100

# Cycle check (the verb is `cycles`, not `check`)
linear depends cycles                     # Top-level: scan workspace for cycles
linear depends cycles --json
linear depends graph check                # Equivalent — subcommand under `graph`
```

**Graph interpretation:**

- The leftmost layer is unblocked and can start now
- Each layer waits on the one before it
- Anything sharing a layer can be worked in parallel

**Status icons (text mode):**
○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

## Global Flags

Global flags work with any `linear` command and must appear **before**
the subcommand.

### JSON Mode

```bash
# JSON output for programmatic use
linear --json <command>                   # 2-space-indented multi-line (default)
linear --json=pretty <command>            # Same as bare --json
linear --json=compact <command>           # Single-line whitespace-minimized
```

Three envelope shapes coexist (no `{ok, data}` wrapper):
- Paginated list verbs (`list`, `teams list`, `search`, ...) → `{nodes, pageInfo}` — use `jq '.nodes[]'`
- Filtered view verbs (`ready`, `blocked`, `stale`) → raw array — use `jq '.[]'`
- Detail verbs (`show`, `read`) → single object — use `jq .priority`

### Trimming output (token discipline)

```bash
# Single-line JSON; implies --json and beats --json=pretty
linear --compact <command>

# Keep only the named dot-paths; implies --json
linear --fields nodes.identifier,nodes.title list
linear --fields nodes.identifier,nodes.state.name --compact list
linear --fields identifier,state.name show ENG-123
```

Paths address the envelope as emitted, so a list verb narrows **through
its container** (`nodes.identifier`, not `identifier`) — match the shape
above to the verb you are calling. A path that stops at a subtree keeps
that whole subtree; unknown paths are skipped rather than erroring, so a
typo yields a thinner object, not a failure. Prefer these over piping
full payloads through `jq` when the goal is a smaller context.

### Auth Override

```bash
# Override token resolution (env > config > legacy)
linear --api-token lin_api_XXX <command>

# Custom Linear endpoint (rare; usually for proxies)
LINEAR_ENDPOINT=https://api.linear.app/graphql linear <command>
```

### Team Override

```bash
# Override the team on commands that accept --team
linear issues list --team ENG
LINEAR_TEAM=ENG linear <command>
```

**See also:** [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for auth and
team-resolution failure modes.

## Advanced Operations

### Cleanup

```bash
# Archive completed work (list returns {nodes, pageInfo}, so use .nodes[])
linear list --status Done --completed-before 2026-01-01 --json | \
  jq -r '.nodes[].identifier' | xargs -n1 linear archive

# Delete (irrecoverable — use sparingly; no --yes flag, just confirm what you pass)
linear delete ENG-999
```

### Duplicate Detection & Merging

```bash
# Find duplicates across the whole workspace (no title arg — it's a scan)
linear duplicates                                    # group by exact title+desc
linear duplicates --method mechanical                # token-similarity ranking
linear duplicates --method ai                        # Claude semantic compare (needs ANTHROPIC_API_KEY)
linear duplicates --auto-merge --dry-run             # preview the merge plan

# Link a redundant issue to the one it repeats, and close it in the same call
linear duplicate ENG-43 --of ENG-41 --json
linear mark-duplicate ENG-43 --of ENG-41 --json     # alias
```

### Audit

```bash
# Append-only audit log of agent interactions
linear audit record --kind tool_call --tool-name deploy --issue-id ENG-42
linear audit label <entry-id> --label reviewed            # Append-only label correction
linear audit path                                          # Print the log file path
# Note: there is no `audit list` or `audit show` subcommand.
# Read entries directly: `cat $(linear audit path)` or `tail -f $(linear audit path)`.
```

The audit log lives at `./.linear/audit.jsonl` (per-repo) or
`~/.linear/audit.jsonl` (per-user). It is a local artifact — **Linear
itself is the durable source of truth**; the audit log is for replaying
agent decisions during post-mortems.

### Decision Records

```bash
# Create a decision issue with structured rationale
# (Note: `decision record` takes --title as a FLAG, unlike `create` which is positional)
linear decision record --title "Use Postgres over MySQL" \
  --rationale "Better JSON support, our team has experience" \
  --alternatives "MySQL, SQLite" \
  --affects "ENG-12,ENG-14" \
  --json

linear decision list                      # all type:decision issues
linear decision show <id>                 # full detail for one decision
```

`linear decision` is sugar over `linear create --labels type:decision`
with rationale, alternatives, and affected-area stored as labeled
sections in the description.

`decision record --priority` uses the same strict mapping as issue creation:
`1=Urgent` through `4=Low`, with `P1`-`P4` shorthand accepted.

## Workspace & Sync

```bash
# Where do project-local config and recipes live?
linear where

# See what recipes are available / inspect installer
linear setup --list
linear setup --check <recipe>             # check whether a recipe is installed

# Confirm token + team + connectivity
linear info --json

# Pull workspace metadata (teams, states, labels)
linear teams list --json
linear labels list --json
```

> **Note:** there is no `linear sync` or `linear push`. Linear is the
> source of truth; the CLI reads and writes via the GraphQL API on every
> command. See [RESUMABILITY.md](../references/RESUMABILITY.md) for the implications.

## Issue Types

Linear has no enum for issue type. Type is set by attaching a
`type:<value>` label via `--labels type:bug` on `create`/`update`.

The `-t/--type <value>` short flag exists on **`linear q`** (quick
capture) only — it defaults to `task`. It does NOT exist on
`linear create`.

Conventional values:

- `type:bug` — Something broken that needs fixing
- `type:feature` — New functionality
- `type:task` — Work item (tests, docs, refactoring)
- `type:epic` — Large feature composed of multiple issues (any open
  issue with children is treated as an epic; no separate Linear type)
- `type:chore` — Maintenance work (dependencies, tooling)

**Hierarchical children:** Epics get child issues via
`--parent-ticket <id>` on `create` (or `linear update <child>
--parent-ticket <epic>` after the fact). Sub-issue trees are unbounded
in depth on Linear's side; the recommended convention is 3 levels.

## Priorities

Linear's priority field is `0..4`. Mutation commands such as
`create`/`update`/`q`/`decision record` accept:

- `1` — Urgent (security, data loss, broken builds)
- `2` — High (major features, important bugs)
- `3` — Medium (nice-to-have features, minor bugs)
- `4` — Low (polish, optimization, backlog)
- Omit `--priority` → Linear's `0` ("No priority"). Explicit `--priority 0`
  is rejected by mutation commands with an explanatory error. Read filters
  on `list`/`search` accept `0` so no-priority issues remain queryable.

`-p/--priority` also accepts `P1..P4` shorthand.

`linear decision record --priority` uses the same scale as every other
creation command.

## Dependency Types

- `blocks` / `blocked-by` — Hard dependency (issue X blocks issue Y)
- `relates-to` / `related` — Soft relationship (issues are connected)
- `duplicate-of` — Points a redundant issue at the one that survives
- `discovered-from` (Linear-Hack) — Track issues discovered during work
- `parent-child` — Set via `linear issues update <child>
  --parent-ticket <epic>` (NOT an `issueRelation`; Linear models this
  on the issue itself). Clear with `--clear-parent-ticket`.

Of all the relation types, `blocks` is the only one that changes what shows up as ready.

**Note:** `linear depends add <new> <parent> --type discovered-from`
materializes the edge as a Linear `relates-to` + a
`dep-type:discovered-from` label on the new issue. It does **not**
auto-inherit the parent's other labels — propagate those yourself with
`linear label add` if you want them, or use `linear molecules pour`
for templated spawning where you can declare the label set up front.

## External References

Linear has no first-class `external_ref` field. The convention is:

- A label like `gh:123` or `jira:PROJ-456`
- Or an attachment via `linear attachments create <issue-id> --url <url> --title "<label>"`

Both survive across sessions because Linear is the source of truth.

## Output Formats

### Human-Readable Output (default)

```bash
linear ready
# ENG-42  Fix authentication bug  [P1, bug, In Progress]
# ENG-43  Add user settings page  [P2, feature, Todo]
```

### JSON Output (Recommended for Agents)

Always use `--json` flag for programmatic use:

```bash
# Single issue (object envelope)
linear show ENG-42 --json

# Filtered view (raw array envelope)
linear ready --json

# Paginated list ({nodes, pageInfo} envelope)
linear list --json

# Operation result (mutations return JSON unconditionally)
linear create "Issue" --priority 1 --json
```

The JSON envelope is the durable contract. Text formatting may change
across versions; the JSON shape is stable.

## Common Patterns for AI Agents

### Claim and Complete Work

```bash
# 1+2. One selector finds and claims the first ready P1
linear ready --priority 1 --claim --json

# Explicit two-command equivalent:
linear ready --json                                # find candidates
linear update ENG-42 --assignee <you> --status "In Progress" --json

# 3. Work on it...

# 4. Close when done
linear close ENG-42 --reason "Implemented and tested" --json
```

### Link a Promoted Finding

```bash
# A human/planner promoted a bug originally discovered while working on ENG-100

# Two-command form (the only form — no --deps flag on create):
new_id=$(linear create "Promoted auth bug" --labels type:bug --priority 1 --json | jq -r .identifier)
linear depends add "$new_id" ENG-100 --type discovered-from
```

### Batch Operations

```bash
# Update multiple issues at once
linear update ENG-41 ENG-42 ENG-43 --priority 1 --json   # priority 1-4

# Close multiple issues
linear close ENG-41 ENG-42 ENG-43 --reason "Batch completion" --json

# Add label to multiple issues (last positional is the label)
linear label add ENG-41 ENG-42 ENG-43 urgent --json
```

### Session Workflow

```bash
# Start of session
linear prime                  # Load workflow context
linear ready --json           # Find work

# During session
linear create "..." --priority 1 --json
linear ready --claim --json                # one selector owns queue selection
# ... work ...

# End of session
# No `linear push` — every command writes through to Linear.
# Confirm state if you want:
linear show ENG-42 --json
```

There is no end-of-session sync step. Every mutating command persists
immediately to Linear via GraphQL.

## See Also

- [MULTI_AGENT.md](../references/MULTI_AGENT.md) — Selector, worker, reviewer, and human roles
- [WORKFLOWS.md](../references/WORKFLOWS.md) — Session-start and compaction-survival
  flows
- [DEPENDENCIES.md](DEPENDENCIES.md) — Relation type reference
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Auth, team, rate-limit
  failures
