import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputSuccess: vi.fn(), outputResult: vi.fn() };
});

vi.mock("../../../src/services/where-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/services/where-service.js")
    >();
  return {
    ...actual,
    runWhere: vi.fn().mockResolvedValue({
      cli_version: "x",
      platform: { key: "linear" },
      cwd: "/tmp",
      paths: {
        token_dir: "/h/linear",
        token_path: "/h/linear/token",
        token_exists: false,
        memory_path: "/h/.linear/memory.json",
        memory_exists: false,
        audit_path: "/h/.linear/interactions.jsonl",
        audit_exists: false,
        snapshots_dir: "/h/.linear/snapshots",
        snapshots_exists: false,
      },
      token: { source: "none", resolved: false },
    }),
  };
});

import { setupWhereCommands } from "../../../src/commands/where.js";
import { createGraphQLClient } from "../../../src/common/context.js";
import { outputResult } from "../../../src/common/output.js";
import { runWhere } from "../../../src/services/where-service.js";

function createProgram(): Command {
  const program = new Command();
  program.option("--api-token <token>");
  setupWhereCommands(program);
  return program;
}

describe("linear where", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("calls runWhere with includeViewer=false by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "where"]);
    const call = vi.mocked(runWhere).mock.calls[0]?.[0];
    expect(call?.includeViewer).toBe(false);
    expect(outputResult).toHaveBeenCalled();
  });

  it("threads --viewer into includeViewer=true", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "where", "--viewer"]);
    const call = vi.mocked(runWhere).mock.calls[0]?.[0];
    expect(call?.includeViewer).toBe(true);
    expect(call?.makeClient).toBe(createGraphQLClient);
  });

  it("forwards the global --api-token into runWhere.apiToken", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "--api-token",
      "tok-cli",
      "where",
    ]);
    const call = vi.mocked(runWhere).mock.calls[0]?.[0];
    expect(call?.apiToken).toBe("tok-cli");
  });

  it("forwards root --json through getRootOpts (text-default dispatch)", async () => {
    // --json is no longer a per-command flag on `where`; it lives on the
    // root program and outputResult reads it via getRootOpts. This test
    // just confirms passing --json after the verb doesn't error out.
    const program = createProgram();
    program.option("--json");
    await program.parseAsync(["node", "test", "--json", "where"]);
    expect(runWhere).toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalled();
  });

  it("emits the runWhere result through outputResult with formatWhere", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "where"]);
    const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
      platform?: { key: string };
    };
    expect(payload?.platform?.key).toBe("linear");
  });
});
