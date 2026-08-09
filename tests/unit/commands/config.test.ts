import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pin git-toplevel to null so the layer defaults fall through to "global" —
// these tests cover the legacy single-file behavior. Layer-aware tests live
// further down in their own describe block.
vi.mock("../../../src/common/git-remote.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/git-remote.js")>();
  return {
    ...actual,
    getGitTopLevel: vi.fn(() => null),
  };
});

import { setupConfigCommands } from "../../../src/commands/config.js";

let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let logs: string[];
let errs: string[];

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "config-cmd-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((m) => {
    logs.push(String(m));
  });
  vi.spyOn(console, "error").mockImplementation((m) => {
    errs.push(String(m));
  });
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.exitCode = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  homedirSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function makeProgram(): Command {
  const program = new Command();
  // Root --json is what `getRootOpts(command)` reads to route output through
  // the JSON path. These tests pin the JSON contract, so we set it once and
  // pass `--json` in each parseAsync call.
  program.option("--json");
  setupConfigCommands(program);
  return program;
}

describe("linear config set/get/unset", () => {
  it("set writes the pair and reports action", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set",
      "linear.endpoint",
      "https://api.linear.app/graphql",
    ]);
    expect(JSON.parse(logs.join(""))).toEqual({
      key: "linear.endpoint",
      value: "https://api.linear.app/graphql",
      action: "set",
      layer: "global",
    });
  });

  it("get returns the value with source=global", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set",
      "k",
      "v",
    ]);
    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "get",
      "k",
    ]);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed).toEqual({
      key: "k",
      value: "v",
      found: true,
      source: "global",
    });
  });

  it("get exits 1 with not-found when missing", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "get",
      "ghost",
    ]);
    expect(JSON.parse(errs.join("")).error).toMatch(/not found/);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("unset deletes a present key", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set",
      "k",
      "v",
    ]);
    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "unset",
      "k",
    ]);
    expect(JSON.parse(logs.join(""))).toEqual({ key: "k", deleted: true });
  });

  it("set rejects keys containing '='", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set",
      "a=b",
      "v",
    ]);
    expect(JSON.parse(errs.join("")).error).toMatch(/'='/);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("linear config set-many", () => {
  it("writes all pairs atomically", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set-many",
      "a=1",
      "b=2",
      "c=3",
    ]);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed.set).toHaveLength(3);
    const file = path.join(tmpHome, ".linear", "config.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      a: "1",
      b: "2",
      c: "3",
    });
  });

  it("rejects malformed pairs without writing anything", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set-many",
      "valid=1",
      "novalueafter",
    ]);
    expect(JSON.parse(errs.join("")).error).toMatch(/key=value/);
    const file = path.join(tmpHome, ".linear", "config.json");
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("linear config layered (--local / --global)", () => {
  it("--global writes to ~/.linear/config.json", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set",
      "--global",
      "k",
      "v",
    ]);
    expect(JSON.parse(logs.join(""))).toEqual({
      key: "k",
      value: "v",
      action: "set",
      layer: "global",
    });
    const file = path.join(tmpHome, ".linear", "config.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ k: "v" });
  });

  it("--local errors when not in a git repo", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set",
      "--local",
      "k",
      "v",
    ]);
    expect(JSON.parse(errs.join("")).error).toMatch(/git repo/i);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("--local and --global are mutually exclusive", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set",
      "--local",
      "--global",
      "k",
      "v",
    ]);
    expect(JSON.parse(errs.join("")).error).toMatch(/mutually exclusive/i);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("get --global pins to the global layer", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set",
      "--global",
      "k",
      "v",
    ]);
    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "get",
      "--global",
      "k",
    ]);
    expect(JSON.parse(logs.join(""))).toEqual({
      key: "k",
      value: "v",
      found: true,
      source: "global",
    });
  });
});

describe("linear config list / show", () => {
  it("list returns sorted file-only map", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set-many",
      "c=3",
      "a=1",
      "b=2",
    ]);
    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "list",
    ]);
    const parsed = JSON.parse(logs.join(""));
    expect(Object.keys(parsed)).toEqual(["a", "b", "c"]);
  });

  it("show emits per-key {key, value, source}", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set",
      "k",
      "v",
    ]);
    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "show",
    ]);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed).toEqual([{ key: "k", value: "v", source: "global" }]);
  });

  it("redacts API tokens from mutation and bulk JSON output but not explicit get", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set",
      "linear.api_token",
      "stored-secret",
    ]);
    expect(logs.join("")).not.toContain("stored-secret");
    expect(JSON.parse(logs.join(""))).toMatchObject({
      key: "linear.api_token",
      value: "[REDACTED]",
    });

    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "set-many",
      "linear.api_token=updated-secret",
    ]);
    expect(logs.join("")).not.toContain("updated-secret");
    expect(JSON.parse(logs.join("")).set[0]).toMatchObject({
      key: "linear.api_token",
      value: "[REDACTED]",
    });

    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "list",
    ]);
    expect(JSON.parse(logs.join(""))).toEqual({
      "linear.api_token": "[REDACTED]",
    });

    vi.stubEnv("LINEAR_API_TOKEN", "env-secret");
    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "show",
    ]);
    expect(JSON.parse(logs.join(""))).toContainEqual({
      key: "linear.api_token",
      value: "[REDACTED]",
      source: "env",
    });

    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "config",
      "get",
      "linear.api_token",
    ]);
    expect(JSON.parse(logs.join(""))).toMatchObject({
      value: "env-secret",
      source: "env",
    });
  });

  it("redacts API tokens from bulk text output", async () => {
    const stdout: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        stdout.push(String(chunk));
        return true;
      });
    await makeProgram().parseAsync([
      "node",
      "test",
      "config",
      "set",
      "linear.api_token",
      "stored-secret",
    ]);
    expect(stdout.join("")).toContain("[REDACTED]");
    expect(stdout.join("")).not.toContain("stored-secret");

    stdout.length = 0;
    await makeProgram().parseAsync(["node", "test", "config", "list"]);
    expect(stdout.join("")).toContain("linear.api_token = [REDACTED]");
    expect(stdout.join("")).not.toContain("stored-secret");

    vi.stubEnv("LINEAR_API_TOKEN", "env-secret");
    stdout.length = 0;
    await makeProgram().parseAsync(["node", "test", "config", "show"]);
    expect(stdout.join("")).toContain("[REDACTED]");
    expect(stdout.join("")).not.toContain("env-secret");
    stdoutSpy.mockRestore();
  });
});
