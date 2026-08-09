import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { listBlockedIssues } from "../../../src/services/blocked-service.js";

function makeClient(responses: unknown[]): GraphQLClient {
  const request = vi.fn();
  for (const r of responses) request.mockResolvedValueOnce(r);
  return { request } as unknown as GraphQLClient;
}

function issueNode(opts: {
  id: string;
  identifier: string;
  title?: string;
  priority?: number;
  stateType?: string;
  stateName?: string;
  teamId?: string;
  blockers?: Array<{
    id: string;
    identifier: string;
    stateType: string;
    stateName?: string;
  }>;
}) {
  return {
    id: opts.id,
    identifier: opts.identifier,
    title: opts.title ?? `Issue ${opts.identifier}`,
    priority: opts.priority ?? 2,
    state: {
      id: `s-${opts.stateType ?? "backlog"}`,
      name: opts.stateName ?? opts.stateType ?? "Backlog",
      type: opts.stateType ?? "backlog",
    },
    team: { id: opts.teamId ?? "team-a", key: "ENG", name: "Eng" },
    parent: null,
    inverseRelations: {
      nodes: (opts.blockers ?? []).map((b, i) => ({
        id: `ir-${opts.id}-${i}`,
        type: "blocks",
        issue: {
          id: b.id,
          identifier: b.identifier,
          title: `Blocker ${b.identifier}`,
          state: {
            id: `s-${b.stateType}`,
            name: b.stateName ?? b.stateType,
            type: b.stateType,
          },
        },
      })),
    },
  };
}

function page(
  nodes: ReturnType<typeof issueNode>[],
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return {
    issues: { nodes, pageInfo: { hasNextPage, endCursor } },
  };
}

describe("listBlockedIssues", () => {
  it("returns only issues with at least one open blocker", async () => {
    const client = makeClient([
      page([
        // Has 1 open blocker → included
        issueNode({
          id: "i-1",
          identifier: "ENG-1",
          blockers: [
            { id: "b-1", identifier: "ENG-100", stateType: "started" },
          ],
        }),
        // Has 1 blocker but it's completed → excluded
        issueNode({
          id: "i-2",
          identifier: "ENG-2",
          blockers: [
            { id: "b-2", identifier: "ENG-101", stateType: "completed" },
          ],
        }),
        // No blockers at all → excluded
        issueNode({ id: "i-3", identifier: "ENG-3", blockers: [] }),
      ]),
    ]);
    const result = await listBlockedIssues(client);
    expect(result).toHaveLength(1);
    expect(result[0]?.identifier).toBe("ENG-1");
    expect(result[0]?.blocked_by).toEqual(["ENG-100"]);
    expect(result[0]?.blocked_by_count).toBe(1);
    // blocked_by_details carries the same blocker with title + status so
    // `blocked --explain` does not need a second fetch.
    expect(result[0]?.blocked_by_details).toEqual([
      { identifier: "ENG-100", title: "Blocker ENG-100", status: "started" },
    ]);
  });

  it("counts only OPEN blockers; canceled blockers are ignored", async () => {
    const client = makeClient([
      page([
        issueNode({
          id: "i-1",
          identifier: "ENG-1",
          blockers: [
            { id: "b-a", identifier: "ENG-A", stateType: "completed" },
            { id: "b-b", identifier: "ENG-B", stateType: "canceled" },
            { id: "b-c", identifier: "ENG-C", stateType: "backlog" },
            { id: "b-d", identifier: "ENG-D", stateType: "started" },
          ],
        }),
      ]),
    ]);
    const result = await listBlockedIssues(client);
    expect(result).toHaveLength(1);
    expect(result[0]?.blocked_by).toEqual(["ENG-C", "ENG-D"]); // sorted, only open
    expect(result[0]?.blocked_by_count).toBe(2);
  });

  it("ignores non-blocks inverse relations (related/duplicate)", async () => {
    const client = makeClient([
      page([
        {
          ...issueNode({ id: "i-1", identifier: "ENG-1" }),
          inverseRelations: {
            nodes: [
              {
                id: "ir-1",
                type: "related",
                issue: {
                  id: "b-r",
                  identifier: "ENG-R",
                  title: "Related",
                  state: {
                    id: "s",
                    name: "Backlog",
                    type: "backlog",
                  },
                },
              },
              {
                id: "ir-2",
                type: "duplicate",
                issue: {
                  id: "b-d",
                  identifier: "ENG-D",
                  title: "Dup",
                  state: {
                    id: "s",
                    name: "Backlog",
                    type: "backlog",
                  },
                },
              },
            ],
          },
        },
      ]),
    ]);
    const result = await listBlockedIssues(client);
    expect(result).toEqual([]);
  });

  it("paginates through every page", async () => {
    const client = makeClient([
      page(
        [
          issueNode({
            id: "i-1",
            identifier: "ENG-1",
            blockers: [
              { id: "b-1", identifier: "ENG-100", stateType: "started" },
            ],
          }),
        ],
        true,
        "cursor-1",
      ),
      page([
        issueNode({
          id: "i-2",
          identifier: "ENG-2",
          blockers: [
            { id: "b-2", identifier: "ENG-200", stateType: "started" },
          ],
        }),
      ]),
    ]);
    const result = await listBlockedIssues(client);
    expect(result).toHaveLength(2);
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      2,
    );
  });

  it("sorts by priority (urgent first, 0=no-priority last) with identifier tiebreak", async () => {
    const client = makeClient([
      page([
        issueNode({
          id: "i-a",
          identifier: "ENG-50",
          priority: 0, // no priority → last
          blockers: [{ id: "b", identifier: "ENG-X", stateType: "started" }],
        }),
        issueNode({
          id: "i-b",
          identifier: "ENG-3",
          priority: 3,
          blockers: [{ id: "b", identifier: "ENG-X", stateType: "started" }],
        }),
        issueNode({
          id: "i-c",
          identifier: "ENG-1",
          priority: 1, // urgent → first
          blockers: [{ id: "b", identifier: "ENG-X", stateType: "started" }],
        }),
        issueNode({
          id: "i-d",
          identifier: "ENG-2",
          priority: 1, // urgent, identifier tiebreak with c
          blockers: [{ id: "b", identifier: "ENG-X", stateType: "started" }],
        }),
      ]),
    ]);
    const result = await listBlockedIssues(client);
    expect(result.map((r) => r.identifier)).toEqual([
      "ENG-1",
      "ENG-2",
      "ENG-3",
      "ENG-50",
    ]);
  });

  it("returns [] when no issues are blocked", async () => {
    const client = makeClient([page([])]);
    const result = await listBlockedIssues(client);
    expect(result).toEqual([]);
  });

  it("forwards --parent and --team to the issue filter", async () => {
    const requestSpy = vi.fn().mockResolvedValueOnce(page([]));
    const client = { request: requestSpy } as unknown as GraphQLClient;
    await listBlockedIssues(client, {
      parentId: "epic-uuid",
      teamId: "team-uuid",
    });
    expect(requestSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filter: expect.objectContaining({
          parent: { id: { eq: "epic-uuid" } },
          team: { id: { eq: "team-uuid" } },
          state: { type: { in: expect.any(Array) } },
        }),
        first: 250,
      }),
    );
  });
});
