module.exports = {
  repositoryUrl:
    process.env.SEMANTIC_RELEASE_REPOSITORY_URL ??
    "git@github.com:HumanInTheLoopReal/linear.git",
  branches: ["main", { name: "next", prerelease: "next" }],
  tagFormat: `v\${version}`,
  plugins: [
    [
      "./scripts/release/calver-plugin.cjs",
      {
        preset: "conventionalcommits",
        releaseRules: [
          // Suppress non-deliverable commits.
          // Releasable commits (feat/fix/perf/revert/breaking) still trigger release,
          // then calver-plugin maps analyzer output to patch cadence.
          { type: "refactor", release: false },
          { type: "chore", release: false },
          { type: "ci", release: false },
          { type: "docs", release: false },
          { type: "style", release: false },
          { type: "test", release: false },
          { type: "build", release: false },
          { scope: "ci", release: false },
          { scope: "release", release: false },
          { scope: "workflow", release: false },
        ],
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      { preset: "conventionalcommits" },
    ],
    [
      "@semantic-release/changelog",
      { changelogFile: "CHANGELOG.md", changelogTitle: "# Changelog" },
    ],
    ["@semantic-release/npm", { npmPublish: false, pkgRoot: "." }],
    [
      "@semantic-release/exec",
      {
        prepareCmd:
          `node scripts/release/plugin-versions.mjs \${nextRelease.version} && ` +
          "npm run build && npm run verify:plugin-versions && npm run verify:packed-binaries",
        // clean-publish ignores npm's exit code, so a rejected publish would
        // still report success. Stage the cleaned tree, then publish it
        // directly so the registry's exit code fails the release.
        publishCmd:
          "npx clean-publish --without-publish --temp-dir release-package && " +
          "npm publish ./release-package --access public --provenance " +
          '--tag $( [ "$GITHUB_REF_NAME" = "next" ] && echo next || echo latest )',
      },
    ],
    ["@semantic-release/github", { successComment: false, failComment: false }],
    [
      "@semantic-release/git",
      {
        assets: [
          "package.json",
          "package-lock.json",
          "CHANGELOG.md",
          ".claude-plugin/marketplace.json",
          "plugins/linear/.claude-plugin/plugin.json",
          "plugins/linear/.codex-plugin/plugin.json",
          "plugins/linear/.copilot-plugin/plugin.json",
          "plugins/linear/skills/linear/SKILL.md",
          "plugins/linear/skills/linear/resources/CLI_REFERENCE.md",
          "src/templates/agent-skill.ts",
        ],
        message: `chore(release): \${nextRelease.version} [skip ci]\n\n\${nextRelease.notes}`,
      },
    ],
  ],
};
