# Documents and Review

Use a Linear Document for durable long-form product thinking that benefits from
inline human feedback. Use an issue for the work and judgment required to move
that document through the process. Do not turn a document outline into a tree of
issues.

Run `linear documents usage` before operating on documents. Use
`linear <command> --help` for exact flags; this reference owns the lifecycle,
not frozen command syntax.

## Canonical shape

For a governed deliverable such as a Product Overview, Requirements, or
Architecture:

- one Project owns at most one canonical document of that type;
- one thin deliverable issue tracks preparation, review, and approval;
- the document owns the current prose;
- the issue owns status and sparse receipts;
- document threads carry human feedback to the agent;
- the agent replies in the same document thread after the revision is verified;
- local files are disposable editing/cache state and must not become a second
  checked-in source of truth.

The Project Overview is the product front door. It may point to canonical
documents and issues, but it should not duplicate their bodies or live status.

## Discover before creating

1. Confirm the active workspace, viewer, repository scope, team, and Project
   with `linear where` and `linear prime`.
2. Read the Project and search its documents and issues, following pagination.
3. Reuse one unambiguous existing document and deliverable issue. Stop and ask
   when multiple plausible records remain.
4. Verify the upstream approval gate before drafting or mutating the next
   governed deliverable.

Prefer the document UUID or `slugId` returned by structured output. A shortened
identifier printed after creation may not resolve on a later read. Re-list after
creation, capture the full identifier, and server-read the document before
continuing.

## Create once, then revise in place

1. Prepare the complete body in an ignored local cache.
2. Create the document once, attached to the Project and its deliverable issue
   when the command surface supports both at creation time.
3. Immediately re-list and read the server copy. Record its durable identifier,
   URL, and normalized revision evidence in the issue receipt or disposable
   cache.
4. On every later pass, update the same document. Never create a replacement
   because a session restarted or comments arrived.
5. If an attachment cannot be repaired by the update surface, stop and choose an
   explicit recovery with the human; do not silently create a duplicate.

For long Markdown bodies, use a body file or stdin after checking live help.
Avoid shell quoting that can reinterpret backticks, substitutions, or secrets.

## Human review loop

1. Self-review the complete document and server-read it for parity.
2. Move the deliverable issue to `In Review` only when human judgment is the
   next action.
3. Read every root document discussion, then every reply. Follow pagination.
   Inline threads include the selected text as context; preserve that anchor
   while interpreting the request.
4. Re-read the latest server document before editing. Apply all compatible
   feedback coherently to one cached draft instead of patching comments in
   isolation.
5. Update the same document and server-read it again.
6. Reply in each handled root thread with the outcome or a concise question.
   Document discussions currently have no generic resolve step, so do not claim
   a thread was resolved unless live help exposes that operation.
7. If feedback changes an approved upstream decision, return to the owning gate
   instead of rewriting history invisibly.

Silence is not approval. The agent may prepare and revise a document and move
its deliverable to `In Review`; only the configured human approval motion makes
the governed deliverable complete.

## Receipts and resumability

Post receipts only at meaningful boundaries: review requested, revision
published, blocked on a decision, approved, or superseded. A useful receipt
contains:

- canonical document link and full identifier;
- server revision evidence such as `updatedAt` and a content hash when the
  downstream gate depends on exact content;
- which feedback threads were handled;
- the exact human decision or next action;
- the downstream stage unlocked after explicit approval.

On resume, reconstruct state from the Project, document, deliverable issue,
threads, and receipts. Treat cached IDs and content as hints until they are
revalidated live.

## Channel boundary

- Document thread: feedback about long-form product content.
- Deliverable issue: status, approval, blocker, and compact agent-to-human
  receipt.
- Project discussion/update: cross-cutting project decision or periodic summary.
- PR thread: code-review and CI repair conversation.

Link across channels when needed. Never mirror the same conversation into all
of them.
