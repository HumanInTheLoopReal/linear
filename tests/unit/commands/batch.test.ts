import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  createContext: vi.fn(() => ({ gql: { request: vi.fn() }, sdk: {} })),
  getRootOpts: vi.fn(() => ({})),
}));

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn(async () => "team-uuid-a"),
}));

vi.mock("../../../src/resolvers/batch-resolver.js", () => ({
  resolveBatchOps: vi.fn(async (_sdk, ops: Array<{ cmd: string }>) =>
    ops.map((op, index) => ({ ...op, target: `resolved-${index}` })),
  ),
}));

vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn(() => null),
  // The create gate (resolveCreateValidationMode / resolveCreateSections)
  // reads config; default to "unset" so the gate runs in its default `error`
  // mode against the built-in template.
  getConfig: vi.fn(() => ({
    key: "",
    value: null,
    found: false,
    source: "default",
  })),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputSuccess: vi.fn(), outputResult: vi.fn() };
});

vi.mock("../../../src/services/batch-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/services/batch-service.js")
    >();
  return {
    ...actual,
    runBatchOps: vi.fn().mockResolvedValue({
      operations: 2,
      status: "ok",
      results: [
        { line: 1, op: "close", target: "LIN-1" },
        { line: 2, op: "update", target: "LIN-2" },
      ],
    }),
  };
});

import { setupBatchCommands } from "../../../src/commands/batch.js";
import { createContext } from "../../../src/common/context.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveBatchOps } from "../../../src/resolvers/batch-resolver.js";
import { resolveTeamId } from "../../../src/resolvers/team-resolver.js";
import { runBatchOps } from "../../../src/services/batch-service.js";

function createProgram(): Command {
  const program = new Command();
  setupBatchCommands(program);
  return program;
}

let tmpDir: string;

function writeScript(name: string, body: string): string {
  const fp = path.join(tmpDir, name);
  fs.writeFileSync(fp, body);
  return fp;
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-batch-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("linear batch", () => {
  it("reads commands from -f and forwards parsed ops to runBatchOps", async () => {
    const fp = writeScript(
      "ops.txt",
      "close LIN-1\nupdate LIN-2 status=closed\n",
    );
    const program = createProgram();
    await program.parseAsync(["node", "test", "batch", "-f", fp]);
    expect(runBatchOps).toHaveBeenCalledTimes(1);
    const [ops, context] = vi.mocked(runBatchOps).mock.calls[0] ?? [];
    expect(ops?.map((op) => op.cmd)).toEqual(["close", "update"]);
    expect(context).toEqual({ gql: expect.anything() });
    expect(resolveBatchOps).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Array),
      { defaultTeamId: undefined },
    );
    expect(outputResult).toHaveBeenCalled();
  });

  it("emits the dry-run shape without calling runBatchOps", async () => {
    const fp = writeScript(
      "ops.txt",
      "close LIN-1\nupdate LIN-2 status=closed\n",
    );
    const program = createProgram();
    await program.parseAsync(["node", "test", "batch", "-f", fp, "--dry-run"]);
    expect(runBatchOps).not.toHaveBeenCalled();
    expect(createContext).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: true, operations: 2 }),
      expect.any(Function),
      expect.anything(),
    );
  });

  it("rejects malformed update values in dry-run before authentication", async () => {
    const fp = writeScript("ops.txt", "update LIN-1 priority=2junk\n");
    const program = createProgram();

    await program.parseAsync(["node", "test", "batch", "-f", fp, "--dry-run"]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(outputResult).not.toHaveBeenCalled();
    expect(createContext).not.toHaveBeenCalled();
  });

  it("applies create gate and team validation in dry-run", async () => {
    const fp = writeScript("ops.txt", 'create task 2 "New issue"\n');

    const missingTeam = createProgram();
    await missingTeam.parseAsync([
      "node",
      "test",
      "batch",
      "-f",
      fp,
      "--dry-run",
      "--no-validate",
    ]);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(createContext).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const gated = createProgram();
    await gated.parseAsync([
      "node",
      "test",
      "batch",
      "-f",
      fp,
      "--dry-run",
      "--team",
      "ENG",
    ]);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("rejects a script with create ops when --team is missing", async () => {
    // --no-validate isolates the team-missing path from the create gate.
    const fp = writeScript("ops.txt", 'create task 2 "New issue"\n');
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "batch",
      "-f",
      fp,
      "--no-validate",
    ]);
    expect(runBatchOps).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("forwards a resolved defaultTeamId when --team is given", async () => {
    const fp = writeScript("ops.txt", 'create task 2 "New issue"\n');
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "batch",
      "-f",
      fp,
      "--team",
      "ENG",
      "--no-validate",
    ]);
    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(resolveBatchOps).toHaveBeenCalledWith(
      expect.anything(),
      [
        expect.objectContaining({
          cmd: "create",
          issueType: "task",
          title: "New issue",
          priority: 2,
        }),
      ],
      { defaultTeamId: "team-uuid-a" },
    );
  });

  it("blocks title-only `create` ops by default (template gate, lin-fllv)", async () => {
    const fp = writeScript("ops.txt", 'create task 2 "New issue"\n');
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "batch",
      "-f",
      fp,
      "--team",
      "ENG",
    ]);
    expect(runBatchOps).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("does not gate a create-free script", async () => {
    const fp = writeScript("ops.txt", "close LIN-1\n");
    const program = createProgram();
    await program.parseAsync(["node", "test", "batch", "-f", fp]);
    expect(runBatchOps).toHaveBeenCalledTimes(1);
  });

  it("emits an empty-success result for an empty script", async () => {
    const fp = writeScript("ops.txt", "# only comments\n\n");
    const program = createProgram();
    await program.parseAsync(["node", "test", "batch", "-f", fp]);
    expect(runBatchOps).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      {
        operations: 0,
        status: "ok",
        results: [],
      },
      expect.any(Function),
      expect.anything(),
    );
  });
});
