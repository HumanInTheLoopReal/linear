import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { startIssue } from "../../../src/services/start-service.js";

function mockGqlClient(
  responses: Array<Record<string, unknown>>,
): GraphQLClient {
  const request = vi.fn();
  for (const response of responses) {
    request.mockResolvedValueOnce(response);
  }
  return { request } as unknown as GraphQLClient;
}

describe("startIssue", () => {
  it("assigns the viewer and applies the pre-resolved state", async () => {
    const client = mockGqlClient([
      { viewer: { id: "viewer-uuid" } },
      {
        issueUpdate: {
          success: true,
          issue: { id: "issue-uuid", identifier: "ENG-1" },
        },
      },
    ]);

    const result = await startIssue(client, {
      issueId: "issue-uuid",
      stateId: "state-started",
    });

    expect(result.issue.identifier).toBe("ENG-1");
    expect(client.request).toHaveBeenNthCalledWith(2, expect.anything(), {
      id: "issue-uuid",
      input: { assigneeId: "viewer-uuid", stateId: "state-started" },
    });
  });

  it("propagates viewer lookup failures before attempting the update", async () => {
    const client = {
      request: vi.fn().mockRejectedValue(new Error("viewer unavailable")),
    } as unknown as GraphQLClient;

    await expect(
      startIssue(client, {
        issueId: "issue-uuid",
        stateId: "state-started",
      }),
    ).rejects.toThrow("viewer unavailable");

    expect(client.request).toHaveBeenCalledTimes(1);
  });
});
