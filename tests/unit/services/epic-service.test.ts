import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  composeChildDescription,
  createEpicWithChildren,
  type EpicChildSpec,
  getEpicStatuses,
  parseChildrenJsonl,
  topologicalSortChildren,
} from "../../../src/services/epic-service.js";

const { createIssueMock, createIssueRelationMock } = vi.hoisted(() => ({
  createIssueMock: vi.fn(),
  createIssueRelationMock: vi.fn(),
}));

vi.mock("../../../src/services/issue-service.js", () => ({
  createIssue: createIssueMock,
}));

vi.mock("../../../src/services/issue-relation-service.js", () => ({
  createIssueRelation: createIssueRelationMock,
}));

function mockGqlClient(responses: Record<string, unknown>[]): GraphQLClient {
  const request = vi.fn();
  for (const r of responses) request.mockResolvedValueOnce(r);
  return { request } as unknown as GraphQLClient;
}

function issue(opts: {
  id: string;
  identifier: string;
  title?: string;
  children: Array<{ id: string; type: string }>;
  teamId?: string;
}) {
  return {
    id: opts.id,
    identifier: opts.identifier,
    title: opts.title ?? "Epic",
    priority: 2,
    state: { id: "open-state", name: "Backlog", type: "backlog" },
    team: { id: opts.teamId ?? "team-1", key: "ENG", name: "Engineering" },
    children: {
      nodes: opts.children.map((c) => ({
        id: c.id,
        identifier: `${opts.identifier}-c${c.id}`,
        state: { id: `s-${c.type}`, type: c.type },
      })),
    },
  };
}

describe("getEpicStatuses", () => {
  it("treats any open issue with children as an epic and counts closed children", async () => {
    const client = mockGqlClient([
      {
        issues: {
          nodes: [
            issue({
              id: "epic-1",
              identifier: "ENG-1",
              children: [
                { id: "c1", type: "completed" },
                { id: "c2", type: "started" },
              ],
            }),
            issue({
              id: "epic-2",
              identifier: "ENG-2",
              children: [
                { id: "c3", type: "completed" },
                { id: "c4", type: "canceled" },
              ],
            }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const result = await getEpicStatuses(client);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      total_children: 2,
      closed_children: 1,
      eligible_for_close: false,
    });
    expect(result[1]).toMatchObject({
      total_children: 2,
      closed_children: 2,
      eligible_for_close: true,
    });
  });

  it("skips issues with zero children", async () => {
    const client = mockGqlClient([
      {
        issues: {
          nodes: [
            issue({ id: "leaf", identifier: "ENG-3", children: [] }),
            issue({
              id: "epic",
              identifier: "ENG-4",
              children: [{ id: "c1", type: "started" }],
            }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const result = await getEpicStatuses(client);
    expect(result).toHaveLength(1);
    expect(result[0].epic.identifier).toBe("ENG-4");
  });

  it("filters to only eligible epics under eligibleOnly", async () => {
    const client = mockGqlClient([
      {
        issues: {
          nodes: [
            issue({
              id: "epic-1",
              identifier: "ENG-1",
              children: [{ id: "c1", type: "started" }],
            }),
            issue({
              id: "epic-2",
              identifier: "ENG-2",
              children: [{ id: "c2", type: "completed" }],
            }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const result = await getEpicStatuses(client, { eligibleOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].epic.identifier).toBe("ENG-2");
    expect(result[0].eligible_for_close).toBe(true);
  });

  it("filters by teamId when provided", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        issues: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    } as unknown as GraphQLClient;

    await getEpicStatuses(client, { teamId: "team-uuid" });

    expect(client.request).toHaveBeenCalledWith(
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

  it("paginates until hasNextPage is false", async () => {
    const client = mockGqlClient([
      {
        issues: {
          nodes: [
            issue({
              id: "e1",
              identifier: "ENG-1",
              children: [{ id: "c1", type: "completed" }],
            }),
          ],
          pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
        },
      },
      {
        issues: {
          nodes: [
            issue({
              id: "e2",
              identifier: "ENG-2",
              children: [{ id: "c2", type: "started" }],
            }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const result = await getEpicStatuses(client);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.epic.identifier)).toEqual(["ENG-1", "ENG-2"]);
    expect(
      (client.request as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });
});

// ─── lin-tij0: parseChildrenJsonl / topologicalSortChildren / create ────────

describe("parseChildrenJsonl (lin-tij0)", () => {
  it("parses simple multi-line JSONL", () => {
    const input = `
{"title": "Setup"}
{"title": "Impl", "priority": 2, "blocked_by": ["Setup"]}
`;
    const out = parseChildrenJsonl(input);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("Setup");
    expect(out[1].priority).toBe(2);
    expect(out[1].blocked_by).toEqual(["Setup"]);
  });

  it("ignores blank lines and # comments", () => {
    const input = `
# top comment
{"title": "Only"}

# another
`;
    expect(parseChildrenJsonl(input)).toHaveLength(1);
  });

  it("rejects missing title", () => {
    expect(() => parseChildrenJsonl(`{"priority": 2}`)).toThrow(
      /missing required "title"/,
    );
  });

  it("rejects malformed JSON with line number", () => {
    expect(() => parseChildrenJsonl(`{"title": "A"}\nnot-json-at-all`)).toThrow(
      /line 2: invalid JSON/,
    );
  });

  it("rejects non-string entries in blocked_by", () => {
    expect(() =>
      parseChildrenJsonl(`{"title": "A", "blocked_by": ["B", 42]}`),
    ).toThrow(/"blocked_by" must be an array of strings/);
  });

  it("rejects JSON arrays at the top level", () => {
    expect(() => parseChildrenJsonl(`["A", "B"]`)).toThrow(
      /expected a JSON object/,
    );
  });
});

describe("topologicalSortChildren (lin-tij0)", () => {
  it("orders dependents after their blockers", () => {
    const input: EpicChildSpec[] = [
      { title: "C", blocked_by: ["A", "B"] },
      { title: "A" },
      { title: "B", blocked_by: ["A"] },
    ];
    const out = topologicalSortChildren(input);
    const titles = out.map((c) => c.title);
    expect(titles.indexOf("A")).toBeLessThan(titles.indexOf("B"));
    expect(titles.indexOf("B")).toBeLessThan(titles.indexOf("C"));
  });

  it("detects cycles", () => {
    const input: EpicChildSpec[] = [
      { title: "A", blocked_by: ["B"] },
      { title: "B", blocked_by: ["A"] },
    ];
    expect(() => topologicalSortChildren(input)).toThrow(/cycle/);
  });

  it("rejects unknown blocked_by reference", () => {
    const input: EpicChildSpec[] = [{ title: "A", blocked_by: ["Ghost"] }];
    expect(() => topologicalSortChildren(input)).toThrow(
      /unknown title "Ghost"/,
    );
  });

  it("rejects duplicate titles", () => {
    const input: EpicChildSpec[] = [{ title: "Dup" }, { title: "Dup" }];
    expect(() => topologicalSortChildren(input)).toThrow(/duplicate/);
  });
});

describe("composeChildDescription (lin-tij0)", () => {
  it("returns undefined when nothing is provided", () => {
    expect(composeChildDescription({ title: "X" })).toBeUndefined();
  });

  it("composes acceptance + design + notes sections", () => {
    const out = composeChildDescription({
      title: "X",
      description: "base body",
      acceptance: "must work",
      design: "use widget",
      notes: "see docs",
    });
    expect(out).toContain("base body");
    expect(out).toContain("## Acceptance Criteria");
    expect(out).toContain("must work");
    expect(out).toContain("## Design");
    expect(out).toContain("## Notes");
  });
});

describe("createEpicWithChildren (lin-tij0)", () => {
  beforeEach(() => {
    createIssueMock.mockReset();
    createIssueRelationMock.mockReset();
  });

  it("creates epic, children with parentId, then wires Blocks relations", async () => {
    createIssueMock
      .mockResolvedValueOnce({
        id: "epic-uuid",
        identifier: "ENG-100",
        title: "Big Plan",
      })
      .mockResolvedValueOnce({
        id: "c1-uuid",
        identifier: "ENG-101",
        title: "Setup",
      })
      .mockResolvedValueOnce({
        id: "c2-uuid",
        identifier: "ENG-102",
        title: "Impl",
      });
    createIssueRelationMock.mockResolvedValue({ id: "rel-1" });

    const client = {} as unknown as GraphQLClient;
    const result = await createEpicWithChildren(client, {
      teamId: "team-a",
      title: "Big Plan",
      children: [{ title: "Impl", blocked_by: ["Setup"] }, { title: "Setup" }],
    });

    expect(result.epic.identifier).toBe("ENG-100");
    expect(result.children).toHaveLength(2);
    expect(result.dependencies).toEqual([{ from: "ENG-102", to: "ENG-101" }]);
    // Epic created with no parentId; children created with parentId=epic
    expect(createIssueMock).toHaveBeenCalledTimes(3);
    const epicCall = createIssueMock.mock.calls[0][1] as {
      parentId?: string;
    };
    expect(epicCall.parentId).toBeUndefined();
    const child1Call = createIssueMock.mock.calls[1][1] as {
      parentId: string;
      title: string;
    };
    // Topological order: Setup created before Impl.
    expect(child1Call.title).toBe("Setup");
    expect(child1Call.parentId).toBe("epic-uuid");
    const child2Call = createIssueMock.mock.calls[2][1] as {
      parentId: string;
      title: string;
    };
    expect(child2Call.title).toBe("Impl");
    expect(child2Call.parentId).toBe("epic-uuid");
    // One Blocks relation wired (Setup blocks Impl in Linear's model)
    expect(createIssueRelationMock).toHaveBeenCalledTimes(1);
    const relCall = createIssueRelationMock.mock.calls[0][1] as {
      issueId: string;
      relatedIssueId: string;
    };
    expect(relCall.issueId).toBe("c1-uuid"); // blocker
    expect(relCall.relatedIssueId).toBe("c2-uuid"); // dependent
  });

  it("creates 0 relations when no blocked_by edges", async () => {
    createIssueMock
      .mockResolvedValueOnce({
        id: "epic",
        identifier: "ENG-1",
        title: "T",
      })
      .mockResolvedValueOnce({
        id: "c1",
        identifier: "ENG-2",
        title: "A",
      });

    const client = {} as unknown as GraphQLClient;
    const result = await createEpicWithChildren(client, {
      teamId: "team-a",
      title: "T",
      children: [{ title: "A" }],
    });

    expect(result.dependencies).toEqual([]);
    expect(createIssueRelationMock).not.toHaveBeenCalled();
  });
});
