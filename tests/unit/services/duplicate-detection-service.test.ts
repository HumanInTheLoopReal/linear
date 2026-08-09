import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import type { DuplicateDetectionFieldsFragment } from "../../../src/gql/graphql.js";
import { IssueRelationType } from "../../../src/gql/graphql.js";
import {
  fetchOpenIssuesForMerge,
  findDuplicateGroups,
  findMarkedDuplicates,
  mergeDuplicateGroup,
} from "../../../src/services/duplicate-detection-service.js";

vi.mock("../../../src/services/issue-relation-service.js", () => ({
  createIssueRelation: vi.fn().mockResolvedValue({
    id: "rel-uuid",
    type: IssueRelationType.Duplicate,
    relatedIssue: { id: "target", identifier: "ENG-1" },
  }),
}));

vi.mock("../../../src/services/issue-service.js", () => ({
  updateIssue: vi.fn().mockResolvedValue({ id: "issue-id" }),
}));

function issueNode(opts: {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  teamId?: string;
  relations?: number;
  inverseRelations?: number;
  children?: Array<{ id: string; identifier: string }>;
}) {
  return {
    id: opts.id,
    identifier: opts.identifier,
    title: opts.title,
    description: opts.description ?? null,
    priority: 2,
    state: { id: "s1", name: "Backlog", type: "backlog" },
    team: { id: opts.teamId ?? "team-a", key: "ENG", name: "Eng" },
    parent: null,
    children: { nodes: opts.children ?? [] },
    relations: {
      nodes: Array.from({ length: opts.relations ?? 0 }, (_, i) => ({
        id: `r-${opts.id}-${i}`,
      })),
    },
    inverseRelations: {
      nodes: Array.from({ length: opts.inverseRelations ?? 0 }, (_, i) => ({
        id: `ir-${opts.id}-${i}`,
      })),
    },
  };
}

function mockGqlClient(pages: Record<string, unknown>[]): GraphQLClient {
  const request = vi.fn();
  for (const p of pages) request.mockResolvedValueOnce(p);
  return { request } as unknown as GraphQLClient;
}

describe("findDuplicateGroups", () => {
  it("groups issues whose normalized title+description match", async () => {
    const client = mockGqlClient([
      {
        issues: {
          nodes: [
            issueNode({
              id: "u1",
              identifier: "ENG-1",
              title: "Refactor auth",
              description: "Move to JWT",
            }),
            issueNode({
              id: "u2",
              identifier: "ENG-2",
              title: "refactor AUTH",
              description: "Move to JWT",
            }),
            issueNode({
              id: "u3",
              identifier: "ENG-3",
              title: "Unrelated",
              description: "Other",
            }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const groups = await findDuplicateGroups(client);
    expect(groups).toHaveLength(1);
    expect(groups[0].issues.map((i) => i.identifier)).toEqual(
      expect.arrayContaining(["ENG-1", "ENG-2"]),
    );
  });

  it("picks the highest-weight issue as the merge target", async () => {
    const client = mockGqlClient([
      {
        issues: {
          nodes: [
            issueNode({
              id: "low",
              identifier: "ENG-7",
              title: "Same",
              relations: 0,
              inverseRelations: 0,
            }),
            issueNode({
              id: "high",
              identifier: "ENG-9",
              title: "Same",
              relations: 5,
              inverseRelations: 1,
            }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const groups = await findDuplicateGroups(client);
    expect(groups).toHaveLength(1);
    expect(groups[0].suggested_target).toBe("ENG-9");
    expect(groups[0].suggested_sources).toEqual(["ENG-7"]);
  });

  it("ties break by lexicographically smallest identifier", async () => {
    const client = mockGqlClient([
      {
        issues: {
          nodes: [
            issueNode({ id: "b", identifier: "ENG-5", title: "Same" }),
            issueNode({ id: "a", identifier: "ENG-2", title: "Same" }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const groups = await findDuplicateGroups(client);
    expect(groups[0].suggested_target).toBe("ENG-2");
  });

  it("emits suggested_action with linear issues mark-duplicate", async () => {
    const client = mockGqlClient([
      {
        issues: {
          nodes: [
            issueNode({ id: "t", identifier: "ENG-1", title: "X" }),
            issueNode({ id: "s", identifier: "ENG-2", title: "X" }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const groups = await findDuplicateGroups(client);
    expect(groups[0].suggested_action).toContain(
      "linear issues mark-duplicate ENG-2 --of ENG-1",
    );
  });

  it("returns empty array when no duplicates exist", async () => {
    const client = mockGqlClient([
      {
        issues: {
          nodes: [
            issueNode({ id: "a", identifier: "ENG-1", title: "One" }),
            issueNode({ id: "b", identifier: "ENG-2", title: "Two" }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const groups = await findDuplicateGroups(client);
    expect(groups).toEqual([]);
  });

  it("paginates and aggregates across multiple pages", async () => {
    const client = mockGqlClient([
      {
        issues: {
          nodes: [issueNode({ id: "p1", identifier: "ENG-1", title: "Dup" })],
          pageInfo: { hasNextPage: true, endCursor: "c1" },
        },
      },
      {
        issues: {
          nodes: [issueNode({ id: "p2", identifier: "ENG-2", title: "Dup" })],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const groups = await findDuplicateGroups(client);
    expect(groups).toHaveLength(1);
    expect(
      (client.request as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });
});

describe("fetchOpenIssuesForMerge", () => {
  it("returns a Map keyed by identifier", async () => {
    const client = mockGqlClient([
      {
        issues: {
          nodes: [
            issueNode({ id: "u1", identifier: "ENG-1", title: "A" }),
            issueNode({ id: "u2", identifier: "ENG-2", title: "B" }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const map = await fetchOpenIssuesForMerge(client);
    expect(map.size).toBe(2);
    expect(map.get("ENG-1")?.id).toBe("u1");
    expect(map.get("ENG-2")?.id).toBe("u2");
  });
});

describe("mergeDuplicateGroup", () => {
  it("re-parents children, links a Duplicate relation, and closes source with canceled state", async () => {
    const { createIssueRelation } = await import(
      "../../../src/services/issue-relation-service.js"
    );
    const { updateIssue } = await import(
      "../../../src/services/issue-service.js"
    );
    vi.mocked(createIssueRelation).mockClear();
    vi.mocked(updateIssue).mockClear();

    const target = issueNode({
      id: "target-uuid",
      identifier: "ENG-1",
      title: "Same",
    });
    const source = issueNode({
      id: "source-uuid",
      identifier: "ENG-2",
      title: "Same",
      children: [{ id: "child-uuid", identifier: "ENG-3" }],
    });
    const fullIssues = new Map([
      [target.identifier, target],
      [source.identifier, source],
    ]);
    const canceledStateIdByTeam = new Map([[source.team.id, "canceled-uuid"]]);

    const client = { request: vi.fn() } as unknown as GraphQLClient;

    const result = await mergeDuplicateGroup(
      client,
      {
        title: "Same",
        issues: [],
        suggested_target: "ENG-1",
        suggested_sources: ["ENG-2"],
        suggested_action: "",
        note: "",
      },
      fullIssues,
      canceledStateIdByTeam,
    );

    expect(result.target).toBe("ENG-1");
    expect(result.reparented).toEqual(["ENG-3"]);
    expect(result.linked).toEqual(["ENG-2"]);
    expect(result.closed).toEqual(["ENG-2"]);
    expect(result.errors).toEqual([]);

    expect(updateIssue).toHaveBeenCalledWith(client, "child-uuid", {
      parentId: "target-uuid",
    });
    expect(createIssueRelation).toHaveBeenCalledWith(client, {
      issueId: "source-uuid",
      relatedIssueId: "target-uuid",
      type: IssueRelationType.Duplicate,
    });
    expect(updateIssue).toHaveBeenCalledWith(client, "source-uuid", {
      stateId: "canceled-uuid",
    });
  });

  it("records an error and skips close when no canceled state ID is provided for source's team", async () => {
    const target = issueNode({ id: "t", identifier: "ENG-1", title: "X" });
    const source = issueNode({
      id: "s",
      identifier: "ENG-2",
      title: "X",
      teamId: "unknown-team",
    });
    const fullIssues = new Map([
      [target.identifier, target],
      [source.identifier, source],
    ]);
    const client = { request: vi.fn() } as unknown as GraphQLClient;

    const result = await mergeDuplicateGroup(
      client,
      {
        title: "X",
        issues: [],
        suggested_target: "ENG-1",
        suggested_sources: ["ENG-2"],
        suggested_action: "",
        note: "",
      },
      fullIssues,
      new Map(),
    );

    expect(result.linked).toEqual(["ENG-2"]);
    expect(result.closed).toEqual([]);
    expect(result.errors[0]).toContain("No canceled-state ID provided");
  });

  it("flags missing target without making mutations", async () => {
    const client = { request: vi.fn() } as unknown as GraphQLClient;
    const result = await mergeDuplicateGroup(
      client,
      {
        title: "X",
        issues: [],
        suggested_target: "ENG-MISSING",
        suggested_sources: ["ENG-1"],
        suggested_action: "",
        note: "",
      },
      new Map(),
      new Map(),
    );
    expect(result.errors[0]).toContain("Target ENG-MISSING not found");
  });
});

describe("findMarkedDuplicates (lin-w3w7)", () => {
  function markedIssue(
    id: string,
    identifier: string,
    title: string,
    opts: {
      forwardDups?: Array<{ id: string; identifier: string; title: string }>;
      inverseDups?: Array<{ id: string; identifier: string; title: string }>;
      otherForwardType?: string;
    } = {},
  ): DuplicateDetectionFieldsFragment {
    return {
      id,
      identifier,
      title,
      description: null,
      priority: 2,
      state: { id: "s1", name: "Backlog", type: "backlog" },
      team: { id: "team-a", key: "ENG", name: "Eng" },
      parent: null,
      children: { nodes: [] },
      relations: {
        nodes: [
          ...(opts.forwardDups ?? []).map((d, i) => ({
            id: `fd-${id}-${i}`,
            type: "duplicate",
            relatedIssue: d,
          })),
          ...(opts.otherForwardType
            ? [
                {
                  id: `o-${id}`,
                  type: opts.otherForwardType,
                  relatedIssue: { id: "x", identifier: "X-1", title: "X" },
                },
              ]
            : []),
        ],
      },
      inverseRelations: {
        nodes: (opts.inverseDups ?? []).map((d, i) => ({
          id: `id-${id}-${i}`,
          type: "duplicate",
          issue: d,
        })),
      },
    } as DuplicateDetectionFieldsFragment;
  }

  it("emits one pair per Linear-marked Duplicate relation", () => {
    const issues = [
      markedIssue("u1", "ENG-1", "Login bug", {
        forwardDups: [{ id: "u2", identifier: "ENG-2", title: "Login crash" }],
      }),
      markedIssue("u2", "ENG-2", "Login crash"),
    ];
    const pairs = findMarkedDuplicates(issues);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      issue_a_id: "ENG-1",
      issue_b_id: "ENG-2",
      method: "marked",
    });
  });

  it("does not emit pairs for other relation types (blocks, related, similar)", () => {
    const issues = [
      markedIssue("u1", "ENG-1", "A", { otherForwardType: "blocks" }),
      markedIssue("u2", "ENG-2", "B", { otherForwardType: "related" }),
      markedIssue("u3", "ENG-3", "C", { otherForwardType: "similar" }),
    ];
    expect(findMarkedDuplicates(issues)).toEqual([]);
  });

  it("deduplicates pairs surfaced from both ends (forward + inverse)", () => {
    // The same Duplicate edge between ENG-1 and ENG-2 appears as a forward
    // relation on ENG-1 AND as an inverse relation on ENG-2 — must emit
    // only one pair.
    const issues = [
      markedIssue("u1", "ENG-1", "Login bug", {
        forwardDups: [{ id: "u2", identifier: "ENG-2", title: "Login crash" }],
      }),
      markedIssue("u2", "ENG-2", "Login crash", {
        inverseDups: [{ id: "u1", identifier: "ENG-1", title: "Login bug" }],
      }),
    ];
    expect(findMarkedDuplicates(issues)).toHaveLength(1);
  });

  it("orders pairs canonically by sorted identifier so output is stable", () => {
    const issues = [
      markedIssue("u3", "ENG-3", "C", {
        forwardDups: [{ id: "u1", identifier: "ENG-1", title: "A" }],
      }),
      markedIssue("u4", "ENG-4", "D", {
        forwardDups: [{ id: "u2", identifier: "ENG-2", title: "B" }],
      }),
    ];
    const pairs = findMarkedDuplicates(issues);
    expect(pairs.map((p) => `${p.issue_a_id}::${p.issue_b_id}`)).toEqual([
      "ENG-1::ENG-3",
      "ENG-2::ENG-4",
    ]);
  });

  it("returns empty when no Duplicate relations exist", () => {
    expect(findMarkedDuplicates([])).toEqual([]);
    expect(findMarkedDuplicates([markedIssue("u1", "ENG-1", "Solo")])).toEqual(
      [],
    );
  });

  it("recovers titles for pairs surfaced only via inverseRelations (other end not in input)", () => {
    // ENG-2 isn't in the fetched set; ENG-1's inverseRelations carries the
    // marker. We still emit the pair with whatever title the relation node
    // gave us.
    const issues = [
      markedIssue("u1", "ENG-1", "Login bug", {
        inverseDups: [
          { id: "u2", identifier: "ENG-2", title: "Login crash variant" },
        ],
      }),
    ];
    const pairs = findMarkedDuplicates(issues);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].issue_a_id).toBe("ENG-1");
    expect(pairs[0].issue_b_id).toBe("ENG-2");
    expect(pairs[0].issue_b_title).toBe("Login crash variant");
  });

  it("accepts a single-pass iterator (Map.values()) without losing pairs", () => {
    // Regression: the live call site passes `Map.values()`, which is a
    // one-shot iterator. Earlier versions consumed it building the title
    // lookup, then found no relations on the second pass. (lin-w3w7)
    const map = new Map([
      [
        "TES-1",
        markedIssue("a", "TES-1", "A", {
          forwardDups: [{ id: "b", identifier: "TES-2", title: "B" }],
        }),
      ],
      ["TES-2", markedIssue("b", "TES-2", "B")],
    ]);
    const pairs = findMarkedDuplicates(map.values());
    expect(pairs).toHaveLength(1);
    expect(pairs[0].issue_a_id).toBe("TES-1");
    expect(pairs[0].issue_b_id).toBe("TES-2");
  });
});
