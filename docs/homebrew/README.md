# Homebrew tap — runbook

This directory holds the **template** Homebrew formula for the Linear
CLI. The live formula is published from a separate tap repo
(`HumanInTheLoopReal/homebrew-linear`) so consumers can run:

```bash
brew tap HumanInTheLoopReal/linear
brew install linear
```

The contents of `docs/homebrew/linear.rb` are what gets copied into
the tap repo at release time. Keeping the template here makes it
auditable in the main repo, with version control and PR review, even
though Homebrew itself only loads it from the tap.

## Bootstrapping the tap repo (one-time)

The tap repo doesn't exist yet — these are the steps to create it:

1. Create a new public GitHub repository named
   `HumanInTheLoopReal/homebrew-linear` (the `homebrew-` prefix is required by
   Homebrew's tap discovery convention).
2. Add a `README.md` at the repo root with at least:

   ```markdown
   # homebrew-linear

   Homebrew tap for the Linear CLI.

       brew tap HumanInTheLoopReal/linear
       brew install linear

   See https://github.com/HumanInTheLoopReal/linear for the CLI source.
   ```

3. Copy `docs/homebrew/linear.rb` from this repo to `Formula/linear.rb`
   in the new tap repo.
4. Edit `url` and `sha256` in the copied file to point at a real
   published version of the npm tarball (see "Per-release update flow"
   below for the exact sha256 command).
5. Commit, push, tag if desired. Tap consumers get the formula on
   their next `brew update`.

## Per-release update flow

After every `npm publish` of a new `@humanintheloop/linear@X.Y.Z`:

1. **Fetch the new tarball's sha256.** The npm-emitted `dist.shasum` is
   sha1, which Homebrew rejects — recompute sha256:

   ```bash
   curl -fsSL https://registry.npmjs.org/@humanintheloop/linear/-/linear-X.Y.Z.tgz \
     | shasum -a 256
   ```

2. **Edit `Formula/linear.rb` in the tap repo.** Update:
   - `url` → the new tarball URL.
   - `sha256` → the value from step 1.
   - If you need to rebuild without bumping `linear`'s version (rare),
     add a `revision N` line.

3. **PR + merge in the tap repo.** Tap users pick the update up via
   `brew update && brew upgrade linear`.

4. **Smoke-test locally before merging:**

   ```bash
   brew install --build-from-source ./Formula/linear.rb
   linear --version
   ```

## Why a tap before homebrew-core

- The tap is **immediate** — homebrew-core has notability and
  star/fork rules of thumb that an early-stage project may not clear.
- The tap gives full control over formula linting cadence, version
  pinning policy, and dependency choices.
- The tap is **reversible** — when homebrew-core accepts the
  formula, the tap formula gets a `disable!` directive pointing at the
  core formula. Existing tap users are nudged to switch.

The long-term target *is* homebrew-core, but that submission is
deferred until usage warrants the review cost.

## Why this lives in `docs/homebrew/` rather than `Formula/`

Putting `Formula/linear.rb` at the root of this repo would make
`brew install --HEAD` partially work, but it would also confuse
Homebrew's tap discovery (the linear-cli repo is NOT a tap — the
homebrew-linear repo is). Keeping the template under `docs/homebrew/`
makes the source-of-truth relationship explicit: the template lives
here, the live formula lives in the tap.
