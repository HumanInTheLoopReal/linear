import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findLocalConfigPath,
  getConfig,
  getConfigPath,
  getDefaultTeam,
  getGlobalConfigPath,
  getLastSeenVersion,
  getLinearEndpoint,
  getSuppressedDoctorChecks,
  LocalConfigUnavailableError,
  listConfig,
  readAll,
  setConfig,
  setLastSeenVersion,
  setManyConfig,
  showConfig,
  unsetConfig,
  validateConfigKey,
} from "../../../src/common/config-store.js";
import * as gitRemote from "../../../src/common/git-remote.js";

let tmpHome: string;
let tmpRepo: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let getGitTopLevelSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "config-store-"));
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "config-store-repo-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  // Default to "not in a git repo"; individual tests opt in by re-mocking.
  getGitTopLevelSpy = vi
    .spyOn(gitRemote, "getGitTopLevel")
    .mockReturnValue(null);
});

afterEach(() => {
  homedirSpy.mockRestore();
  getGitTopLevelSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRepo, { recursive: true, force: true });
});

describe("validateConfigKey", () => {
  it("accepts ordinary namespaced keys", () => {
    expect(validateConfigKey("linear.endpoint")).toBeNull();
    expect(validateConfigKey("output.title-length")).toBeNull();
  });

  it("rejects empty / whitespace / equals-containing keys", () => {
    expect(validateConfigKey("")).toMatch(/empty/);
    expect(validateConfigKey("   ")).toMatch(/whitespace/);
    expect(validateConfigKey("a=b")).toMatch(/'='/);
  });
});

describe("config-store CRUD (global layer)", () => {
  it("setConfig creates the file and reports action=set", () => {
    const r = setConfig("linear.endpoint", "https://api.linear.app/graphql");
    expect(r.action).toBe("set");
    expect(r.layer).toBe("global");
    expect(fs.existsSync(getGlobalConfigPath())).toBe(true);
  });

  it("setConfig on existing key reports action=updated", () => {
    setConfig("k", "v1");
    expect(setConfig("k", "v2").action).toBe("updated");
    expect(readAll()).toEqual({ k: "v2" });
  });

  it("getConfig source=global when value is on disk only", () => {
    setConfig("k", "v1");
    const r = getConfig("k", {});
    expect(r).toEqual({
      key: "k",
      value: "v1",
      found: true,
      source: "global",
    });
  });

  it("getConfig source=env when LINEAR_API_TOKEN is set", () => {
    setConfig("linear.api_token", "from-file");
    const r = getConfig("linear.api_token", { LINEAR_API_TOKEN: "from-env" });
    expect(r).toEqual({
      key: "linear.api_token",
      value: "from-env",
      found: true,
      source: "env",
    });
  });

  it("getConfig env-override only applies when value is non-empty", () => {
    setConfig("linear.endpoint", "from-file");
    const r = getConfig("linear.endpoint", { LINEAR_ENDPOINT: "" });
    expect(r.source).toBe("global");
    expect(r.value).toBe("from-file");
  });

  it("getConfig returns found=false / source=default when neither", () => {
    expect(getConfig("nothing", {})).toEqual({
      key: "nothing",
      value: null,
      found: false,
      source: "default",
    });
  });

  it("unsetConfig deletes a present key and returns true", () => {
    setConfig("a", "1");
    setConfig("b", "2");
    expect(unsetConfig("a")).toBe(true);
    expect(readAll()).toEqual({ b: "2" });
  });

  it("unsetConfig returns false on absent key", () => {
    expect(unsetConfig("nope")).toBe(false);
  });

  it("listConfig returns keys sorted, file-only (no env injection)", () => {
    setConfig("c", "3");
    setConfig("a", "1");
    setConfig("b", "2");
    expect(Object.keys(listConfig())).toEqual(["a", "b", "c"]);
  });

  it("listConfig redacts stored API tokens without changing the file", () => {
    setConfig("linear.api_token", "stored-secret");

    expect(listConfig()).toEqual({ "linear.api_token": "[REDACTED]" });
    expect(readAll()).toEqual({ "linear.api_token": "stored-secret" });
  });

  it("redacts API tokens in set results while storing the raw value", () => {
    expect(setConfig("linear.api_token", "stored-secret")).toMatchObject({
      value: "[REDACTED]",
    });
    expect(
      setManyConfig([{ key: "linear.api_token", value: "updated-secret" }]),
    ).toMatchObject([{ value: "[REDACTED]" }]);
    expect(readAll()).toEqual({ "linear.api_token": "updated-secret" });
  });

  it("setManyConfig writes all pairs and reports per-pair action", () => {
    setConfig("preexisting", "old");
    const results = setManyConfig([
      { key: "preexisting", value: "new" },
      { key: "fresh", value: "val" },
    ]);
    expect(results[0]).toMatchObject({
      key: "preexisting",
      value: "new",
      action: "updated",
      layer: "global",
    });
    expect(results[1]).toMatchObject({
      key: "fresh",
      value: "val",
      action: "set",
      layer: "global",
    });
    expect(readAll()).toEqual({ preexisting: "new", fresh: "val" });
  });

  it("showConfig includes env-only keys and tags them source=env", () => {
    setConfig("on-disk", "v");
    const out = showConfig({ LINEAR_API_TOKEN: "secret" });
    const onDisk = out.find((r) => r.key === "on-disk");
    const envOnly = out.find((r) => r.key === "linear.api_token");
    expect(onDisk).toEqual({ key: "on-disk", value: "v", source: "global" });
    expect(envOnly).toEqual({
      key: "linear.api_token",
      value: "[REDACTED]",
      source: "env",
    });
  });

  it("getConfig still returns an explicitly requested sensitive value", () => {
    setConfig("linear.api_token", "stored-secret");

    expect(getConfig("linear.api_token", {})).toMatchObject({
      value: "stored-secret",
      source: "global",
    });
  });

  it("getLinearEndpoint returns the effective endpoint or undefined", () => {
    expect(getLinearEndpoint({})).toBeUndefined();
    setConfig("linear.endpoint", "https://proxy.example/graphql");
    expect(getLinearEndpoint({})).toBe("https://proxy.example/graphql");
    expect(
      getLinearEndpoint({ LINEAR_ENDPOINT: "https://env.example/graphql" }),
    ).toBe("https://env.example/graphql");
  });

  it("file is written with 0600 perms", () => {
    setConfig("x", "y");
    const stat = fs.statSync(getGlobalConfigPath());
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe("getDefaultTeam", () => {
  it("reads team.default from the on-disk config", () => {
    setConfig("team.default", "TES");
    expect(getDefaultTeam({})).toBe("TES");
  });

  it("returns null when neither file nor env is set", () => {
    expect(getDefaultTeam({})).toBeNull();
  });

  it("LINEAR_TEAM env overrides the file value", () => {
    setConfig("team.default", "from-file");
    expect(getDefaultTeam({ LINEAR_TEAM: "from-env" })).toBe("from-env");
  });

  it("empty LINEAR_TEAM falls through to the file value", () => {
    setConfig("team.default", "from-file");
    expect(getDefaultTeam({ LINEAR_TEAM: "" })).toBe("from-file");
  });

  it("scope.team in the local layer overrides global team.default", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    setConfig("team.default", "GLO");
    setConfig("scope.team", "LOC", { layer: "local" });
    expect(getDefaultTeam({})).toBe("LOC");
  });

  it("LINEAR_TEAM still wins over scope.team", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    setConfig("scope.team", "LOC", { layer: "local" });
    expect(getDefaultTeam({ LINEAR_TEAM: "ENV" })).toBe("ENV");
  });
});

describe("last-seen-version helpers", () => {
  it("getLastSeenVersion returns empty string on first run", () => {
    expect(getLastSeenVersion({})).toBe("");
  });

  it("setLastSeenVersion writes the global config and getLastSeenVersion reads it back", () => {
    setLastSeenVersion("2026.4.9");
    expect(getLastSeenVersion({})).toBe("2026.4.9");
    expect(readAll()).toEqual({ "linear.last_seen_version": "2026.4.9" });
  });

  it("LINEAR_LAST_SEEN_VERSION env overrides the file value", () => {
    setLastSeenVersion("2026.4.8");
    expect(getLastSeenVersion({ LINEAR_LAST_SEEN_VERSION: "2026.4.9" })).toBe(
      "2026.4.9",
    );
  });

  it("empty LINEAR_LAST_SEEN_VERSION falls through to the file value", () => {
    setLastSeenVersion("2026.4.8");
    expect(getLastSeenVersion({ LINEAR_LAST_SEEN_VERSION: "" })).toBe(
      "2026.4.8",
    );
  });
});

describe("config-store local layer", () => {
  it("findLocalConfigPath returns null outside a git repo", () => {
    expect(findLocalConfigPath()).toBeNull();
  });

  it("findLocalConfigPath returns <repo>/.linear/config.json inside a repo", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    expect(findLocalConfigPath()).toBe(
      path.join(tmpRepo, ".linear", "config.json"),
    );
  });

  it("setConfig with layer=local writes the per-repo file", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    const r = setConfig("scope.label", "git:foo", { layer: "local" });
    expect(r.layer).toBe("local");
    const localPath = path.join(tmpRepo, ".linear", "config.json");
    expect(fs.existsSync(localPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(localPath, "utf8"));
    expect(parsed).toEqual({ "scope.label": "git:foo" });
  });

  it("setConfig with layer=local throws LocalConfigUnavailableError outside a repo", () => {
    expect(() =>
      setConfig("scope.label", "git:foo", { layer: "local" }),
    ).toThrow(LocalConfigUnavailableError);
  });

  it("getConfigPath('local') resolves to the per-repo file", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    expect(getConfigPath("local")).toBe(
      path.join(tmpRepo, ".linear", "config.json"),
    );
  });

  it("local file is written with 0600 perms in a 0700 dir", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    setConfig("scope.label", "git:foo", { layer: "local" });
    const localPath = path.join(tmpRepo, ".linear", "config.json");
    const fileStat = fs.statSync(localPath);
    const dirStat = fs.statSync(path.join(tmpRepo, ".linear"));
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it("unsetConfig honors the layer option", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    setConfig("scope.label", "git:foo", { layer: "local" });
    expect(unsetConfig("scope.label", { layer: "local" })).toBe(true);
    expect(readAll("local")).toEqual({});
  });

  it("setManyConfig honors the layer option", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    setManyConfig(
      [
        { key: "scope.label", value: "git:foo" },
        { key: "scope.team", value: "LIN" },
      ],
      { layer: "local" },
    );
    expect(readAll("local")).toEqual({
      "scope.label": "git:foo",
      "scope.team": "LIN",
    });
  });
});

describe("config-store precedence (env > local > global)", () => {
  beforeEach(() => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
  });

  it("local value wins over global for the same key", () => {
    setConfig("k", "global-value", { layer: "global" });
    setConfig("k", "local-value", { layer: "local" });
    expect(getConfig("k", {})).toEqual({
      key: "k",
      value: "local-value",
      found: true,
      source: "local",
    });
  });

  it("falls through to global when local does not contain the key", () => {
    setConfig("k", "global-value", { layer: "global" });
    expect(getConfig("k", {})).toEqual({
      key: "k",
      value: "global-value",
      found: true,
      source: "global",
    });
  });

  it("env still beats local", () => {
    setConfig("linear.endpoint", "from-local", { layer: "local" });
    const r = getConfig("linear.endpoint", { LINEAR_ENDPOINT: "from-env" });
    expect(r).toEqual({
      key: "linear.endpoint",
      value: "from-env",
      found: true,
      source: "env",
    });
  });

  it("opts.layer pins reads to a specific layer", () => {
    setConfig("k", "global-value", { layer: "global" });
    setConfig("k", "local-value", { layer: "local" });
    expect(getConfig("k", {}, { layer: "global" })).toEqual({
      key: "k",
      value: "global-value",
      found: true,
      source: "global",
    });
    expect(getConfig("k", {}, { layer: "local" })).toEqual({
      key: "k",
      value: "local-value",
      found: true,
      source: "local",
    });
  });

  it("showConfig merges both layers and tags source per key", () => {
    setConfig("only-global", "g", { layer: "global" });
    setConfig("only-local", "l", { layer: "local" });
    setConfig("overlap", "g", { layer: "global" });
    setConfig("overlap", "l", { layer: "local" });
    const out = showConfig({});
    expect(out.find((r) => r.key === "only-global")).toEqual({
      key: "only-global",
      value: "g",
      source: "global",
    });
    expect(out.find((r) => r.key === "only-local")).toEqual({
      key: "only-local",
      value: "l",
      source: "local",
    });
    expect(out.find((r) => r.key === "overlap")).toEqual({
      key: "overlap",
      value: "l",
      source: "local",
    });
  });
});

describe("getSuppressedDoctorChecks", () => {
  beforeEach(() => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
  });

  it("uses a local false value to override a global suppression", () => {
    setConfig("doctor.suppress.scope-drift", "true", { layer: "global" });
    setConfig("doctor.suppress.scope-drift", "false", { layer: "local" });

    expect(getSuppressedDoctorChecks()).not.toContain("scope-drift");
  });

  it("uses a local true value to override a global false value", () => {
    setConfig("doctor.suppress.scope-drift", "false", { layer: "global" });
    setConfig("doctor.suppress.scope-drift", "TRUE", { layer: "local" });

    expect(getSuppressedDoctorChecks()).toContain("scope-drift");
  });
});
