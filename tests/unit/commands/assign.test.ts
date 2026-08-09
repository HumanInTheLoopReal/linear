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
    outputResult: vi.fn(),
    outputSuccess: vi.fn(),
  };
});

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn(async (_sdk: unknown, id: string) => `uuid-${id}`),
}));

vi.mock("../../../src/resolvers/user-resolver.js", () => ({
  resolveUserId: vi.fn(async (_sdk: unknown, user: string) => `user-${user}`),
}));

vi.mock("../../../src/services/issue-service.js", () => ({
  updateIssue: vi.fn(),
}));

import {
  formatAssign,
  setupAssignCommands,
} from "../../../src/commands/assign.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveIssueId } from "../../../src/resolvers/issue-resolver.js";
import { resolveUserId } from "../../../src/resolvers/user-resolver.js";
import { updateIssue } from "../../../src/services/issue-service.js";

function createProgram(): Command {
  const program = new Command();
  setupAssignCommands(program);
  return program;
}

describe("linear assign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("resolves issue + user and calls updateIssue with assigneeId", async () => {
    vi.mocked(updateIssue).mockResolvedValueOnce({
      id: "uuid-ENG-1",
      identifier: "ENG-1",
      title: "Test",
      assignee: { id: "user-alice", name: "Alice" },
    } as never);

    const program = createProgram();
    await program.parseAsync(["node", "test", "assign", "ENG-1", "alice"]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-1");
    expect(resolveUserId).toHaveBeenCalledWith(expect.anything(), "alice");
    expect(updateIssue).toHaveBeenCalledWith(expect.anything(), "uuid-ENG-1", {
      assigneeId: "user-alice",
    });
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "assigned",
        assignee: expect.objectContaining({ name: "Alice" }),
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("treats empty-string user as unassign (assigneeId: null)", async () => {
    vi.mocked(updateIssue).mockResolvedValueOnce({
      id: "uuid-ENG-2",
      identifier: "ENG-2",
      title: "Other",
      assignee: null,
    } as never);

    const program = createProgram();
    await program.parseAsync(["node", "test", "assign", "ENG-2", ""]);

    expect(resolveUserId).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalledWith(expect.anything(), "uuid-ENG-2", {
      assigneeId: null,
    });
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ action: "unassigned", assignee: null }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("formatAssign renders ✓ Assigned / ✓ Unassigned lines", () => {
    expect(
      formatAssign({
        issue: { id: "u", identifier: "ENG-9", title: "x" },
        assignee: { id: "u2", name: "alice" },
        action: "assigned",
      }),
    ).toBe("✓ Assigned ENG-9 to alice\n");

    expect(
      formatAssign({
        issue: { id: "u", identifier: "ENG-9", title: "x" },
        assignee: null,
        action: "unassigned",
      }),
    ).toBe("✓ Unassigned ENG-9\n");
  });
});
