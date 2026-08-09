// Tests for findDanglingEdges (lin-wb60).
//
// Linear represents a broken IssueRelation by keeping the relation row but
// nulling the side that pointed at the deleted issue. We need to find these
// from either direction and report them with enough context to act on.

import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { findDanglingEdges } from "../../../src/services/dangling-edge-service.js";

function issue(opts: {
  id: string;
  identifier: string;
  title?: string;
  relations?: Array<{
    id: string;
    type: string;
    relatedIssue: { id: string; identifier: string } | null;
  }>;
  inverseRelations?: Array<{
    id: string;
    type: string;
    issue: { id: string; identifier: string } | null;
  }>;
}) {
  return {
    id: opts.id,
    identifier: opts.identifier,
    title: opts.title ?? `Title for ${opts.identifier}`,
    priority: 2,
    state: { id: "s-backlog", name: "Backlog", type: "backlog" },
    team: { id: "team-a", key: "ENG", name: "Eng" },
    parent: null,
    children: { nodes: [] },
    relations: { nodes: opts.relations ?? [] },
    inverseRelations: { nodes: opts.inverseRelations ?? [] },
  };
}

function mockClient(pages: Array<Array<ReturnType<typeof issue>>>): {
  client: GraphQLClient;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn();
  pages.forEach((nodes, i) => {
    request.mockResolvedValueOnce({
      issues: {
        nodes,
        pageInfo: {
          hasNextPage: i < pages.length - 1,
          endCursor: i < pages.length - 1 ? `cursor-${i}` : null,
        },
      },
    });
  });
  return { client: { request } as unknown as GraphQLClient, request };
}

describe("findDanglingEdges", () => {
  it("returns empty when every relation has a target", async () => {
    const { client } = mockClient([
      [
        issue({
          id: "a",
          identifier: "ENG-1",
          relations: [
            {
              id: "r1",
              type: "blocks",
              relatedIssue: { id: "b", identifier: "ENG-2" },
            },
          ],
        }),
      ],
    ]);
    expect(await findDanglingEdges(client)).toEqual([]);
  });

  it("flags a forward relation whose relatedIssue is null", async () => {
    const { client } = mockClient([
      [
        issue({
          id: "a",
          identifier: "ENG-1",
          title: "Source issue",
          relations: [{ id: "r-broken", type: "blocks", relatedIssue: null }],
        }),
      ],
    ]);
    const edges = await findDanglingEdges(client);
    expect(edges).toEqual([
      {
        source_id: "a",
        source_identifier: "ENG-1",
        source_title: "Source issue",
        relation_id: "r-broken",
        relation_type: "blocks",
        direction: "forward",
      },
    ]);
  });

  it("flags an inverse relation whose issue is null", async () => {
    const { client } = mockClient([
      [
        issue({
          id: "a",
          identifier: "ENG-1",
          inverseRelations: [{ id: "ir-broken", type: "related", issue: null }],
        }),
      ],
    ]);
    const edges = await findDanglingEdges(client);
    expect(edges).toHaveLength(1);
    expect(edges[0].direction).toBe("inverse");
    expect(edges[0].relation_type).toBe("related");
    expect(edges[0].relation_id).toBe("ir-broken");
  });

  it("returns every dangling edge on a single issue, both directions", async () => {
    const { client } = mockClient([
      [
        issue({
          id: "a",
          identifier: "ENG-1",
          relations: [
            { id: "rf", type: "blocks", relatedIssue: null },
            {
              id: "rk",
              type: "duplicate",
              relatedIssue: { id: "b", identifier: "ENG-2" },
            },
          ],
          inverseRelations: [{ id: "ri", type: "related", issue: null }],
        }),
      ],
    ]);
    const edges = await findDanglingEdges(client);
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.relation_id).sort()).toEqual(["rf", "ri"]);
  });

  it("paginates across multiple pages", async () => {
    const { client, request } = mockClient([
      [
        issue({
          id: "a",
          identifier: "ENG-1",
          relations: [{ id: "rA", type: "blocks", relatedIssue: null }],
        }),
      ],
      [
        issue({
          id: "b",
          identifier: "ENG-2",
          relations: [{ id: "rB", type: "blocks", relatedIssue: null }],
        }),
      ],
    ]);
    const edges = await findDanglingEdges(client);
    expect(request).toHaveBeenCalledTimes(2);
    expect(edges.map((e) => e.source_identifier)).toEqual(["ENG-1", "ENG-2"]);
  });

  it("orders rows lexicographically by source identifier then relation_id", async () => {
    const { client } = mockClient([
      [
        issue({
          id: "b",
          identifier: "ENG-2",
          relations: [{ id: "r-b", type: "blocks", relatedIssue: null }],
        }),
        issue({
          id: "a",
          identifier: "ENG-1",
          relations: [
            { id: "r-a-2", type: "blocks", relatedIssue: null },
            { id: "r-a-1", type: "related", relatedIssue: null },
          ],
        }),
      ],
    ]);
    const edges = await findDanglingEdges(client);
    expect(edges.map((e) => `${e.source_identifier}/${e.relation_id}`)).toEqual(
      ["ENG-1/r-a-1", "ENG-1/r-a-2", "ENG-2/r-b"],
    );
  });

  it("forwards teamId into the filter when provided", async () => {
    const { client, request } = mockClient([[]]);
    await findDanglingEdges(client, { teamId: "team-uuid" });
    expect(request).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filter: expect.objectContaining({
          team: { id: { eq: "team-uuid" } },
          state: {
            type: { in: ["triage", "backlog", "unstarted", "started"] },
          },
        }),
      }),
    );
  });
});
