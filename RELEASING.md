# Releasing

Releases are automatic. Push a releasing commit to `main` and CI publishes to
npm. Nobody tags, bumps a version, edits the changelog, or runs `npm publish`
by hand, and doing any of those by hand will fight the pipeline.

```
push to main ─► Publish Release workflow
                  │
                  ├─ gates: lint, types, unit tests, build, smoke, packed binary
                  ├─ semantic-release reads the commits since the last tag
                  │    no releasing commit ─► stops here, workflow still passes
                  ├─ bumps version, writes CHANGELOG.md, syncs plugin manifests
                  ├─ tags vYYYY.M.P and pushes the bump commit back to main
                  ├─ npm publish --provenance
                  └─ GitHub release
```

## What triggers a release

The commit message decides. Nothing else does.

| Commit | Result |
| --- | --- |
| `feat: ...` | releases |
| `fix: ...` | releases |
| `perf: ...` | releases |
| `revert: ...` | releases |
| `<type>!: ...` or a `BREAKING CHANGE:` body | releases, whatever the type |
| `chore:` `docs:` `test:` `build:` `ci:` `style:` `refactor:` | no release |
| any type with scope `release`, `ci`, or `workflow` | no release |

That last row is the one that catches people. `fix(release): ...` and
`fix(ci): ...` publish nothing, because the scope is suppressed to keep the
pipeline's own bookkeeping commits from cutting versions. A push that releases
nothing still shows a green workflow.

Before pushing, ask what will happen:

```bash
npm run release:explain
```

It lists every commit since the last tag, says whether each one releases and
why, and ends in a verdict. The same output is written to the workflow summary
of every release run, so a green run always states what it did.

## Version numbers

CalVer, `YEAR.MONTH.PATCH`, derived by
[`scripts/release/calver-plugin.cjs`](scripts/release/calver-plugin.cjs):

- First release in a new calendar month rolls `YEAR.MONTH` forward and resets
  the patch, for example `2026.8.4` to `2026.9.0`.
- Every other release increments the patch, for example `2026.8.2` to
  `2026.8.3`.

The version carries no compatibility promise, so breaking changes have to be
described in the commit body and the changelog rather than signalled by the
number.

## Prereleases

Push to `next` instead of `main`. The same workflow publishes under the `next`
dist-tag as `X.Y.Z-next.N`, so `npm install -g @humanintheloop/linear@next`
picks it up while `latest` stays untouched. Promote with the
`release-promote-next-to-main` workflow.

## When a release does not happen

| Symptom | Cause | Fix |
| --- | --- | --- |
| Workflow green, nothing on npm | no releasing commit | check `npm run release:explain`; land a `feat:` or `fix:` |
| `E403 ... bypass 2fa ... required` | `NPM_TOKEN` lacks the bypass-2FA flag | mint a granular token with that option and update the secret |
| `E422 ... source repository visibility: private` | provenance requires a public repo | publish from the public repo, or drop `--provenance` |
| `ENOPRIORRELEASE` | branch has no seed tag | push a starting `vX.Y.Z` tag before the first release |

A failed publish fails the workflow. If it fails after the tag was pushed,
delete the orphan tag and the `chore(release):` bump commit before retrying, so
the repository never advertises a version that was never published.

## Verifying a release

The workflow proves the tarball builds; it does not prove the registry
serves it. After a release lands:

```bash
npm view @humanintheloop/linear version
npm install -g @humanintheloop/linear && linear --version
gh release view "v$(npm view @humanintheloop/linear version)"
```

A first publish can 404 for a minute or two while the registry propagates.
That is not a failure, and the workflow log is the authority: `npm publish`
prints `+ @humanintheloop/linear@VERSION` only when the registry accepted it.

## Shipping an urgent fix

There is no separate hotfix procedure. Commit the fix as `fix:` and push it
to `main`; the pipeline cuts the next patch within a few minutes. Do not
branch from a tag and hand-bump a version, which is what this document used
to describe, because semantic-release owns the version and a hand-made tag
desynchronises it.

Shipping an urgent fix on top of an *older* release is not supported: the
pipeline releases from `main` only. Roll forward instead.

## Rolling back

Rolling forward with a `fix:` is the real remedy. These steps only contain
the damage while that happens.

**Warn npm users off the bad version.** Deprecation warns at install time and
deliberately leaves the version installable:

```bash
npm deprecate @humanintheloop/linear@X.Y.Z "Critical bug; upgrade to X.Y.Z+1"
```

Do not unpublish. It is only possible within 72 hours and it breaks everyone
who already pinned that version.

**Demote the GitHub release** so downstream tooling stops resolving it:

```bash
gh release edit vX.Y.Z --prerelease
```

**Move the `latest` dist-tag back** if the bad version is still what npm hands
out by default:

```bash
npm dist-tag add @humanintheloop/linear@X.Y.Z-1 latest
```

## Manual trigger

Run the `Publish Release` workflow from the Actions tab, or:

```bash
gh workflow run "Publish Release" --ref main
```

It applies the same commit rules, so it publishes only when the commits since
the last tag call for it. Only `maintain` and `admin` may invoke it.

## What the pipeline needs

Configured on the `npm-publish` environment:

| Secret | Purpose |
| --- | --- |
| `NPM_TOKEN` | granular token, read and write on the `@humanintheloop` scope |
| `RELEASE_APP_ID` | GitHub App that pushes the bump commit and tag |
| `RELEASE_APP_PRIVATE_KEY` | private key for that app |

`main` is protected against force pushes and deletion. The pipeline only
fast-forwards, so it needs no exemption; adding a rule that requires pull
requests would need the release app on the bypass list.

## Other channels

npm is the only published channel. Homebrew and the `install.sh` /
`install.ps1` bootstraps are described in
[`docs/INSTALLING.md`](docs/INSTALLING.md) and are not wired into this pipeline
yet; they resolve the published version at runtime, so they need no per-release
edit when they land.
