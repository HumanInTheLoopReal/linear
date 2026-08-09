import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupKvCommands } from "../../../src/commands/kv.js";

let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let logs: string[];
let errs: string[];

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kv-cmd-"));
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
  process.exitCode = 0;
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function makeProgram(): Command {
  const program = new Command();
  // Root --json is what `getRootOpts(command)` reads to route output through
  // the JSON path. These tests pin the JSON contract, so we set it once and
  // pass `--json` in each parseAsync call.
  program.option("--json");
  setupKvCommands(program);
  return program;
}

describe("linear kv set", () => {
  it("writes the pair and returns {key, value, action}", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "set",
      "endpoint",
      "https://example.com",
    ]);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed).toEqual({
      key: "endpoint",
      value: "https://example.com",
      action: "set",
    });
    const file = path.join(tmpHome, ".linear", "kv.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      endpoint: "https://example.com",
    });
  });

  it("reports 'updated' on a second set to the same key", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "set",
      "k",
      "v1",
    ]);
    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "set",
      "k",
      "v2",
    ]);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed.action).toBe("updated");
    expect(parsed.value).toBe("v2");
  });

  it("rejects reserved-prefix keys with exit 1", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "set",
      "linear.foo",
      "v",
    ]);
    const payload = JSON.parse(errs.join(""));
    expect(payload.error).toMatch(/reserved prefix/);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("linear kv get", () => {
  it("returns {key, value, found: true} when key exists", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "set",
      "a",
      "1",
    ]);
    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "get",
      "a",
    ]);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed).toEqual({ key: "a", value: "1", found: true });
  });

  it("exits 1 with a not-found error when key is missing", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "get",
      "ghost",
    ]);
    const payload = JSON.parse(errs.join(""));
    expect(payload.error).toMatch(/not found/);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("linear kv clear", () => {
  it("deletes the key and returns deleted=true", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "set",
      "a",
      "1",
    ]);
    logs.length = 0;
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "clear",
      "a",
    ]);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed).toEqual({ key: "a", deleted: true });
  });

  it("exits 1 when the key was never set", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "clear",
      "ghost",
    ]);
    const payload = JSON.parse(errs.join(""));
    expect(payload.error).toMatch(/not found/);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("linear kv list", () => {
  it("emits {} when the store is empty", async () => {
    await makeProgram().parseAsync(["node", "test", "--json", "kv", "list"]);
    expect(JSON.parse(logs.join(""))).toEqual({});
  });

  it("emits all pairs sorted by key", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "set",
      "c",
      "3",
    ]);
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "set",
      "a",
      "1",
    ]);
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "kv",
      "set",
      "b",
      "2",
    ]);
    logs.length = 0;
    await makeProgram().parseAsync(["node", "test", "--json", "kv", "list"]);
    const parsed = JSON.parse(logs.join(""));
    expect(Object.keys(parsed)).toEqual(["a", "b", "c"]);
    expect(parsed).toEqual({ a: "1", b: "2", c: "3" });
  });
});
