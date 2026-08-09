import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { runWhere } from "../../../src/services/where-service.js";

const ORIGINAL_ENV_TOKEN = process.env.LINEAR_API_TOKEN;

let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "where-test-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  delete process.env.LINEAR_API_TOKEN;
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  if (ORIGINAL_ENV_TOKEN === undefined) {
    delete process.env.LINEAR_API_TOKEN;
  } else {
    process.env.LINEAR_API_TOKEN = ORIGINAL_ENV_TOKEN;
  }
});

describe("runWhere — local-only path", () => {
  it("reports cli_version, platform, cwd, paths, and absent token", async () => {
    const result = await runWhere({ cliVersion: "1.2.3", cwd: "/tmp/work" });
    expect(result.cli_version).toBe("1.2.3");
    expect(result.platform).toEqual({ key: "linear" });
    expect(result.cwd).toBe("/tmp/work");
    expect(result.token.resolved).toBe(false);
    expect(result.token.source).toBe("none");
    expect(result.token.error).toMatch(/No API token/);
    expect(result.viewer).toBeUndefined();
  });

  it("reports *_exists=false when files are missing", async () => {
    // Chdir into a non-repo scratch dir so the per-repo audit-log path
    // doesn't accidentally collide with a real .linear/audit.jsonl in the
    // running checkout.
    const cwdBackup = process.cwd();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "where-norepo-"));
    process.chdir(scratch);
    try {
      const result = await runWhere({ cliVersion: "x" });
      expect(result.paths.token_exists).toBe(false);
      expect(result.paths.memory_exists).toBe(false);
      expect(result.paths.audit_exists).toBe(false);
      expect(result.paths.snapshots_exists).toBe(false);
    } finally {
      process.chdir(cwdBackup);
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("detects an existing memory.json and audit log under ~/.linear", async () => {
    // Chdir into a non-repo scratch dir so the audit-log resolver falls back
    // to the per-user ~/.linear path (otherwise the linear-cli git repo this
    // test runs in would make findRepoRoot() return the workspace root).
    const cwdBackup = process.cwd();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "where-norepo-"));
    process.chdir(scratch);
    try {
      const linearDir = path.join(tmpHome, ".linear");
      fs.mkdirSync(linearDir, { recursive: true });
      fs.writeFileSync(path.join(linearDir, "memory.json"), "{}");
      fs.writeFileSync(path.join(linearDir, "audit.jsonl"), "");
      fs.mkdirSync(path.join(linearDir, "snapshots"));
      const result = await runWhere({ cliVersion: "x" });
      expect(result.paths.memory_exists).toBe(true);
      expect(result.paths.audit_exists).toBe(true);
      expect(result.paths.snapshots_exists).toBe(true);
      expect(result.paths.memory_path.endsWith(".linear/memory.json")).toBe(
        true,
      );
    } finally {
      process.chdir(cwdBackup);
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("runWhere — token source detection", () => {
  it("marks source=flag when an apiToken option is provided", async () => {
    const result = await runWhere({ cliVersion: "x", apiToken: "tok-flag" });
    expect(result.token).toEqual({ source: "flag", resolved: true });
  });

  it("marks source=env when LINEAR_API_TOKEN is set", async () => {
    process.env.LINEAR_API_TOKEN = "tok-env";
    const result = await runWhere({ cliVersion: "x" });
    expect(result.token).toEqual({ source: "env", resolved: true });
  });
});

describe("runWhere — viewer mode", () => {
  it("hits the viewer query when --viewer + token resolve", async () => {
    const request = vi.fn().mockResolvedValue({
      viewer: { id: "u-1", name: "Alex", email: "alex@example.com" },
    });
    const makeClient = vi.fn(() => ({ request }) as unknown as GraphQLClient);
    const result = await runWhere({
      cliVersion: "x",
      apiToken: "tok",
      includeViewer: true,
      makeClient,
    });
    expect(makeClient).toHaveBeenCalledWith("tok");
    expect(result.viewer).toEqual({
      id: "u-1",
      name: "Alex",
      email: "alex@example.com",
    });
    expect(result.viewer_error).toBeUndefined();
  });

  it("records viewer_error when --viewer is set but no token resolves", async () => {
    const makeClient = vi.fn();
    const result = await runWhere({
      cliVersion: "x",
      includeViewer: true,
      makeClient: makeClient as unknown as (t: string) => GraphQLClient,
    });
    expect(makeClient).not.toHaveBeenCalled();
    expect(result.viewer).toBeUndefined();
    expect(result.viewer_error).toMatch(/no token resolved/);
  });

  it("captures GraphQL errors into viewer_error rather than throwing", async () => {
    const request = vi.fn().mockRejectedValue(new Error("401 unauthorized"));
    const result = await runWhere({
      cliVersion: "x",
      apiToken: "tok",
      includeViewer: true,
      makeClient: () => ({ request }) as unknown as GraphQLClient,
    });
    expect(result.viewer).toBeUndefined();
    expect(result.viewer_error).toBe("401 unauthorized");
  });

  it("skips the viewer query by default (offline-friendly)", async () => {
    const request = vi.fn();
    const makeClient = vi.fn(() => ({ request }) as unknown as GraphQLClient);
    const result = await runWhere({
      cliVersion: "x",
      apiToken: "tok",
      makeClient,
    });
    expect(makeClient).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(result.viewer).toBeUndefined();
  });
});
