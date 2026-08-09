# Dependency Types

Linear stores exactly three relation kinds (`Blocks`, `Related`,
`Duplicate`) plus a `parentId` field on the issue itself. This CLI layers
six more typed edges on top of `Related`. This file explains which edge to
reach for. Exact flags live in `linear depends --help`.

## The rule that governs everything

Only `blocks` changes what `linear ready` returns. Every other edge is
context: it records why work exists or how it connects, and it never hides
an issue from the ready queue.

Reach for a blocking edge only when the second issue genuinely cannot start.
Everything softer than that is `relates-to`.

## Choosing an edge

Answer the first question that applies:

| If | Use | Command |
|---|---|---|
| B cannot start until A closes | `blocks` | `linear depends add B A` |
| B is a piece of the epic A | parent field | `linear issues update B --parent-ticket A` |
| B turned up while you worked on A | `discovered-from` | `linear depends add B A --type discovered-from` |
| A and B are the same issue | `duplicate-of` | `linear duplicate A --of B` |
| B verifies A behaves correctly | `validates` | `linear depends add B A --type validates` |
| B replaces A | `supersedes` | `linear depends add B A --type supersedes` |
| B exists because A happened | `caused-by` | `linear depends add B A --type caused-by` |
| B mirrors A somewhere else, such as a GitHub issue | `tracks` | `linear depends add B A --type tracks` |
| B stops being relevant once A closes | `until` | `linear depends add B A --type until` |
| They are merely connected | `relates-to` | `linear depends relate A B` |

## Direction

This trips people up more than anything else in the file.

```
linear depends add <issue> <depends-on>
                     |          |
                     |          the prerequisite, the thing that must finish
                     the dependent, the thing that has to wait
```

Read it as a sentence: "issue depends on depends-on". The endpoint waits for
the schema, so the endpoint is the first argument:

```bash
linear depends add ENG-102 ENG-101   # ENG-102 waits for ENG-101
```

Reversing the arguments produces a valid edge pointing the wrong way, and
nothing will warn you. If you prefer stating it the other way round, say so
explicitly with `--type blocked-by`, which the CLI folds back into the same
single `Blocks` relation:

```bash
linear depends add ENG-101 ENG-102 --type blocked-by
```

## The edges in detail

### blocks and blocked-by

Both names describe one edge seen from opposite ends, and both produce one
`Blocks` relation. While A is open, B is absent from `linear ready`. Close A
and B returns on its own; Linear re-evaluates the graph server side, so
there is no unblock step to remember.

Good reasons to block: a table that must exist before the endpoint querying
it, migration steps that must run in order, a library that must be installed
before code can import it.

Bad reasons: a preference about ordering, work that could proceed in
parallel, or a note that two issues are connected. Blocking those shrinks
the ready queue to a single item and serializes work that did not need to be
serialized.

The CLI refuses a `blocks` edge that would close a loop:

```bash
linear depends add ENG-A ENG-B
linear depends add ENG-B ENG-A   # rejected, would create a cycle
```

Audit the whole workspace with `linear depends cycles`, which exits non-zero
when it finds any. `linear depends graph check` does the same thing.

### related and relates-to

Aliases for one bidirectional `Related` edge. Direction carries no meaning.
No effect on readiness.

Use it freely. It costs nothing and makes future work discoverable: two
approaches to the same problem, a feature and its documentation, work where
touching one teaches you something about the other.

```bash
linear depends relate ENG-201 ENG-202
linear depends unrelate ENG-201 ENG-202
```

### duplicate-of

Marks one issue as the same work as another and closes the duplicate in the
same call:

```bash
linear duplicate ENG-303 --of ENG-300
linear mark-duplicate ENG-303 --of ENG-300
```

Both names run the same command. Because it closes the issue for you, do not
follow it with a separate `linear close`.

### parent-child

Linear models hierarchy as a field on the child, not as a relation. This
matters practically: `linear depends add` cannot create it and rejects
`--type parent-child`.

```bash
linear create "Set up OAuth credentials" --labels type:task --parent-ticket ENG-400
linear issues update ENG-401 --parent-ticket ENG-400
linear issues update ENG-401 --clear-parent-ticket
```

Detach with `--clear-parent-ticket`. Passing an empty string to
`--parent-ticket` is silently ignored rather than clearing anything.

Hierarchy carries no ordering. An epic whose children must run in sequence
needs both: the parent field for structure, `blocks` edges for order.

```
ENG-400 (parent)
  ENG-401  Install library
  ENG-402  Create middleware      waits for ENG-401
  ENG-403  Add endpoints          waits for ENG-402
```

```bash
linear depends add ENG-402 ENG-401
linear depends add ENG-403 ENG-402
```

### The six extended types

Linear has no native slot for these, so the CLI writes a `Related` relation
and tags the source issue with a `dep-type:<type>` label. Anyone reading the
workspace through Linear's own UI or API still sees a sensible edge.

| Type | Means |
|---|---|
| `discovered-from` | The source was found while working on the target |
| `tracks` | The source follows progress on the target, often something external |
| `until` | The source is relevant only until the target closes |
| `caused-by` | The source exists because the target happened |
| `validates` | The source verifies the target's behavior |
| `supersedes` | The source replaces the target |

`discovered-from` is the one worth spending care on. It answers "why does
this issue exist?" months later, when the reasoning behind a side quest, a
research finding, or a bug spotted mid-feature has otherwise evaporated. It
is for things you stumbled onto, never for tasks you planned deliberately;
planned breakdown is what the parent field is for.

Removing an extended edge takes the relation away but leaves the label
behind:

```bash
linear depends remove ENG-511 ENG-510
linear label remove ENG-511 dep-type:discovered-from
```

## Mistakes worth avoiding

**Blocking on a preference.** "We would rather write the docs first" is not
a blocker. Use `relates-to`, or write the ordering into the description and
leave the graph alone.

**Reaching for `depends add` to build a hierarchy.** Parent-child is a
field. `--type parent-child` is not a valid edge type and the command will
tell you so.

**Using `discovered-from` for planned decomposition.** If you sat down and
split an epic, those children were planned, so use `--parent-ticket` at
creation time. Save `discovered-from` for what you did not see coming.

**Blocking everything on everything.** Strict sequential chains leave
`linear ready` showing exactly one issue and no room for parallel work.

**Getting the direction backwards.** Covered above, and still the most
common error. Read the command aloud as a sentence before running it.

## Shapes that come up

A diamond, where two independent tracks converge:

```bash
linear depends add ENG-impl-a ENG-setup
linear depends add ENG-impl-b ENG-setup
linear depends add ENG-testing ENG-impl-a
linear depends add ENG-testing ENG-impl-b
```

Testing waits for both implementations; the implementations do not wait for
each other.

A discovery chain, where research produces findings that produce more
findings, and the tree preserves the path:

```
ENG-research-main
  discovered-from  ENG-finding-1
  discovered-from  ENG-finding-2
    discovered-from  ENG-deep-finding-3
```

Phased epics, where each phase is itself an epic with children, and `blocks`
edges between the phase epics enforce order while children inside a phase
stay parallel.

Provenance and blocking can coexist on the same pair. A bug found during a
feature can be recorded as discovered from that feature and, once you judge
it a genuine blocker, also block it:

```bash
linear depends add ENG-511 ENG-510 --type discovered-from
linear depends add ENG-510 ENG-511 --type blocks
```

## Reading the graph back

```bash
linear depends tree ENG-510                  # transitive tree, ASCII
linear depends graph ENG-510                 # JSON subgraph
linear depends graph ENG-510 --dot           # Graphviz, note --dot not --format dot
linear depends list ENG-510 --json           # flat edge list
linear depends list ENG-510 --direction up   # what this issue waits on
linear depends list ENG-510 --direction down # what waits on this issue (default)
linear depends list ENG-510 --direction both
```

`linear show` prints a short relations summary, enough to orient but not to
trace a graph. Every relation carries a server-assigned UUID; read it from
`linear depends list <issue> --json` when you need to reference an edge
programmatically.
