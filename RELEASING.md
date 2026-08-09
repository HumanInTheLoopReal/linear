# Releasing

A release of this CLI lands on several channels at once. Work through the
sections in order; each one assumes the previous has finished.

| Channel | What it is |
|---|---|
| GitHub release | The tag and notes. Everything downstream reads from it. |
| npm | The primary distribution, and the install instruction we advertise. |
| Homebrew tap | `HumanInTheLoopReal/homebrew-linear`, the active brew path. |
| Homebrew core | Deferred until usage justifies the review cost. See [ADR 0003](docs/adr/0003-homebrew-dual-path.md). |
| `install.sh` and `install.ps1` | Bootstraps at the repo root. They resolve the published version at runtime, so most releases need no edit. |
| Plugin bundle | Version-bearing manifests under `plugins/linear/` plus `.claude-plugin/marketplace.json`. |

## Before you start

**Tools.** `git` with push access to `HumanInTheLoopReal/linear`; `node` 22 or
newer with an authenticated `npm`; the `gh` CLI; `shasum` for SHA-256 digests;
`brew`, but only if you are touching the tap.

**Access.** Write access to the repository including protected `v*` tags,
publish rights on the `@humanintheloop/linear` package, and write access to the
tap repo if you maintain it.

Confirm all of that before you tag anything:

```bash
git remote -v
gh auth status
npm whoami
npm access list packages @humanintheloop/linear
```

**Gates.** Every one of these must pass:

```bash
npm run check:ci
npx tsc --noEmit
npm test
npm run build
npm run test:integration:smoke
npm run test:commands
npm run verify:packed-binaries
npm run verify:plugin-versions
```

**State.** Sitting on `main`, up to date with origin, nothing uncommitted, and
`CHANGELOG.md` already describing the version you are about to cut, migration
steps included if anything breaks.

## 1. Prepare

Write the changelog entry before bumping any version. Drafting notes is what
surfaces the version pin somebody forgot.

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature foo.

### Changed
- Improved bar.

### Fixed
- Bug in baz.

### Breaking Changes
- Behavior of qux changed; see migration steps below.
```

Commit it:

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for vX.Y.Z"
git push origin main
```

Then bump the version everywhere it appears. The synchronizer handles every
plugin manifest, the marketplace entry, and the skill snapshot, so do not edit
those by hand:

```bash
npm version X.Y.Z --no-git-tag-version
node scripts/release/plugin-versions.mjs X.Y.Z
npm run verify:plugin-versions

git add package.json package-lock.json plugins/linear \
  .claude-plugin/marketplace.json src/templates/agent-skill.ts
git commit -m "chore: bump version to vX.Y.Z"
git push origin main
```

## 2. Tag and publish the GitHub release

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z

gh release create vX.Y.Z --title "vX.Y.Z" --notes-file CHANGELOG.md
```

If CI builds artifacts on the tag, let it finish before continuing. Then open
the [releases page](https://github.com/HumanInTheLoopReal/linear/releases) and
confirm `vX.Y.Z` is flagged Latest and carries its notes.

## 3. Publish to npm

Publish from a clean checkout of the tag, never from a working tree:

```bash
git checkout vX.Y.Z
rm -rf node_modules dist
npm install
npm run build

npm publish --dry-run   # read the file list before it is permanent
npm publish
```

```bash
npm view @humanintheloop/linear version        # X.Y.Z
npm view @humanintheloop/linear dist.tarball   # resolves to a real URL
```

## 4. Update the Homebrew tap

This is the active brew path. The full runbook is
[`docs/homebrew/README.md`](docs/homebrew/README.md) and the template formula
is [`docs/homebrew/linear.rb`](docs/homebrew/linear.rb).

Compute the digest yourself. The `dist.shasum` npm reports is SHA-1, which
Homebrew will not take:

```bash
curl -fsSL https://registry.npmjs.org/@humanintheloop/linear/-/linear-X.Y.Z.tgz \
  | shasum -a 256
```

Edit `Formula/linear.rb` in the tap repo: point `url` at the new tarball, set
`sha256` to the digest above, and add `revision N` if you are rebuilding
without a version bump.

Test before pushing:

```bash
brew install --build-from-source ./Formula/linear.rb
brew test linear
brew audit --strict linear
linear --version
```

Open a PR in the tap repo and merge it. Users pick the change up on their next
`brew update && brew upgrade linear`.

## 5. Homebrew core

Still deferred. Submitting means accepting the homebrew-core review burden, so
wait for all three: npm download volume that justifies it, a formula that has
been stable in the tap for at least 60 days, and no breaking release expected
in the next 30.

The first submission is a one-time setup:

```bash
brew create --tap homebrew/core \
  https://registry.npmjs.org/@humanintheloop/linear/-/linear-X.Y.Z.tgz
# Match the generated formula to docs/homebrew/linear.rb (test block, livecheck)
brew install --build-from-source Formula/linear.rb
brew test linear
brew audit --new linear
```

After that, updates are one command:

```bash
brew bump-formula-pr linear --version=X.Y.Z
```

Once core accepts the formula, mark the tap formula `disable!` so tap users
migrate across on their next `brew update`.

## 6. Install scripts

`install.sh` and `install.ps1` resolve the published version from the registry
at run time, so a normal release needs no edit here. Touch them only when the
bootstrap contract itself changes: environment variables, flags, the default
prefix, or a new minimum supported version.

| Variable | Effect |
|---|---|
| `LINEAR_INSTALL_VERSION` | Install a specific version. |
| `LINEAR_INSTALL_SOURCE` | Install channel. `registry` is the only accepted value today. |
| `LINEAR_INSTALL_PREFIX` | Override the npm prefix. |
| `LINEAR_INSTALL_SKIP_NODE_CHECK` | Skip the Node 22 check, for nvm and asdf users. |

Any change to either script gets a smoke test in a clean shell with no global
install present:

```bash
LINEAR_INSTALL_VERSION=X.Y.Z bash install.sh
linear --version
```

## 7. Plugin bundle

Step 1 already ran the synchronizer, and semantic-release runs it again during
its prepare phase, committing the result alongside the package and changelog
commit. If you skipped ahead, run it now:

```bash
node scripts/release/plugin-versions.mjs X.Y.Z
npm run verify:plugin-versions
```

Shipping to a public marketplace is a separate publish, typically
`claude plugin publish ./plugins/linear`. Codex reads its manifest from this
repository, so nothing extra is needed there.
[`docs/PLUGIN-MAINTENANCE.md`](docs/PLUGIN-MAINTENANCE.md) holds the full
bundle contract.

## 8. Verify

Check each channel actually serves the new version:

```bash
npm view @humanintheloop/linear version
npm install -g @humanintheloop/linear && linear --version

brew update && brew upgrade linear && linear --version

gh release view vX.Y.Z

# in a clean container or VM
curl -fsSL https://raw.githubusercontent.com/HumanInTheLoopReal/linear/main/install.sh | bash
linear --version

claude plugin install ./plugins/linear   # /linear:* appears in the slash menu
```

## Hotfixes

Branch from the tag, not from `main`:

```bash
git checkout -b hotfix/vX.Y.Z+1 vX.Y.Z

# make the fix and commit it

npm version X.Y.Z+1 --no-git-tag-version
git add package.json
git commit -m "chore: bump version to vX.Y.Z+1 (hotfix)"

git tag -a vX.Y.Z+1 -m "Hotfix vX.Y.Z+1"
git push origin hotfix/vX.Y.Z+1
git push origin vX.Y.Z+1
```

Continue from section 2 as normal, then merge the branch back so the fix is
not stranded on it:

```bash
git checkout main
git merge --no-ff hotfix/vX.Y.Z+1
git push origin main
```

## Rolling back

Reach for this when a shipped release has a serious defect. Roll forward with
a hotfix wherever you can; the steps below limit the damage while that
happens.

**Demote the GitHub release** so it stops being what downstream tooling
resolves:

```bash
gh release edit vX.Y.Z --prerelease
```

**Ship the fix** as X.Y.Z+1 using the hotfix flow above. This is the real
remedy; everything else is containment.

**Warn npm users off the bad version:**

```bash
npm deprecate @humanintheloop/linear@X.Y.Z "Critical bug; upgrade to X.Y.Z+1"
```

Deprecation warns at install time and leaves the version installable on
purpose. Unpublishing is only possible within 72 hours and breaks anyone who
already pinned it, so we do not use it.

**Revert the tap formula** to the previous good `url` and `sha256`. Tap users
pick the revert up on `brew update`.

**If homebrew-core carries the bad version**, open a PR bumping it back. This
is materially slower than reverting the tap, which is part of why the tap is
the path we lead with.

## Version numbers

Standard [semantic versioning](https://semver.org/), read through the lens of
a CLI contract:

- **Major** means we broke something callers depend on: a flag renamed or
  removed, a change to the JSON envelope schema, a verb withdrawn.
- **Minor** means new surface that leaves existing calls working: new verbs,
  new flags, new domains.
- **Patch** means a fix with no interface change.

## Questions

Open an [issue](https://github.com/HumanInTheLoopReal/linear/issues), check the
[release history](https://github.com/HumanInTheLoopReal/linear/releases), or
read [`docs/PLUGIN-MAINTENANCE.md`](docs/PLUGIN-MAINTENANCE.md).
