# ADR 0003 — Homebrew dual-path (D5)

## Status

Accepted

## Context

Homebrew offers two ways to ship a CLI:

1. **A self-controlled tap** (e.g. `HumanInTheLoopReal/homebrew-linear`).
   The maintainer publishes a `Formula/linear.rb` file in a
   GitHub repo with the `homebrew-` prefix; users add the tap with
   `brew tap` and install with `brew install <tap>/linear`. The
   maintainer controls release cadence, formula lint requirements,
   and the dependency tree.
2. **homebrew-core** — the canonical centralized formula tree at
   `Homebrew/homebrew-core`. Users install with `brew install linear`
   (no tap step). Listed in the default `brew search`. Higher
   visibility but a stricter review bar: notability rules, popularity
   thresholds (rough; informally enforced), and a maintainer review
   queue.

PROCESS.md §D5 chose "`homebrew-linear` tap v1, homebrew-core v2." The
non-obvious rationale: tap-first is **faster + full control**;
homebrew-core later is **more discoverable** once usage warrants the
review cost. Switching from tap to core later is mechanical
(`disable!` the tap formula, point users at the core formula), so the
v1 choice does not lock out the v2 outcome.

`RELEASING.md` documents **both** paths so the v1 → v2 transition is
mechanical when it happens.

## Decision

1. **Ship via `HumanInTheLoopReal/homebrew-linear` tap in v1** for
   speed and control. The template formula lives in
   `docs/homebrew/linear.rb` (auditable in the linear-cli repo); the
   live formula lives in the external tap repo and gets updated per
   release per [`docs/homebrew/README.md`](../homebrew/README.md).
2. **Submit to homebrew-core in v2** once usage warrants. Trigger
   criteria (documented in `RELEASING.md` §5):
   - npm install volume passes a usage threshold (track via
     `npm view @humanintheloop/linear` weekly downloads).
   - Formula has been stable in the tap for ≥ 60 days.
   - No breaking-change releases pending in the next 30 days.
3. **`RELEASING.md` documents the publish step for both paths** so the
   v2 path is unambiguous when triggered. The homebrew-core submission
   itself is tracked as deferred work.
4. **At v2 promotion**, the tap formula gets a `disable!` directive
   pointing at the core formula. Existing tap users migrate
   automatically on their next `brew update`.

## Consequences

### Positive

- v1 ships **immediately** without waiting on homebrew-core review.
- Full control of formula linting, version pinning, and dependency
  choices during the period when linear-cli is moving fastest.
- The promotion path to homebrew-core is well-trodden — Homebrew has
  conventions for tap-to-core migrations, and tap users get the new
  formula on the next `brew update` without changing their install
  command (the `disable!` directive points them at `brew install
  linear`).
- Maintenance cost is low: the formula is a small file, and the
  per-release update flow (recompute SHA-256, edit `url` + `sha256`,
  PR + merge) is in `docs/homebrew/README.md` and `RELEASING.md` §4.

### Negative

- v1 users get a non-default install command: `brew install
  HumanInTheLoopReal/linear/linear` (or `brew tap … && brew install
  linear`). Slightly higher friction than `brew install linear`.
  README and install docs document the tap-first command.
- The tap is a second repo (`homebrew-linear`) to maintain. Mitigated
  by keeping the tap repo tiny: README + `Formula/linear.rb` only.
- Two paths means two release-time checklists. `RELEASING.md` keeps
  them adjacent so the maintainer can scan both in one pass.

## Related

- PROCESS.md §D5 (decision row).
- [`docs/homebrew/README.md`](../homebrew/README.md) — tap maintenance
  runbook.
- [`docs/homebrew/linear.rb`](../homebrew/linear.rb) — template
  formula.
- [`RELEASING.md`](../../RELEASING.md) §§4–5 — release-time steps for
  both paths.
- Deferred work item covering the homebrew-core submission.

## Date

2026-05-17
