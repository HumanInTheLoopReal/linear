import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  createContext: vi.fn(() => ({
    gql: { request: vi.fn() },
    sdk: { sdk: {} },
  })),
  getRootOpts: vi.fn(() => ({})),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputResult: vi.fn() };
});

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn(
    async (_sdk: unknown, value: string) => `uuid-${value}`,
  ),
}));

vi.mock("../../../src/resolvers/status-resolver.js", () => ({
  resolveStateIdByType: vi.fn(
    async (_sdk: unknown, teamId: string, type: string) => `${teamId}-${type}`,
  ),
}));

vi.mock("../../../src/services/switch-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/services/switch-service.js")
    >();
  return {
    ...actual,
    prepareSwitch: vi.fn().mockResolvedValue({
      viewerId: "viewer-uuid",
      newIssueId: "uuid-ENG-2",
      newTeamId: "team-new",
      oldIssueId: "uuid-ENG-1",
      oldTeamId: "team-old",
      oldOriginalStateId: "team-old-started-current",
      oldNeedsUnstarted: true,
      oldSource: "explicit",
    }),
    executeSwitch: vi.fn().mockResolvedValue({
      new: { id: "uuid-ENG-2", identifier: "ENG-2" },
      old: { id: "uuid-ENG-1", identifier: "ENG-1" },
      oldSource: "explicit",
    }),
  };
});

import { setupSwitchCommands } from "../../../src/commands/switch.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveIssueId } from "../../../src/resolvers/issue-resolver.js";
import { resolveStateIdByType } from "../../../src/resolvers/status-resolver.js";
import {
  executeSwitch,
  prepareSwitch,
} from "../../../src/services/switch-service.js";

function createProgram(): Command {
  const program = new Command();
  setupSwitchCommands(program);
  return program;
}

describe("linear switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("resolves identifiers and team states before executing the switch", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "switch",
      "ENG-2",
      "--from",
      "ENG-1",
    ]);

    expect(resolveIssueId).toHaveBeenCalledTimes(2);
    expect(prepareSwitch).toHaveBeenCalledWith(
      expect.anything(),
      "uuid-ENG-2",
      { fromIssueId: "uuid-ENG-1" },
    );
    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-new",
      "started",
    );
    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-old",
      "unstarted",
    );
    expect(executeSwitch).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Object),
      {
        startedStateId: "team-new-started",
        unstartedStateId: "team-old-unstarted",
      },
    );
    expect(outputResult).toHaveBeenCalled();
  });

  it("does not mutate when the new team's started state lookup fails", async () => {
    vi.mocked(resolveStateIdByType).mockImplementationOnce(async () => {
      throw new Error("team has no started state");
    });
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "switch",
      "ENG-2",
      "--from",
      "ENG-1",
    ]);

    expect(executeSwitch).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
