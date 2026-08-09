import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  createContext: vi.fn(() => ({ gql: {}, sdk: {} })),
  getRootOpts: vi.fn(() => ({ apiToken: "test-token" })),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputResult: vi.fn() };
});

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueTeamContext: vi.fn(),
}));

vi.mock("../../../src/resolvers/status-resolver.js", () => ({
  resolveStateIdByType: vi.fn(),
  resolveStatusId: vi.fn(),
}));

vi.mock("../../../src/services/start-service.js", () => ({
  startIssue: vi.fn(),
}));

import { setupStartCommands } from "../../../src/commands/start.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveIssueTeamContext } from "../../../src/resolvers/issue-resolver.js";
import {
  resolveStateIdByType,
  resolveStatusId,
} from "../../../src/resolvers/status-resolver.js";
import { startIssue } from "../../../src/services/start-service.js";

function createProgram(): Command {
  const program = new Command();
  setupStartCommands(program);
  return program;
}

describe("start command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveIssueTeamContext).mockResolvedValue({
      issueId: "issue-uuid",
      teamId: "team-uuid",
    });
    vi.mocked(startIssue).mockResolvedValue({
      issue: {
        id: "issue-uuid",
        identifier: "ENG-1",
        title: "Task",
        state: { id: "state-started", name: "In Progress", type: "started" },
      },
    } as never);
  });

  it("resolves the default started state before calling the service", async () => {
    vi.mocked(resolveStateIdByType).mockResolvedValue("state-started");

    await createProgram().parseAsync(["node", "test", "start", "ENG-1"]);

    expect(resolveIssueTeamContext).toHaveBeenCalledWith(
      expect.anything(),
      "ENG-1",
    );
    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-uuid",
      "started",
    );
    expect(startIssue).toHaveBeenCalledWith(expect.anything(), {
      issueId: "issue-uuid",
      stateId: "state-started",
    });
    expect(outputResult).toHaveBeenCalled();
  });

  it("resolves an explicit status name instead of the default type", async () => {
    vi.mocked(resolveStatusId).mockResolvedValue("state-review");

    await createProgram().parseAsync([
      "node",
      "test",
      "start",
      "ENG-1",
      "--status",
      "Review",
    ]);

    expect(resolveStatusId).toHaveBeenCalledWith(
      expect.anything(),
      "Review",
      "team-uuid",
    );
    expect(resolveStateIdByType).not.toHaveBeenCalled();
    expect(startIssue).toHaveBeenCalledWith(expect.anything(), {
      issueId: "issue-uuid",
      stateId: "state-review",
    });
  });
});
