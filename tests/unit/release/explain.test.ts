import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  classify,
  loadReleaseRules,
  report,
} from "../../../scripts/release/explain.mjs";

const require = createRequire(import.meta.url);
const rules = loadReleaseRules(require("../../../.releaserc.cjs"));

describe("release explain", () => {
  it("reads the suppression rules out of the release config", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it.each([
    ["feat: initial public release", true],
    ["fix: propagate npm publish failures to the release", true],
    ["perf: cache resolved teams", true],
    ["refactor!: drop the legacy token path", true],
  ])("releases on %s", (subject, expected) => {
    expect(classify(subject, "", rules).releases).toBe(expected);
  });

  it.each([
    ["fix(release): fail the release when npm rejects the publish"],
    ["fix(ci): repair the cache key"],
    ["fix(workflow): correct the branch guard"],
    ["chore: initial commit"],
    ["docs: expand the readme"],
    ["merged pull request #4"],
  ])("does not release on %s", (subject) => {
    expect(classify(subject, "", rules).releases).toBe(false);
  });

  it("explains why a commit was skipped", () => {
    expect(classify("fix(release): x", "", rules).reason).toContain(
      'scope "release"',
    );
  });

  it("warns that a no-release push still leaves the workflow green", () => {
    const { text, willRelease } = report(
      [{ sha: "abc1234", subject: "chore: tidy", body: "" }],
      rules,
    );

    expect(willRelease).toBe(false);
    expect(text).toContain("NO release");
  });
});
