import { describe, expect, it, vi } from "vitest";
import type { LinearSdkClient } from "../../../src/client/linear-client.js";
import {
  resolveStateIdByType,
  resolveStatusId,
} from "../../../src/resolvers/status-resolver.js";

function mockSdkClient(nodes: Array<{ id: string }>) {
  return {
    sdk: {
      workflowStates: vi.fn().mockResolvedValue({ nodes }),
    },
  } as unknown as LinearSdkClient;
}

describe("resolveStatusId", () => {
  it("returns UUID as-is", async () => {
    const client = mockSdkClient([]);
    const result = await resolveStatusId(
      client,
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(result).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("resolves status by name", async () => {
    const client = mockSdkClient([{ id: "status-uuid" }]);
    const result = await resolveStatusId(client, "In Progress");
    expect(result).toBe("status-uuid");
  });

  it("resolves status by name with team context", async () => {
    const client = mockSdkClient([{ id: "status-uuid" }]);
    await resolveStatusId(client, "In Progress", "team-uuid");
    expect(client.sdk.workflowStates).toHaveBeenCalledWith({
      filter: {
        name: { eqIgnoreCase: "In Progress" },
        team: { id: { eq: "team-uuid" } },
      },
      first: 1,
    });
  });

  it("throws when status not found", async () => {
    const client = mockSdkClient([]);
    await expect(resolveStatusId(client, "Nonexistent")).rejects.toThrow(
      'Status "Nonexistent" not found',
    );
  });

  it("error hints at issues statuses + logical aliases when team-scoped (lin-zst6)", async () => {
    const client = mockSdkClient([]);
    await expect(
      resolveStatusId(client, "Nonexistent", "team-uuid"),
    ).rejects.toThrow(/linear issues statuses --team/);
  });

  it("error hints at logical aliases when no team given (lin-zst6)", async () => {
    const client = mockSdkClient([]);
    await expect(resolveStatusId(client, "Nonexistent")).rejects.toThrow(
      /logical alias.*open, closed, in_progress, active/,
    );
  });
});

describe("resolveStateIdByType", () => {
  it("returns first state matching team + type", async () => {
    const client = mockSdkClient([{ id: "done-state-uuid" }]);
    const result = await resolveStateIdByType(client, "team-uuid", "completed");
    expect(result).toBe("done-state-uuid");
    expect(client.sdk.workflowStates).toHaveBeenCalledWith({
      filter: {
        team: { id: { eq: "team-uuid" } },
        type: { eq: "completed" },
      },
      first: 1,
    });
  });

  it("throws when no state of the requested type exists for the team", async () => {
    const client = mockSdkClient([]);
    await expect(
      resolveStateIdByType(client, "team-uuid", "completed"),
    ).rejects.toThrow(/WorkflowState.*completed/);
  });
});
