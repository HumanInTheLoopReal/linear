import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { listStatuses } from "../../../src/services/status-service.js";

function mockResponse(
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    color?: string;
    description?: string | null;
    position?: number;
    team?: { id: string; key: string; name: string };
  }>,
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return {
    workflowStates: {
      nodes: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        color: n.color ?? "#000000",
        description: n.description ?? null,
        position: n.position ?? 0,
        team: n.team ?? { id: "team-1", key: "ENG", name: "Engineering" },
      })),
      pageInfo: { hasNextPage, endCursor },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listStatuses", () => {
  it("queries workflowStates with no filter when teamId is omitted", async () => {
    const request = vi.fn().mockResolvedValueOnce(mockResponse([]));
    const client = { request } as unknown as GraphQLClient;

    await listStatuses(client);

    expect(request.mock.calls[0][1]).toEqual(
      expect.objectContaining({ filter: undefined }),
    );
  });

  it("filters by team when teamId is provided", async () => {
    const request = vi.fn().mockResolvedValueOnce(mockResponse([]));
    const client = { request } as unknown as GraphQLClient;

    await listStatuses(client, { teamId: "team-uuid" });

    expect(request.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        filter: { team: { id: { eq: "team-uuid" } } },
      }),
    );
  });

  it("maps Linear state types to canonical categories", async () => {
    const request = vi.fn().mockResolvedValueOnce(
      mockResponse([
        { id: "s1", name: "Triage", type: "triage" },
        { id: "s2", name: "Backlog", type: "backlog" },
        { id: "s3", name: "Todo", type: "unstarted" },
        { id: "s4", name: "In Progress", type: "started" },
        { id: "s5", name: "Done", type: "completed" },
        { id: "s6", name: "Canceled", type: "canceled" },
        { id: "s7", name: "Duplicate", type: "duplicate" },
      ]),
    );
    const client = { request } as unknown as GraphQLClient;

    const result = await listStatuses(client);

    expect(
      result.statuses.map((s) => ({
        type: s.type,
        category: s.category,
      })),
    ).toEqual([
      { type: "triage", category: "active" },
      { type: "backlog", category: "active" },
      { type: "unstarted", category: "active" },
      { type: "started", category: "wip" },
      { type: "completed", category: "done" },
      { type: "canceled", category: "done" },
      { type: "duplicate", category: "done" },
    ]);
  });

  it("sorts by team key then position", async () => {
    const request = vi.fn().mockResolvedValueOnce(
      mockResponse([
        {
          id: "s1",
          name: "Done",
          type: "completed",
          position: 3,
          team: { id: "t1", key: "ENG", name: "Engineering" },
        },
        {
          id: "s2",
          name: "Todo",
          type: "unstarted",
          position: 1,
          team: { id: "t2", key: "BIZ", name: "Business" },
        },
        {
          id: "s3",
          name: "Todo",
          type: "unstarted",
          position: 1,
          team: { id: "t1", key: "ENG", name: "Engineering" },
        },
      ]),
    );
    const client = { request } as unknown as GraphQLClient;

    const result = await listStatuses(client);
    expect(
      result.statuses.map((s) => ({
        team: s.team.key,
        position: s.position,
      })),
    ).toEqual([
      { team: "BIZ", position: 1 },
      { team: "ENG", position: 1 },
      { team: "ENG", position: 3 },
    ]);
  });

  it("paginates through hasNextPage", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(
          [{ id: "s1", name: "Todo", type: "unstarted" }],
          true,
          "cursor-1",
        ),
      )
      .mockResolvedValueOnce(
        mockResponse([{ id: "s2", name: "Done", type: "completed" }]),
      );
    const client = { request } as unknown as GraphQLClient;

    const result = await listStatuses(client);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1]).toEqual(
      expect.objectContaining({ after: "cursor-1" }),
    );
    expect(result.statuses).toHaveLength(2);
  });

  it("falls back to 'active' for unknown state types", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse([{ id: "s1", name: "Weird", type: "something-new" }]),
      );
    const client = { request } as unknown as GraphQLClient;

    const result = await listStatuses(client);
    expect(result.statuses[0].category).toBe("active");
  });
});
