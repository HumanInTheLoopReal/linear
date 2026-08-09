/**
 * Command-layer coverage for `linear memory forget`. The service layer
 * (deleteMemory) is exercised in tests/unit/common/memory-store.test.ts;
 * this file pins the *command contract*: exit code 1 on not-found vs exit 0
 * on success.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupMemoryCommands } from "../../../src/commands/memory.js";

let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "memory-forget-"));
  fs.mkdirSync(path.join(tmpHome, ".linear"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  process.exitCode = 0;
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function makeProgram(): Command {
  const program = new Command();
  // --json on the root program is what `getRootOpts(command)` reads to
  // dispatch outputResult to the JSON path. The test pins the JSON
  // contract, so we set it here once and pass `--json` on each call.
  program.option("--json");
  setupMemoryCommands(program);
  return program;
}

describe("linear memory forget", () => {
  it("removes the key and reports deleted=true", async () => {
    const memPath = path.join(tmpHome, ".linear", "memory.json");
    fs.writeFileSync(
      memPath,
      JSON.stringify({ alpha: { value: "x", updated_at: "2026-01-01" } }),
    );
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m) => {
      logs.push(String(m));
    });
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "memory",
      "forget",
      "alpha",
    ]);
    const parsed = JSON.parse(logs.join(""));
    expect(parsed).toMatchObject({ key: "alpha", deleted: true });
    expect(process.exitCode).toBe(0);
    const after = JSON.parse(fs.readFileSync(memPath, "utf8"));
    expect(after.alpha).toBeUndefined();
  });

  it("exits 1 with a not-found error when the key is missing", async () => {
    const errs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m) => {
      errs.push(String(m));
    });
    await makeProgram().parseAsync([
      "node",
      "test",
      "--json",
      "memory",
      "forget",
      "bogus",
    ]);
    const payload = JSON.parse(errs.join(""));
    expect(payload.error).toMatch(/not found/);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
