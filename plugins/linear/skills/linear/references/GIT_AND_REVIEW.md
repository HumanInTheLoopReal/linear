# Git and Review

## Ownership boundary

Linear owns the work contract and lifecycle. Git owns code history. The PR owns code
review. CI owns automated evidence.

## Typical leaf workflow

```text
claim issue
  -> sync green base
  -> create issue branch/worktree
  -> implement and verify
  -> open/link draft PR
  -> tend CI and review
  -> human-ready gate
  -> merge
  -> final Linear receipt/state
```

Follow repository policy when it requires the draft PR earlier, a specific branch
format, human-only merge, or automatic Linear state transitions.

## Branch and PR linkage

- Use the Linear issue identifier in the branch and PR title/body according to the
  repository integration convention.
- Keep one authoritative PR for one leaf workflow unless the repository explicitly
  permits stacked PRs.
- Link the PR from Linear. Do not paste every review comment into Linear.
- Keep the issue active while a draft PR exists. Move to the human review state only
  when CI, conflicts, receipts, and required automated review are ready.

## Parent and child branch semantics

The unit selected for execution is the **execution leaf**: by default it owns one
branch and one PR. Creating a durable child does not automatically create another
branch or PR.

- A child used for research, approval, or an independently resumable checkpoint may
  remain inside the parent's branch/PR.
- If a child is independently mergeable, the controller promotes it to an execution
  leaf with its own branch/PR and the parent becomes an integration container.
- The parent completes only after required children land and the integrated parent
  acceptance criteria are verified.

Parent-child containment alone is not a blocker edge. Add `blocks` only when another
issue's readiness must literally wait on the child.

## Review and repair

- Review findings live in PR threads.
- The implementation actor repairs the same branch.
- Reply with evidence in the original thread and resolve it according to repository
  policy.
- If review reveals work required by the current contract, keep it in the same issue
  or create a necessary child.
- If review reveals unrelated scope, record a finding for triage.

## Completion semantics

Do not treat `code written`, `commit pushed`, `PR opened`, and `task complete` as
synonyms.

For a typical implementation leaf, completion requires:

- acceptance criteria satisfied;
- required tests/checks green;
- review resolved;
- merge completed when merge is the repository's gate;
- concise Linear completion receipt.

If post-merge CI fails, preserve the completed historical task and create/authorize an
incident or regression according to policy. Do not silently reopen history unless the
workspace explicitly defines that behavior.
