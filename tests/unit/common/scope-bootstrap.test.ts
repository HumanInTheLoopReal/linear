import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configStore from "../../../src/common/config-store.js";
import * as gitRemote from "../../../src/common/git-remote.js";
import {
  _resetScopeBootstrapForTests,
  ensureRepoScope,
} from "../../../src/common/scope-bootstrap.js";

let tmpHome: string;
let tmpRepo: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let getGitTopLevelSpy: ReturnType<typeof vi.spyOn>;
let deriveScopeLabelSpy: ReturnType<typeof vi.spyOn>;
let stderrBuf: string[];

class BufferedStderr {
  write(chunk: string): boolean {
    stderrBuf.push(chunk);
    return true;
  }
}

beforeEach(() => {
  _resetScopeBootstrapForTests();
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "scope-boot-home-"));
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "scope-boot-repo-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  getGitTopLevelSpy = vi
    .spyOn(gitRemote, "getGitTopLevel")
    .mockReturnValue(null);
  deriveScopeLabelSpy = vi
    .spyOn(gitRemote, "deriveScopeLabel")
    .mockReturnValue(null);
  stderrBuf = [];
});

afterEach(() => {
  homedirSpy.mockRestore();
  getGitTopLevelSpy.mockRestore();
  deriveScopeLabelSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRepo, { recursive: true, force: true });
});

describe("ensureRepoScope", () => {
  it("writes scope.label and emits stderr notice on first run in a fresh repo", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    deriveScopeLabelSpy.mockReturnValue({
      label: "git:scope-test",
      source: "git_remote",
    });

    const result = ensureRepoScope(
      {},
      new BufferedStderr() as unknown as NodeJS.WritableStream,
    );

    expect(result).toEqual({ performed: true, label: "git:scope-test" });
    expect(stderrBuf.join("")).toMatch(
      /initialized \.linear\/config\.json for this repo \(scope: git:scope-test\)/,
    );
    const localFile = path.join(tmpRepo, ".linear", "config.json");
    expect(JSON.parse(fs.readFileSync(localFile, "utf8"))).toEqual({
      "scope.label": "git:scope-test",
    });
  });

  it("is idempotent: a second call in the same process is a no-op", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    deriveScopeLabelSpy.mockReturnValue({
      label: "git:scope-test",
      source: "git_remote",
    });

    const first = ensureRepoScope(
      {},
      new BufferedStderr() as unknown as NodeJS.WritableStream,
    );
    const second = ensureRepoScope(
      {},
      new BufferedStderr() as unknown as NodeJS.WritableStream,
    );

    expect(first.performed).toBe(true);
    expect(second).toEqual({
      performed: false,
      reason: "already-attempted",
    });
  });

  it("respects LINEAR_NO_AUTO_INIT", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    deriveScopeLabelSpy.mockReturnValue({
      label: "git:scope-test",
      source: "git_remote",
    });

    const result = ensureRepoScope(
      { LINEAR_NO_AUTO_INIT: "1" },
      new BufferedStderr() as unknown as NodeJS.WritableStream,
    );

    expect(result).toEqual({ performed: false, reason: "env-disabled" });
    expect(stderrBuf.join("")).toBe("");
    expect(fs.existsSync(path.join(tmpRepo, ".linear", "config.json"))).toBe(
      false,
    );
  });

  it("skips when not inside a git repo", () => {
    // default: getGitTopLevel returns null
    const result = ensureRepoScope(
      {},
      new BufferedStderr() as unknown as NodeJS.WritableStream,
    );
    expect(result).toEqual({ performed: false, reason: "no-git-repo" });
  });

  it("skips when scope.label already set in local layer", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    configStore.setConfig("scope.label", "git:preexisting", {
      layer: "local",
    });
    deriveScopeLabelSpy.mockReturnValue({
      label: "git:scope-test",
      source: "git_remote",
    });

    const result = ensureRepoScope(
      {},
      new BufferedStderr() as unknown as NodeJS.WritableStream,
    );

    expect(result).toEqual({
      performed: false,
      reason: "already-configured",
    });
    const parsed = JSON.parse(
      fs.readFileSync(path.join(tmpRepo, ".linear", "config.json"), "utf8"),
    );
    expect(parsed["scope.label"]).toBe("git:preexisting");
  });

  it("skips when scope.label already set in global layer", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    configStore.setConfig("scope.label", "git:from-global", {
      layer: "global",
    });
    deriveScopeLabelSpy.mockReturnValue({
      label: "git:scope-test",
      source: "git_remote",
    });

    const result = ensureRepoScope(
      {},
      new BufferedStderr() as unknown as NodeJS.WritableStream,
    );

    expect(result).toEqual({
      performed: false,
      reason: "already-configured",
    });
    // Local file must NOT be created because we deferred to the global config.
    expect(fs.existsSync(path.join(tmpRepo, ".linear", "config.json"))).toBe(
      false,
    );
  });

  it("skips when deriveScopeLabel returns null", () => {
    getGitTopLevelSpy.mockReturnValue(tmpRepo);
    deriveScopeLabelSpy.mockReturnValue(null);

    const result = ensureRepoScope(
      {},
      new BufferedStderr() as unknown as NodeJS.WritableStream,
    );

    expect(result).toEqual({
      performed: false,
      reason: "no-label-derivable",
    });
  });
});
