import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  createContext: vi.fn(() => ({
    gql: { request: vi.fn() },
    sdk: { sdk: {} },
  })),
  getRootOpts: vi.fn(() => ({ apiToken: "test-token" })),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return {
    ...actual,
    outputSuccess: vi.fn(),
    outputResult: vi.fn(),
  };
});

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi
    .fn()
    .mockImplementation(async (_sdk, id: string) => `uuid-${id}`),
}));

vi.mock("../../../src/services/deferred-service.js", () => ({
  wakeIssue: vi.fn(),
}));

import { setupWakeCommands } from "../../../src/commands/wake.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveIssueId } from "../../../src/resolvers/issue-resolver.js";
import { wakeIssue } from "../../../src/services/deferred-service.js";

function createProgram(): Command {
  const program = new Command();
  program.option("--api-token <token>");
  setupWakeCommands(program);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

describe("wake", () => {
  it("includes 'woke' outcomes in JSON and skips 'skipped' ones (warning to stderr)", async () => {
    vi.mocked(wakeIssue)
      .mockResolvedValueOnce({
        status: "woke",
        issue: { id: "uuid-ENG-1", identifier: "ENG-1" } as never,
      })
      .mockResolvedValueOnce({
        status: "skipped",
        issue_id: "uuid-ENG-2",
        issue_identifier: "ENG-2",
      });

    const program = createProgram();
    await program.parseAsync(["node", "test", "wake", "ENG-1", "ENG-2"]);

    expect(resolveIssueId).toHaveBeenCalledTimes(2);
    expect(wakeIssue).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("ENG-2 is not deferred"),
    );
    expect(outputResult).toHaveBeenCalledWith(
      [{ id: "uuid-ENG-1", identifier: "ENG-1" }],
      expect.any(Function),
      expect.anything(),
    );
  });

  it("emits [] when all targeted issues are already awake", async () => {
    vi.mocked(wakeIssue).mockResolvedValueOnce({
      status: "skipped",
      issue_id: "uuid-ENG-1",
      issue_identifier: "ENG-1",
    });

    const program = createProgram();
    await program.parseAsync(["node", "test", "wake", "ENG-1"]);

    expect(outputResult).toHaveBeenCalledWith(
      [],
      expect.any(Function),
      expect.anything(),
    );
    expect(console.error).toHaveBeenCalledOnce();
  });
});
