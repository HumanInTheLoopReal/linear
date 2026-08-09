# Static Reference Data with Linear

Linear is an API-bound issue tracker, not a shipped local database.
There is no local store you can use as a queryable knowledge base for
glossaries, terminology DAGs, or other reference data that travels
with a project. This doc covers what you **can** use Linear for, and
where to put the static data Linear isn't a good fit for.

## Work Tracking (Primary Use Case)

Standard `linear` workflow:
- Issues flow through workspace workflow states
- Priorities and typed relations matter
- Status tracking is essential
- Identifiers (`ENG-42`) are sufficient for referencing

This is what Linear is designed for, and what `linear` is designed
to drive.

## Reference Data Inside Linear (Limited)

If your reference data is **issue-shaped** (each entry is a thing
with a title, a longer description, optional tags, optional
relations), it can live in Linear under a dedicated team or project
without much friction:

| Use case | Linear shape | Notes |
|----------|--------------|-------|
| Project decisions | Issues with `type:decision` label, structured rationale in description | `linear decision` sugar exists |
| ADRs / architecture notes | One issue per ADR under a `Decisions` project | Treat as never-closing |
| Terminology / glossary | One issue per term, `type:glossary` label, in a dedicated team | Workable but clunky |
| Runbooks | One issue per runbook, attached to a runbook project | Linear projects collect them |
| Postmortems | One issue per incident, `type:postmortem` label | Comments capture the timeline |

**Characteristics of this pattern:**
- Entities stay open indefinitely (or use a custom "Reference" state)
- No real workflow transitions
- Titles matter more than identifiers
- Cross-links via `relates-to` are useful

**Recommended hygiene:**
- Put reference entries in a separate Linear team / project so they
  don't pollute `linear ready`
- Tag with `type:<category>` so `linear list --label
  type:glossary` returns just the glossary
- Avoid mixing reference entries and active work in the same project
- Consider snapshotting to a markdown file in the repo for offline
  reading: `linear list --label type:glossary --json > docs/glossary.json`

**Key constraint**: there is **no second database** to ship.
Reference issues live alongside work issues in the same Linear
workspace. The separation is conceptual (labels / teams) not
storage-level.

## Reference Data Outside Linear (Recommended for Most Cases)

Static reference data — things like a port → service mapping, a
country → tax-region table, an external glossary — usually doesn't
belong in Linear at all. The recommended places:

| Data | Where to put it | Why |
|------|-----------------|-----|
| Project glossary / ADRs | `docs/GLOSSARY.md`, `docs/adr/*.md` (markdown in the repo) | Browsable, diffable, no API round-trip |
| External lookup tables | Project resource files (`data/*.json`, `data/*.csv`) | Vesionable with the code that uses them |
| External docs / runbooks | Confluence, Notion, Google Docs | Their natural home; link from Linear via attachments |
| Spec PDFs, schemas | `docs/spec/*` or a Linear attachment (`linear attachments create --url`) | Linear attachments are URL-referenced metadata; the CLI does not upload file blobs |

### Linking External Data from a Linear Issue

```bash
# Attach a URL to an issue. Linear stores the title + URL + optional
# subtitle as metadata; the CLI does not upload file blobs.
linear attachments create ENG-42 \
  --url https://docs.example.com/runbook \
  --title "Production runbook"

# For local files, upload them somewhere accessible (S3, a gist, a
# repo permalink) and attach the URL — the linear CLI's attachments
# verb only accepts --url, --title, --subtitle.
linear attachments create ENG-42 \
  --url https://github.com/org/repo/raw/main/docs/spec.pdf \
  --title "Spec v2"
```

Then `linear show ENG-42` shows the attachments list. Agents resume
work by hitting the URL / opening the file rather than expecting
Linear to contain the data inline.

### Using Linear Projects as Reference Containers

Linear's **project** primitive groups related issues with shared
goals / timelines. Projects are not databases, but they make natural
homes for grouped reference content:

```bash
# List projects in a team
linear projects list --team ENG

# Create a reference project
linear projects create --team ENG \
  --name "Engineering Reference" \
  --description "Long-lived reference issues (ADRs, runbooks, glossary)"

# Create reference issues in that project
linear create "ADR-007: choose RS256 over HS256" \
  --project "Engineering Reference" \
  --labels type:task,type:decision

# (Or, for the canonical ADR shape with rationale / alternatives /
# affected areas pre-filled, use the dedicated decision verb:)
linear decision record \
  --title "ADR-007: choose RS256 over HS256" \
  --rationale "Asymmetric keys allow safe public verification" \
  --alternatives "HS256 (rejected: shared-secret rotation pain)" \
  --affects "ENG-105, ENG-118"
```

Searches scoped to that project (`linear list --project ...`)
behave like a per-topic table of contents.

## When to Use Linear for Reference Data

**Good fit:**
- Each entry is issue-shaped (title + rich description + comments)
- You want cross-links to active work (e.g., "this ADR underlies
  these in-progress features")
- The team already lives in Linear daily and a separate doc site
  would be ignored

**Poor fit:**
- Data changes frequently in lockstep with code (use markdown next
  to the code)
- Simple lists (markdown is simpler)
- Data that needs complex queries — Linear's GraphQL surface is
  narrower than a real database

## Limitations

**`linear show` requires identifiers, not titles**:

```bash
linear show ENG-42                  # works
linear show "API endpoint"          # does not work
linear search "API endpoint"        # use this instead — returns matches
```

For title-based lookup, use `linear search` (full-text across
title / description / identifier).

**No SQL escape hatch**: there is no local DB and Linear doesn't
expose a raw SQL endpoint, so arbitrary SQL queries are not
available. For richer queries:

```bash
# Use the JSON envelope + jq (list returns {nodes, pageInfo}):
linear list --label type:decision --json | \
  jq '.nodes[] | select(.description | contains("RS256"))'

# Or paginate manually using the cursor in pageInfo.endCursor:
linear list --label type:decision --limit 100 --json
linear list --label type:decision --limit 100 --after <endCursor> --json
```

**No queryable graph of reference entries at scale**: `linear depends
tree` walks typed relations, but every node is a server round-trip.
Fine for ten nodes; expensive for hundreds. If your reference DAG has
hundreds of nodes, ship it as markdown / JSON instead.

## What `linear` Does Not Ship

- **No shipped static-data DAG.** Linear is API-bound; nothing
  reference-shaped ships with the CLI itself.
- **No arbitrary SQL.** There is no local DB. Use `--json | jq`
  pipelines for richer queries.
- **No bundled glossary database.** Put glossaries in
  `docs/GLOSSARY.md` or a dedicated Linear project.
- **No cross-workspace reference relations.** Linear typed relations
  work within a single workspace; cross-workspace requires manual
  links.

## Migration Hint

If you have an existing shipped static-data DAG you'd like to move
into Linear, the recommended approach is:

1. Decide whether the entries are issue-shaped. If yes, import them
   into a dedicated Linear project (`linear import entries.jsonl` or
   pipe stdin via `cat entries.jsonl | linear import -`; use
   `--dry-run` first and `--dedup` to skip lines whose title matches
   an existing open issue).
2. If no, snapshot the data to markdown / JSON next to the code that
   uses it and delete the DAG.
3. Link from active Linear issues to the snapshot by hosting the file
   somewhere addressable and attaching the URL
   (`linear attachments create <issue> --url <url> --title ...`).

## See Also

- [ISSUE_CREATION.md](../references/ISSUE_CREATION.md) — Description structure for
  long-lived reference issues
- [DEPENDENCIES.md](DEPENDENCIES.md) — Typed relations for linking
  reference entries to active work
- [RESUMABILITY.md](../references/RESUMABILITY.md) — Why Linear is the durable
  source of truth and local files aren't
