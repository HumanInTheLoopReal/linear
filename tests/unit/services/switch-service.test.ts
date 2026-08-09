import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  executeSwitch,
  prepareSwitch,
} from "../../../src/services/switch-service.js";

function isQueryNamed(doc: unknown, name: string): boolean {
  const definitions =
    (doc as { definitions?: Array<{ name?: { value?: string } }> })
      .definitions ?? [];
  return definitions.some((definition) => definition.name?.value === name);
}

interface IssueShape {
  id: string;
  identifier: string;
  team: { id: string };
  state: { id: string; type: string };
}

function issue(
  id: string,
  identifier: string,
  teamId: string,
  stateType: string,
): IssueShape {
  return {
    id,
    identifier,
    team: { id: teamId },
    state: { id: `${teamId}-${stateType}`, type: stateType },
  };
}

function viewerResponse(): unknown {
  return { viewer: { id: "viewer-uuid" } };
}

function issueResponse(value: IssueShape): unknown {
  return { issue: value };
}

function searchResponse(values: IssueShape[]): unknown {
  return {
    issues: {
      nodes: values,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function updateResponse(id: string, identifier: string): unknown {
  return {
    issueUpdate: {
      success: true,
      issue: { id, identifier },
    },
  };
}

describe("prepareSwitch", () => {
  it("auto-detects the current issue and returns a mutation-free plan", async () => {
    const request = vi.fn(async (doc: unknown, vars?: unknown) => {
      if (isQueryNamed(doc, "GetViewer")) return viewerResponse();
      if (isQueryNamed(doc, "FilteredSearchIssues")) {
        return searchResponse([
          issue("old-uuid", "ENG-1", "team-a", "started"),
        ]);
      }
      if (isQueryNamed(doc, "GetIssueById")) {
        const { id } = vars as { id: string };
        return issueResponse(
          id === "old-uuid"
            ? issue("old-uuid", "ENG-1", "team-a", "started")
            : issue("new-uuid", "ENG-456", "team-b", "unstarted"),
        );
      }
      throw new Error("unexpected query");
    });
    const client = { request } as unknown as GraphQLClient;

    const plan = await prepareSwitch(client, "new-uuid");

    expect(plan).toEqual({
      viewerId: "viewer-uuid",
      newIssueId: "new-uuid",
      newTeamId: "team-b",
      oldIssueId: "old-uuid",
      oldTeamId: "team-a",
      oldOriginalStateId: "team-a-started",
      oldNeedsUnstarted: true,
      oldSource: "auto",
    });
    expect(
      request.mock.calls.some(([doc]) => isQueryNamed(doc, "UpdateIssue")),
    ).toBe(false);
  });

  it("uses an explicit old UUID without running auto-detection", async () => {
    const request = vi.fn(async (doc: unknown, vars?: unknown) => {
      if (isQueryNamed(doc, "GetViewer")) return viewerResponse();
      if (isQueryNamed(doc, "FilteredSearchIssues")) {
        throw new Error("auto-detection must not run");
      }
      if (isQueryNamed(doc, "GetIssueById")) {
        const { id } = vars as { id: string };
        return issueResponse(
          id === "old-uuid"
            ? issue("old-uuid", "ENG-1", "team-a", "started")
            : issue("new-uuid", "ENG-456", "team-b", "unstarted"),
        );
      }
      throw new Error("unexpected query");
    });
    const client = { request } as unknown as GraphQLClient;

    const plan = await prepareSwitch(client, "new-uuid", {
      fromIssueId: "old-uuid",
    });

    expect(plan.oldSource).toBe("explicit");
    expect(plan.oldIssueId).toBe("old-uuid");
  });

  it("rejects ambiguous auto-detection", async () => {
    const request = vi.fn(async (doc: unknown) => {
      if (isQueryNamed(doc, "GetViewer")) return viewerResponse();
      if (isQueryNamed(doc, "FilteredSearchIssues")) {
        return searchResponse([
          issue("old-1", "ENG-1", "team-a", "started"),
          issue("old-2", "ENG-2", "team-a", "started"),
        ]);
      }
      throw new Error("unexpected query");
    });
    const client = { request } as unknown as GraphQLClient;

    await expect(prepareSwitch(client, "new-uuid")).rejects.toThrow(/--from/);
  });

  it("plans a new-only switch when no current issue exists", async () => {
    const request = vi.fn(async (doc: unknown) => {
      if (isQueryNamed(doc, "GetViewer")) return viewerResponse();
      if (isQueryNamed(doc, "FilteredSearchIssues")) return searchResponse([]);
      if (isQueryNamed(doc, "GetIssueById")) {
        return issueResponse(
          issue("new-uuid", "ENG-456", "team-b", "unstarted"),
        );
      }
      throw new Error("unexpected query");
    });
    const client = { request } as unknown as GraphQLClient;

    const plan = await prepareSwitch(client, "new-uuid");

    expect(plan.oldSource).toBe("none");
    expect(plan.oldIssueId).toBeNull();
    expect(plan.oldNeedsUnstarted).toBe(false);
  });

  it("rejects an explicit old UUID equal to the new UUID", async () => {
    const client = {
      request: vi.fn().mockResolvedValue(viewerResponse()),
    } as unknown as GraphQLClient;

    await expect(
      prepareSwitch(client, "same-uuid", { fromIssueId: "same-uuid" }),
    ).rejects.toThrow(/same as <new>/);
  });
});

describe("executeSwitch", () => {
  it("moves the old issue and then claims and starts the new issue", async () => {
    const request = vi.fn(async (doc: unknown, vars?: unknown) => {
      if (!isQueryNamed(doc, "UpdateIssue")) {
        throw new Error("unexpected query");
      }
      const { id } = vars as { id: string };
      return updateResponse(id, id === "old-uuid" ? "ENG-1" : "ENG-456");
    });
    const client = { request } as unknown as GraphQLClient;

    const result = await executeSwitch(
      client,
      {
        viewerId: "viewer-uuid",
        newIssueId: "new-uuid",
        newTeamId: "team-b",
        oldIssueId: "old-uuid",
        oldTeamId: "team-a",
        oldOriginalStateId: "state-old-started",
        oldNeedsUnstarted: true,
        oldSource: "explicit",
      },
      {
        startedStateId: "state-started",
        unstartedStateId: "state-unstarted",
      },
    );

    expect(result.old?.identifier).toBe("ENG-1");
    expect(result.new.identifier).toBe("ENG-456");
    expect(request).toHaveBeenNthCalledWith(1, expect.anything(), {
      id: "old-uuid",
      input: { stateId: "state-unstarted" },
    });
    expect(request).toHaveBeenNthCalledWith(2, expect.anything(), {
      id: "new-uuid",
      input: { assigneeId: "viewer-uuid", stateId: "state-started" },
    });
  });

  it("does not mutate when a required pre-resolved state is missing", async () => {
    const client = {
      request: vi.fn(),
    } as unknown as GraphQLClient;

    await expect(
      executeSwitch(
        client,
        {
          viewerId: "viewer-uuid",
          newIssueId: "new-uuid",
          newTeamId: "team-b",
          oldIssueId: "old-uuid",
          oldTeamId: "team-a",
          oldOriginalStateId: "state-old-started",
          oldNeedsUnstarted: true,
          oldSource: "explicit",
        },
        { startedStateId: "state-started" },
      ),
    ).rejects.toThrow(/missing pre-resolved unstarted state/);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("leaves an old issue already outside started unchanged", async () => {
    const request = vi.fn(async (_doc: unknown, vars?: unknown) => {
      const { id } = vars as { id: string };
      return updateResponse(id, "ENG-456");
    });
    const client = { request } as unknown as GraphQLClient;

    const result = await executeSwitch(
      client,
      {
        viewerId: "viewer-uuid",
        newIssueId: "new-uuid",
        newTeamId: "team-b",
        oldIssueId: "old-uuid",
        oldTeamId: "team-a",
        oldOriginalStateId: "state-old-backlog",
        oldNeedsUnstarted: false,
        oldSource: "explicit",
      },
      {
        startedStateId: "state-started",
        unstartedStateId: "state-should-not-be-used",
      },
    );

    expect(request).toHaveBeenCalledOnce();
    expect(result.old).toBeNull();
  });

  it("restores the old issue when starting the new issue fails", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(updateResponse("old-uuid", "ENG-1"))
      .mockRejectedValueOnce(new Error("new update failed"))
      .mockResolvedValueOnce(updateResponse("old-uuid", "ENG-1"));
    const client = { request } as unknown as GraphQLClient;

    await expect(
      executeSwitch(
        client,
        {
          viewerId: "viewer-uuid",
          newIssueId: "new-uuid",
          newTeamId: "team-b",
          oldIssueId: "old-uuid",
          oldTeamId: "team-a",
          oldOriginalStateId: "state-old-started",
          oldNeedsUnstarted: true,
          oldSource: "explicit",
        },
        {
          startedStateId: "state-started",
          unstartedStateId: "state-unstarted",
        },
      ),
    ).rejects.toThrow(/restored old-uuid to its original state/);
    expect(request).toHaveBeenNthCalledWith(3, expect.anything(), {
      id: "old-uuid",
      input: { stateId: "state-old-started" },
    });
  });

  it("reports an explicit partial failure when compensation also fails", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(updateResponse("old-uuid", "ENG-1"))
      .mockRejectedValueOnce(new Error("new update failed"))
      .mockRejectedValueOnce(new Error("rollback failed"));
    const client = { request } as unknown as GraphQLClient;

    await expect(
      executeSwitch(
        client,
        {
          viewerId: "viewer-uuid",
          newIssueId: "new-uuid",
          newTeamId: "team-b",
          oldIssueId: "old-uuid",
          oldTeamId: "team-a",
          oldOriginalStateId: "state-old-started",
          oldNeedsUnstarted: true,
          oldSource: "explicit",
        },
        {
          startedStateId: "state-started",
          unstartedStateId: "state-unstarted",
        },
      ),
    ).rejects.toThrow(
      /switch partially applied.*new update failed.*rollback failed/,
    );
  });
});
