import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../../../src/common/context.js";
import { notFoundError } from "../../../src/common/errors.js";

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn(),
}));

vi.mock("../../../src/resolvers/status-resolver.js", () => ({
  resolveStateIdByType: vi.fn(),
}));

vi.mock("../../../src/services/issue-service.js", () => ({
  getIssue: vi.fn(),
  updateIssue: vi.fn(),
}));

import { closeIssueFromHook } from "../../../src/commands/hooks.js";
import { resolveIssueId } from "../../../src/resolvers/issue-resolver.js";
import { resolveStateIdByType } from "../../../src/resolvers/status-resolver.js";
import { getIssue, updateIssue } from "../../../src/services/issue-service.js";

const context = { gql: {}, sdk: {} } as unknown as CommandContext;

describe("closeIssueFromHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves and closes an open issue", async () => {
    vi.mocked(resolveIssueId).mockResolvedValue("issue-uuid");
    vi.mocked(getIssue).mockResolvedValue({
      id: "issue-uuid",
      identifier: "ENG-1",
      state: { id: "open", name: "Todo", type: "unstarted" },
      team: { id: "team-uuid", key: "ENG", name: "Engineering" },
    } as Awaited<ReturnType<typeof getIssue>>);
    vi.mocked(resolveStateIdByType).mockResolvedValue("completed-state");
    vi.mocked(updateIssue).mockResolvedValue({
      id: "issue-uuid",
      identifier: "ENG-1",
    });

    await expect(closeIssueFromHook(context, "ENG-1")).resolves.toBe("closed");
    expect(resolveStateIdByType).toHaveBeenCalledWith(
      context.sdk,
      "team-uuid",
      "completed",
    );
    expect(updateIssue).toHaveBeenCalledWith(context.gql, "issue-uuid", {
      stateId: "completed-state",
    });
  });

  it("returns not-found when identifier resolution fails", async () => {
    vi.mocked(resolveIssueId).mockRejectedValue(
      notFoundError("Issue", "ENG-404"),
    );

    await expect(closeIssueFromHook(context, "ENG-404")).resolves.toBe(
      "not-found",
    );
    expect(getIssue).not.toHaveBeenCalled();
  });

  it("propagates transient identifier-resolution failures", async () => {
    vi.mocked(resolveIssueId).mockRejectedValue(
      new Error("network unavailable"),
    );

    await expect(closeIssueFromHook(context, "ENG-1")).rejects.toThrow(
      "network unavailable",
    );
    expect(getIssue).not.toHaveBeenCalled();
  });

  it("does not update an issue already in a terminal state", async () => {
    vi.mocked(resolveIssueId).mockResolvedValue("issue-uuid");
    vi.mocked(getIssue).mockResolvedValue({
      id: "issue-uuid",
      identifier: "ENG-1",
      state: { id: "done", name: "Done", type: "completed" },
      team: { id: "team-uuid", key: "ENG", name: "Engineering" },
    } as Awaited<ReturnType<typeof getIssue>>);

    await expect(closeIssueFromHook(context, "ENG-1")).resolves.toBe(
      "already-closed",
    );
    expect(resolveStateIdByType).not.toHaveBeenCalled();
    expect(updateIssue).not.toHaveBeenCalled();
  });
});
