import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfig } from "../../../src/common/config-store.js";
import * as gitRemote from "../../../src/common/git-remote.js";
import {
  applyScopeToFilter,
  buildScopeFragments,
  getActiveScope,
  NO_SCOPE,
} from "../../../src/common/scope-filter.js";

let tmpHome: string;
let tmpRepo: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let topLevelSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "scope-filter-home-"));
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "scope-filter-repo-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  topLevelSpy = vi.spyOn(gitRemote, "getGitTopLevel").mockReturnValue(tmpRepo);
});

afterEach(() => {
  homedirSpy.mockRestore();
  topLevelSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRepo, { recursive: true, force: true });
});

describe("getActiveScope", () => {
  it("returns an empty object when nothing is configured", () => {
    expect(getActiveScope({})).toEqual({});
  });

  it("reads scope.label / scope.team / scope.default_project from local layer", () => {
    setConfig("scope.label", "git:foo", { layer: "local" });
    setConfig("scope.team", "LIN", { layer: "local" });
    setConfig("scope.default_project", "prj_123", { layer: "local" });
    expect(getActiveScope({})).toEqual({
      label: "git:foo",
      team: "LIN",
      project: "prj_123",
    });
  });

  it("override.label takes precedence over config", () => {
    setConfig("scope.label", "git:from-config", { layer: "local" });
    expect(getActiveScope({}, { label: "git:override" })).toEqual({
      label: "git:override",
    });
  });
});

describe("buildScopeFragments", () => {
  it("returns no fragments for empty scope", () => {
    expect(buildScopeFragments({})).toEqual([]);
    expect(buildScopeFragments(NO_SCOPE)).toEqual([]);
  });

  it("emits a label fragment when scope.label is set", () => {
    expect(buildScopeFragments({ label: "git:foo" })).toEqual([
      { labels: { some: { name: { eq: "git:foo" } } } },
    ]);
  });

  it("does not emit fragments for team/project (consumed elsewhere)", () => {
    expect(buildScopeFragments({ team: "LIN", project: "prj_123" })).toEqual(
      [],
    );
  });
});

describe("applyScopeToFilter", () => {
  it("returns the base filter when scope is undefined", () => {
    const base = { state: { type: { eq: "started" } } };
    expect(applyScopeToFilter(base, undefined)).toBe(base);
  });

  it("returns the base filter when scope contributes no fragments", () => {
    const base = { state: { type: { eq: "started" } } };
    expect(applyScopeToFilter(base, {})).toBe(base);
  });

  it("AND-wraps the base when scope.label is set", () => {
    const base = { state: { type: { eq: "started" } } };
    expect(applyScopeToFilter(base, { label: "git:foo" })).toEqual({
      and: [base, { labels: { some: { name: { eq: "git:foo" } } } }],
    });
  });

  it("returns the bare fragment when base is undefined and scope is set", () => {
    expect(applyScopeToFilter(undefined, { label: "git:foo" })).toEqual({
      labels: { some: { name: { eq: "git:foo" } } },
    });
  });

  it("returns undefined when both base and scope are absent", () => {
    expect(applyScopeToFilter(undefined, undefined)).toBeUndefined();
    expect(applyScopeToFilter(undefined, {})).toBeUndefined();
  });
});
