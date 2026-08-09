import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  createContext: vi.fn(() => ({ gql: { request: vi.fn() }, sdk: {} })),
  getRootOpts: vi.fn(() => ({})),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputSuccess: vi.fn(), outputResult: vi.fn() };
});

vi.mock(
  "../../../src/services/preflight-service.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../src/services/preflight-service.js")
      >();
    return {
      ...actual,
      runPreflightChecks: vi.fn().mockResolvedValue({
        checks: [],
        passed: true,
        summary: "0/0 checks passed",
      }),
    };
  },
);

import { setupPreflightCommands } from "../../../src/commands/preflight.js";
import { outputResult } from "../../../src/common/output.js";
import { runPreflightChecks } from "../../../src/services/preflight-service.js";

function createProgram(): Command {
  const program = new Command();
  setupPreflightCommands(program);
  return program;
}

describe("linear preflight", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  it("prints the checklist (no --check) and never calls the service", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "preflight"]);
    expect(runPreflightChecks).not.toHaveBeenCalled();
    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("Linear Workspace Readiness Checklist:");
    expect(out).toContain("[ ] Auth valid");
  });

  it("runs the service with default staleDays and no skips on --check", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "preflight", "--check"]);
    expect(runPreflightChecks).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runPreflightChecks).mock.calls[0]?.[0];
    expect(call?.staleDays).toBeUndefined();
    expect(call?.skip?.size ?? 0).toBe(0);
    expect(outputResult).toHaveBeenCalled();
  });

  it("translates --skip-api into skipping every API-dependent check", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "preflight",
      "--check",
      "--skip-api",
    ]);
    const call = vi.mocked(runPreflightChecks).mock.calls[0]?.[0];
    expect(call?.skip?.has("Auth valid")).toBe(true);
    expect(call?.skip?.has("No stale issues")).toBe(true);
    expect(call?.skip?.has("Triage queue clear")).toBe(true);
  });

  it("parses --skip as a comma-separated slug list", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "preflight",
      "--check",
      "--skip",
      "stale, triage",
    ]);
    const call = vi.mocked(runPreflightChecks).mock.calls[0]?.[0];
    expect(call?.skip?.has("No stale issues")).toBe(true);
    expect(call?.skip?.has("Triage queue clear")).toBe(true);
    expect(call?.skip?.has("Auth valid")).toBe(false);
  });

  it("exits non-zero when the run reports passed: false", async () => {
    vi.mocked(runPreflightChecks).mockResolvedValueOnce({
      checks: [
        {
          name: "Auth valid",
          passed: false,
          output: "401",
          command: "linear auth status",
        },
      ],
      passed: false,
      summary: "0/1 checks passed",
    });
    const program = createProgram();
    await program.parseAsync(["node", "test", "preflight", "--check"]);
    expect(process.exitCode).toBe(1);
  });

  it("rejects unknown --skip names without calling the service", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "preflight",
      "--check",
      "--skip",
      "bogus",
    ]);
    expect(runPreflightChecks).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();
  });
});
