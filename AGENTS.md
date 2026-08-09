# AGENTS.md

> Companion files: [CLAUDE.md](CLAUDE.md) is a thin entry point;
> [AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md) holds the deep-dive
> operational guide (visual design, non-interactive shell rules,
> "land the plane" workflow).

## Identity

Linear is a **CLI tool for Linear.app**. Read-only verbs print
**human-readable text by default** (formatted to stay shell-friendly),
and emit a structured JSON envelope when invoked with the global
`--json` flag (for agents / scripts).

It is designed for both human users and LLM agents: text output is the
default at the terminal, and `--json` is the durable contract for
programmatic consumers.

The `--json` envelope is Linear's **GraphQL-native shape** (camelCase,
nested `state.name` / `relations.nodes[]`) — a thin pass-through of the
Linear API rather than a flattened projection; see
[docs/json-schema.md](docs/json-schema.md) for the field-by-field
reference (lin-8yl1.1).

`linear` exposes a rich top-level verb vocabulary (e.g. `linear list` ≡
`linear issues list`, `linear ready` ≡ `linear next`, `linear dep tree`
≡ `linear depends tree`). The full alias map lives in
`src/commands/aliases.ts` and is applied via a pre-parse argv rewriter
in `src/main.ts`. Aliases are additive; qualified paths keep working.

- **Runtime**: Node.js ≥ 22, ES Modules, TypeScript strict mode
- **Package manager**: npm
- **Formatter/Linter**: Biome (`npm run check`)
- **Tests**: Vitest (`npm test`)
- **GraphQL codegen**: `npm run generate` (never edit `src/gql/`)

## Agent mode (output-token economy)

When an agent drives the CLI, the cost that matters is **output tokens the
agent reads back**. `linear` auto-detects agent contexts and trims that
bill — see `src/common/agent-mode.ts`.

**Detection** (`resolveAgentMode`, precedence top-down):

| Signal | Result |
|--------|--------|
| `LINEAR_AGENT_MODE=0` / `false` | OFF (explicit opt-out wins, even under Claude Code) |
| `LINEAR_AGENT_MODE=<anything else>` | ON |
| `CLAUDECODE` / `CLAUDE_CODE` set | ON (auto-detect the host) |
| otherwise | OFF |

**What agent mode changes** (defaults only — never a hard cap):

- **Lower default page size.** `list` / `search` / `next` default to
  `AGENT_LIST_LIMIT` (20) instead of 50/100 when you didn't pass
  `--limit`. `blocked` (a raw array) caps to 20 and prints
  `Showing N of M …` on **stderr**.
- **Compact JSON.** A bare `--json` emits the single-line payload instead
  of the 2-space-indented one. `--json=pretty` always stays pretty.

**The tradeoff & how to opt back in.** Trimming trades completeness for
tokens. An agent that needs the full set passes an explicit `--limit`
(`--limit 100`, or `--limit 0` = all for `blocked`) — the explicit value
always wins over the agent default. Paginated verbs surface
`meta.agent_mode: true` and `meta.truncated` in their `--json` envelope so
an agent can *see* it was trimmed and decide whether to re-fetch wider.

The flag is resolved once in `getRootOpts` and stamped onto the root
options, so `outputResult` / `resolveJsonMode` and every command inherit
it without threading env through each call site.

## Audience

This file is for AI coding agents working on the Linear codebase.
For user documentation, see [README.md](README.md).
For human contributor guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Quick Commands

```bash
npm install          # install deps, codegen, and lefthook (via prepare hook)
npm test             # unit tests (vitest)
npm run build        # compile to dist/
npm run generate     # regenerate GraphQL types from .graphql files
npm run check        # biome format + lint (auto-fix)
npm run check:ci     # biome format + lint (CI, no fix)
npm run generate:usage  # regenerate USAGE.md
```

## Auth resolution

The `linear` CLI resolves its API token itself — **do not require `LINEAR_API_TOKEN` to be exported** in scripts that invoke `linear`. Precedence (highest first):

1. `LINEAR_API_TOKEN` env var (if set)
2. Encrypted token file at `~/linear/token` (written by `linear auth login`)
3. Legacy `~/.linear_api_token` (still works; emits a deprecation warning)

To verify auth in a script before calling other commands, use `linear info >/dev/null 2>&1` — it exits non-zero if no token resolves. `linear auth login` is interactive (TTY-only), so scripts must either rely on pre-existing auth or fail clearly when it's missing rather than trying to authenticate themselves.

## Implicit per-repo scope

`linear` is a global CLI installed once per machine, but agents typically want
*per-repo* behavior: `cd repo && linear next` should show work for *this*
repository, not the whole workspace firehose. This is achieved without a
wizard by deriving a `git:<name>` label from the git remote on first use and
AND-ing it into reads / appending it to writes automatically.

**Two-layer config (git-config-shaped):**

| File                                | Layer    | Typical contents                              |
|-------------------------------------|----------|-----------------------------------------------|
| `~/.linear/config.json`             | global   | `linear.api_token`, `linear.endpoint`, `team.default` |
| `<repo>/.linear/config.json`        | local    | `scope.label`, `scope.team`, `scope.default_project` |

**Precedence:** `env > local > global > default`. Config writes default to
the local layer when inside a git repo; otherwise they fall back to global.

**Scope keys:**

- `scope.label` — the repo's marker label (e.g. `git:linear-cli`). Auto-set
  on first command in a git repo; AND-ed into list / search / next / blocked
  queries; auto-appended to `labelIds` on `linear create`. Created in Linear
  lazily on first write or eagerly via `linear adopt --all`.
- `scope.team` — per-repo override of `team.default`. Honored by
  `getDefaultTeam` ahead of the global `team.default`. `linear init --team`
  writes here when inside a git repo.
- `scope.default_project` — default project for `issues create` in this repo.

**Bypass flags (every scoped read accepts both):**

- `--no-scope` — ignore `scope.label` for this call (firehose mode).
- `--scope <label>` — substitute a different label without changing config.

**Environment opt-outs:**

- `LINEAR_NO_AUTO_INIT=1` — skip the silent first-write bootstrap. Useful in
  CI or one-off scripts that should not create local config files.

**`linear config` layered flags:**

- `linear config get <key>` — applies precedence; output reports
  `source ∈ { env, local, global, default }`.
- `linear config set <key> <value> [--local | --global]` — defaults to local
  inside a git repo. Mutually exclusive flags.
- `linear config unset <key> [--local | --global]`
- `linear config edit [--global]` — opens `$VISUAL`/`$EDITOR`/vim on the
  resolved layer's file (materializing it with 0o600 if absent).

**Migration helper:**

- `linear adopt` — dry-run by default; lists open issues missing the scope
  label so an existing Linear workspace can be back-filled.
- `linear adopt --all` — non-interactive tag pass. Idempotent (skips issues
  already carrying the label). Ensures the scope label exists in Linear.

**Doctor surfaces drift:** `linear doctor` adds three checks
(`scope_label_exists`, `scope_drift`, `scope_coverage`). The `scope_drift`
check is informational — it compares `scope.label` against what
`deriveScopeLabel()` would produce *now*, catching the case where the git
remote was edited after the local config was written.

**See:** `linear where` always shows the active scope block (label, source,
team, project, config path) so agents can confirm which scope is active
before issuing a query.

## Issue template + create gate

Agents must produce structured issues, not flat prose. A single **create
gate** enforces this on *every* creation path:

- `linear issues create` — validates `--description`.
- `linear epic create` — fail-fast pre-flight validates the parent (against
  the lighter `REQUIRED_SECTIONS_BY_TYPE.epic` set) **and every child**
  before any network call, so a malformed spec never leaves a half-built
  epic behind (Linear has no client-side transaction).
- `linear batch` — `create` ops carry no description field, so they are
  blocked by default (use `issues`/`epic create`, or `--no-validate`).

**The template is config-driven, not hardcoded:**

- `template.create` (config key) holds the markdown template. Precedence is
  the usual `local > global > default`. When unset, the gate falls back to
  the built-in `## Context` / `## Acceptance Criteria` / `## Test Plan` skeleton —
  so behavior is unchanged until someone sets a template. A round-trip
  invariant (`DEFAULT_CREATE_TEMPLATE` parses back to `REQUIRED_CREATE_SECTIONS`)
  guards the default.
- `linear template show | set | unset | path` manages it. `set` accepts
  `--from-default`, `--file <path>`, or `--stdin`, with `--local`/`--global`;
  it rejects a heading-free body (that would silently disable the gate).
- Required sections are parsed from the template's markdown headings
  (`requiredSectionsFromTemplate`); validation is lenient case-insensitive
  substring matching on heading text (`validateCreateDescription`).
- `validation.on-create` ∈ `{off, warn, error}` (default `error`) sets
  strictness; `--validate`/`--no-validate` override per call.

**Code:** `src/services/template-service.ts` (resolve + parse),
`src/services/lint-service.ts` (`validateCreateDescription`, `renderSkeleton`),
`src/commands/template.ts` (the command), and the `enforce*CreateValidation`
gates in `src/commands/{issues,epic,batch}.ts`.

## Commit Rules

- **Conventional Commits** required (enforced by commitlint via lefthook).
- **Issue/PR refs** in commit body when applicable: `Closes #n`, `Refs #n`, `Part of #n`.
- **No AI co-author trailers.** Do not add `Co-authored-by` for AI assistants.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full commit types table and examples.

## Architecture (5 Layers)

```
CLI Input → Command → Resolver → Service → outputResult / outputSuccess
               │         │          │            │
           createContext  SDK     GraphQL    text formatter | JSON envelope
                        (UUID)   (data)      (--json flips to JSON path)
```

| Layer | Directory | Client | Responsibility |
|-----------|-----------------|---------------------|--------------------------------------|
| Client | `src/client/` | — | Thin API wrappers, no logic |
| Resolver | `src/resolvers/` | `LinearSdkClient` | Human ID → UUID conversion |
| Service | `src/services/` | `GraphQLClient` | Business logic, CRUD via GraphQL |
| Command | `src/commands/` | Both via `createContext()` | CLI orchestration only |
| Common | `src/common/` | — | Shared types, errors, output, auth |

### Invariants (P0 — violations fail CI/review)

1. **No `any` types.** Use `unknown`, codegen types, or explicit interfaces.
2. **Strict layer separation.** No cross-layer imports:
   - Resolvers must not import services (or vice versa).
   - Commands must not import `GraphQLClient` directly.
3. **Client-layer contract:**
   - Resolvers → `LinearSdkClient` by default.
   - Services → `GraphQLClient` only.
   - Commands → both, via `createContext()`.
   - **Narrow exceptions allowed only when SDK lacks required capability**, with explicit `ARCHITECTURAL EXCEPTION` docstring in code (current examples: milestone/project-status lookups, initiative relation/link ID lookup helpers).
4. **ID resolution happens once**, in resolvers only. Services accept UUIDs.
5. **All commands** use `handleCommand()` wrapper. Read-only verbs dispatch via `outputResult(data, textFormatter, getRootOpts(command))` — the helper chooses text (default) vs JSON (`--json`). Verbs without a text formatter yet (mutations, plus a handful of verbs with no meaningful text view) still call `outputSuccess()` directly; migrating each one is tracked by the Phase 2 meta-issue (`lin-i5r2`).
6. **Explicit return types** on all exported functions.
7. **ES module imports** use `.js` extensions (even for `.ts` files).
8. **Never edit `src/gql/`** — it is generated by codegen.
9. **`USAGE.md` is generated and git-ignored** — produced by `npm run generate:usage` during build, included in the npm package but not committed.
10. **Production dependencies must be pinned** to exact versions (no `^` or `~`). Dev dependencies may use ranges.
11. **No `postinstall` scripts.** Use `prepare` for dev setup hooks (codegen, lefthook). Consumer installs must never execute dev-only commands.

## Decision Tree: Adding Functionality

```
Need a new GraphQL operation?
  → Add/edit graphql/{queries,mutations}/*.graphql
  → Run: npm run generate
  → Import DocumentNode + types from src/gql/graphql.js

Need to resolve a human-friendly ID?
  → Add/edit src/resolvers/*-resolver.ts
  → Prefer LinearSdkClient, return UUID string
  → Pattern: UUID passthrough → SDK lookup → notFoundError()
  → If SDK cannot express lookup, use GraphQL as documented ARCHITECTURAL EXCEPTION (include rationale in resolver docstring)

Need business logic / CRUD?
  → Add/edit src/services/*-service.ts
  → Use GraphQLClient, accept pre-resolved UUIDs only
  → Import codegen DocumentNode + types

Need a CLI command?
  → Add/edit src/commands/*.ts
  → Use createContext(rootOpts) → resolve IDs → call service
  → Read-only verbs: define an inline `formatThing(data)` text formatter
    above the action, then `outputResult(data, formatThing, rootOpts)`
  → Mutations / verbs without a meaningful text view: `outputSuccess(data)`
  → Register in src/main.ts (setupXCommands + META in allMetas[])
  → Add DomainMeta export + usage subcommand

Need tests?
  → Add tests/unit/{resolvers,services,common}/*.test.ts
  → Mock ONE layer deep (see Testing section below)
```

## Testing

Tests mirror `src/` structure under `tests/unit/`. Mock the dependency one layer down:

| Test target | Mock | Example |
|-------------|------|---------|
| Resolver | `LinearSdkClient` (mock `sdk.*`) | `{ sdk: { teams: vi.fn() } } as unknown as LinearSdkClient` |
| Service | `GraphQLClient` (mock `request`) | `{ request: vi.fn() } as unknown as GraphQLClient` |
| Common | No mocks (pure functions) | Direct import + assert |

**Coverage minimum**: happy path + primary error case per function.

Integration tests (`tests/integration/`) need `LINEAR_API_TOKEN` set and a built project. They are skipped automatically when the token is absent.

```bash
npm test                        # unit tests
npx vitest run tests/unit/resolvers  # specific suite
npm run test:coverage           # coverage report
```

## Anti-Patterns (WRONG → RIGHT)

**ID resolution in service:**
```typescript
// WRONG: service resolves IDs
async function createIssue(client: GraphQLClient, teamName: string) {
  const teamId = await resolveTeamId(...); // ← not here
}
// RIGHT: service receives UUID
async function createIssue(client: GraphQLClient, input: { teamId: string }) { ... }
```

**Wrong client in layer:**
```typescript
// WRONG: resolver uses GraphQLClient
async function resolveTeamId(client: GraphQLClient) { ... }
// RIGHT: resolver uses LinearSdkClient
async function resolveTeamId(client: LinearSdkClient) { ... }
```

**Business logic in command:**
```typescript
// WRONG: command does data work
.action(handleCommand(async (...args) => {
  const [title, opts] = args as [string, Opts];
  const result = await ctx.gql.request(SomeMutation, { title, teamId: opts.team });
}))
// RIGHT: command delegates
.action(handleCommand(async (...args) => {
  const [title, opts, command] = args as [string, Opts, Command];
  const rootOpts = getRootOpts(command);
  const ctx = createContext(rootOpts);
  const teamId = await resolveTeamId(ctx.sdk, opts.team);
  const result = await createIssue(ctx.gql, { title, teamId });
  outputResult(result, formatCreateIssue, rootOpts); // or outputSuccess(result) for mutations
}))
```

## GraphQL Workflow

```
1. Edit:   graphql/{queries,mutations}/*.graphql
2. Run:    npm run generate
3. Import: import { FooDocument, type FooQuery } from "../gql/graphql.js"
4. Use:    client.request<FooQuery>(FooDocument, variables)
```

Never use raw GraphQL strings. Always type `client.request<T>()`.

## Usage Documentation System

Every command group must export a `DomainMeta` and register a `usage` subcommand.
See `src/common/usage.ts` for the `DomainMeta` interface and formatting functions.

```typescript
export const ENTITY_META: DomainMeta = {
  name: "entity",
  summary: "short one-line description",
  context: "data model explanation",
  arguments: { name: "description" },
  seeAlso: ["related-domain command"],
};
```

Registration checklist:
1. Export `DOMAIN_META` from command file.
2. Add `usage` subcommand: `.command("usage").action(() => console.log(formatDomainUsage(...)))`.
3. Add meta to `allMetas[]` in `src/main.ts`.
4. Run `npm run generate:usage` to update `USAGE.md`.

## File Map

```
src/
  main.ts              # entry point, command registration
  client/              # GraphQLClient, LinearSdkClient
  resolvers/           # ID resolution (human → UUID)
  services/            # business logic (GraphQL CRUD)
  commands/            # CLI definitions (Commander.js)
  common/              # context, output, errors, types, auth, usage
  gql/                 # GENERATED — do not edit
graphql/
  queries/             # .graphql query definitions
  mutations/           # .graphql mutation definitions
tests/
  unit/                # mirrors src/ structure
  integration/         # CLI integration tests (need API token)
```

## Verification Checklist

Before claiming work is complete, run:

```bash
npm run check:ci       # biome lint + format check
npx tsc --noEmit       # type check
npm test               # unit tests
npm run build          # full build (includes codegen + usage generation)
```

All four must pass. CI runs these on every push and PR.

## Extended Documentation

For deeper patterns, templates, and implementation details, see:

- `docs/architecture.md` — component organization, data flow, key files
- `docs/development.md` — code patterns, service/resolver/command templates
- `docs/testing.md` — mock patterns, writing new tests, integration tests
- `docs/build-system.md` — compilation, codegen pipeline
- `docs/files.md` — complete file catalog
