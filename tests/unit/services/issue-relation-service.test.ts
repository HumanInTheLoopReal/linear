import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/services/dependency-graph-service.js", () => ({
  wouldCreateBlockingCycle: vi.fn().mockResolvedValue(false),
}));

import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { IssueRelationType } from "../../../src/gql/graphql.js";
import { wouldCreateBlockingCycle } from "../../../src/services/dependency-graph-service.js";
import {
  type BulkRelationEdgeInput,
  bulkCreateIssueRelations,
  createIssueRelation,
  deleteIssueRelation,
  ensureDependencyTypeLabels,
  findIssueRelation,
  findNewlyUnblockedByClose,
  listIssueRelations,
} from "../../../src/services/issue-relation-service.js";

function mockGqlClient(response: Record<string, unknown>): GraphQLClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  } as unknown as GraphQLClient;
}

describe("createIssueRelation", () => {
  it("creates a relation and returns it", async () => {
    const relation = {
      id: "rel-1",
      type: IssueRelationType.Blocks,
      relatedIssue: { id: "issue-2", identifier: "ENG-2" },
    };
    const client = mockGqlClient({
      issueRelationCreate: { success: true, issueRelation: relation },
    });

    const result = await createIssueRelation(client, {
      issueId: "issue-1",
      relatedIssueId: "issue-2",
      type: IssueRelationType.Blocks,
    });

    expect(result).toEqual(relation);
    expect(client.request).toHaveBeenCalledOnce();
  });

  it("throws when creation fails", async () => {
    const client = mockGqlClient({
      issueRelationCreate: { success: false, issueRelation: null },
    });

    await expect(
      createIssueRelation(client, {
        issueId: "issue-1",
        relatedIssueId: "issue-2",
        type: IssueRelationType.Blocks,
      }),
    ).rejects.toThrow("Failed to create issue relation");
  });
});

describe("findIssueRelation", () => {
  it("finds relation in forward relations", async () => {
    const client = mockGqlClient({
      issue: {
        relations: {
          nodes: [
            {
              id: "rel-1",
              type: IssueRelationType.Blocks,
              relatedIssue: { id: "target-id", identifier: "ENG-2" },
            },
          ],
        },
        inverseRelations: { nodes: [] },
      },
    });

    const result = await findIssueRelation(client, "source-id", "target-id");
    expect(result).toBe("rel-1");
  });

  it("finds relation in inverse relations", async () => {
    const client = mockGqlClient({
      issue: {
        relations: { nodes: [] },
        inverseRelations: {
          nodes: [
            {
              id: "rel-2",
              type: IssueRelationType.Blocks,
              issue: { id: "target-id", identifier: "ENG-1" },
            },
          ],
        },
      },
    });

    const result = await findIssueRelation(client, "source-id", "target-id");
    expect(result).toBe("rel-2");
  });

  it("throws when issue is not found", async () => {
    const client = mockGqlClient({ issue: null });

    await expect(
      findIssueRelation(client, "non-existent-id", "target-id"),
    ).rejects.toThrow("not found");
  });

  it("throws when no relation found", async () => {
    const client = mockGqlClient({
      issue: {
        relations: { nodes: [] },
        inverseRelations: { nodes: [] },
      },
    });

    await expect(
      findIssueRelation(client, "source-id", "target-id"),
    ).rejects.toThrow("not found");
  });
});

describe("listIssueRelations", () => {
  // Direction semantics: down = blockers of this issue (Linear: inverseRelations);
  //                      up   = issues this one blocks (Linear: relations)
  const enrichedResponse = {
    issue: {
      id: "source-id",
      identifier: "ENG-1",
      // Forward edges = issues that source-id blocks → "up" direction
      relations: {
        nodes: [
          {
            id: "rel-up-1",
            type: "blocks",
            relatedIssue: {
              id: "target-up-1",
              identifier: "ENG-2",
              title: "Issue we block",
              priority: 2,
              state: { id: "s1", name: "Todo", type: "unstarted" },
            },
          },
          {
            id: "rel-related",
            type: "related",
            relatedIssue: {
              id: "target-related",
              identifier: "ENG-3",
              title: "Related thing",
              priority: 3,
              state: { id: "s2", name: "In Progress", type: "started" },
            },
          },
        ],
      },
      // Inverse edges = issues that block source-id → "down" direction
      inverseRelations: {
        nodes: [
          {
            id: "rel-down-1",
            type: "blocks",
            issue: {
              id: "blocker-id",
              identifier: "ENG-4",
              title: "Blocker",
              priority: 1,
              state: { id: "s3", name: "Done", type: "completed" },
            },
          },
        ],
      },
    },
  };

  it("returns blockers (inverse edges) under default direction=down", async () => {
    const client = mockGqlClient(enrichedResponse);
    const result = await listIssueRelations(client, "source-id");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      relation_id: "rel-down-1",
      type: "blocks",
      direction: "down",
      issue_id: "blocker-id",
      identifier: "ENG-4",
      status: "completed",
      state_name: "Done",
    });
  });

  it("returns dependents (forward edges) under direction=up", async () => {
    const client = mockGqlClient(enrichedResponse);
    const result = await listIssueRelations(client, "source-id", {
      direction: "up",
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      relation_id: "rel-up-1",
      direction: "up",
      identifier: "ENG-2",
    });
  });

  it("returns both directions under direction=both", async () => {
    const client = mockGqlClient(enrichedResponse);
    const result = await listIssueRelations(client, "source-id", {
      direction: "both",
    });

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.direction)).toEqual(["down", "up", "up"]);
  });

  it("filters by relation type", async () => {
    const client = mockGqlClient(enrichedResponse);
    const result = await listIssueRelations(client, "source-id", {
      direction: "both",
      type: "related",
    });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("related");
  });

  it("throws when issue is not found", async () => {
    const client = mockGqlClient({ issue: null });
    await expect(listIssueRelations(client, "missing-id")).rejects.toThrow(
      "not found",
    );
  });
});

describe("ensureDependencyTypeLabels", () => {
  it("deduplicates types and provisions their metadata labels", async () => {
    const request = vi
      .fn()
      .mockImplementation(
        (
          _document: unknown,
          variables: { filter: { name: { eqIgnoreCase: string } } },
        ) => {
          const name = variables.filter.name.eqIgnoreCase;
          return Promise.resolve({
            issueLabels: { nodes: [{ id: `id-${name}`, name }] },
          });
        },
      );
    const client = { request } as unknown as GraphQLClient;

    const result = await ensureDependencyTypeLabels(client, [
      "tracks",
      "validates",
      "tracks",
    ]);

    expect(result).toEqual(
      new Map([
        ["tracks", "id-dep-type:tracks"],
        ["validates", "id-dep-type:validates"],
      ]),
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("findNewlyUnblockedByClose", () => {
  function relationIssue(
    id: string,
    identifier: string,
    stateType: string,
    priority: number,
  ) {
    return {
      id,
      identifier,
      title: identifier,
      priority,
      state: { id: `state-${id}`, name: stateType, type: stateType },
    };
  }

  it("returns only dependents whose remaining blockers are terminal", async () => {
    const request = vi
      .fn()
      .mockImplementation(
        (_document: unknown, variables: { issueId: string }) => {
          if (variables.issueId === "closed-id") {
            return Promise.resolve({
              issue: {
                relations: {
                  nodes: [
                    {
                      id: "rel-a",
                      type: "blocks",
                      relatedIssue: relationIssue("a", "ENG-1", "unstarted", 1),
                    },
                    {
                      id: "rel-b",
                      type: "blocks",
                      relatedIssue: relationIssue("b", "ENG-2", "completed", 2),
                    },
                    {
                      id: "rel-c",
                      type: "blocks",
                      relatedIssue: relationIssue("c", "ENG-3", "started", 3),
                    },
                  ],
                },
                inverseRelations: { nodes: [] },
              },
            });
          }
          const blockerType =
            variables.issueId === "a" ? "completed" : "started";
          return Promise.resolve({
            issue: {
              relations: { nodes: [] },
              inverseRelations: {
                nodes: [
                  {
                    id: `blocker-${variables.issueId}`,
                    type: "blocks",
                    issue: relationIssue(
                      `blocker-${variables.issueId}`,
                      `BLOCKER-${variables.issueId}`,
                      blockerType,
                      1,
                    ),
                  },
                ],
              },
            },
          });
        },
      );
    const client = { request } as unknown as GraphQLClient;

    const result = await findNewlyUnblockedByClose(client, "closed-id");

    expect(result).toEqual([
      { identifier: "ENG-1", title: "ENG-1", priority: 1 },
    ]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map((call) => call[1].issueId)).toEqual([
      "closed-id",
      "a",
      "c",
    ]);
  });
});

describe("deleteIssueRelation", () => {
  it("returns id and success", async () => {
    const client = mockGqlClient({
      issueRelationDelete: { success: true, entityId: "rel-1" },
    });

    const result = await deleteIssueRelation(client, "rel-1");
    expect(result).toEqual({ id: "rel-1", success: true });
  });

  it("throws when deletion fails", async () => {
    const client = mockGqlClient({
      issueRelationDelete: { success: false },
    });

    await expect(deleteIssueRelation(client, "rel-1")).rejects.toThrow(
      "Failed to delete issue relation",
    );
  });
});

describe("bulkCreateIssueRelations", () => {
  function edge(
    line: number,
    issueId: string,
    relatedIssueId: string,
    rawType = "blocks",
    relationType: IssueRelationType = IssueRelationType.Blocks,
  ): BulkRelationEdgeInput {
    return {
      line,
      issueId,
      relatedIssueId,
      type: relationType,
      rawType,
      issueLabel: issueId,
      relatedLabel: relatedIssueId,
    };
  }

  it("issues one mutation per edge and returns successes only when all succeed", async () => {
    const successes = {
      issueRelationCreate: {
        success: true,
        issueRelation: { id: "rel-x", type: IssueRelationType.Blocks },
      },
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(successes)
      .mockResolvedValueOnce(successes);
    const client = { request } as unknown as GraphQLClient;

    const result = await bulkCreateIssueRelations(client, [
      edge(1, "a", "b"),
      edge(2, "c", "d"),
    ]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("added");
    expect(result.count).toBe(2);
    expect(result.dependencies).toEqual([
      { line: 1, issue_id: "a", depends_on_id: "b", type: "blocks" },
      { line: 2, issue_id: "c", depends_on_id: "d", type: "blocks" },
    ]);
    expect(result.errors).toEqual([]);
  });

  it("records per-edge errors and continues to the next edge", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        issueRelationCreate: {
          success: true,
          issueRelation: { id: "rel-1", type: IssueRelationType.Blocks },
        },
      })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        issueRelationCreate: {
          success: true,
          issueRelation: { id: "rel-3", type: IssueRelationType.Blocks },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    const result = await bulkCreateIssueRelations(client, [
      edge(1, "a", "b"),
      edge(5, "c", "d"),
      edge(9, "e", "f"),
    ]);

    expect(result.count).toBe(2);
    expect(result.dependencies.map((d) => d.line)).toEqual([1, 9]);
    expect(result.errors).toEqual([{ line: 5, error: "boom" }]);
  });

  it("when hackLabelId is set, appends the label to the source issue after creating the relation", async () => {
    const request = vi
      .fn()
      // 1. createIssueRelation → success
      .mockResolvedValueOnce({
        issueRelationCreate: {
          success: true,
          issueRelation: { id: "rel-1", type: IssueRelationType.Related },
        },
      })
      // 2. addLabelToIssues → getIssue(issueId)
      .mockResolvedValueOnce({
        issue: {
          id: "uuid-A",
          identifier: "ENG-A",
          title: "A",
          team: { id: "t" },
          labels: { nodes: [{ id: "existing-label" }] },
        },
      })
      // 3. addLabelToIssues → updateIssue (labels diff)
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "uuid-A", identifier: "ENG-A" },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    const result = await bulkCreateIssueRelations(client, [
      {
        line: 1,
        issueId: "uuid-A",
        relatedIssueId: "uuid-B",
        type: IssueRelationType.Related,
        rawType: "tracks",
        issueLabel: "A",
        relatedLabel: "B",
        hackLabelId: "label-uuid-tracks",
      },
    ]);

    expect(result.count).toBe(1);
    expect(result.errors).toEqual([]);
    // 1 createRelation + 1 getIssue + 1 updateIssue = 3 requests
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("merges and sorts carried (pre-mutation) errors with create errors by line", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        issueRelationCreate: {
          success: true,
          issueRelation: { id: "rel-1", type: IssueRelationType.Blocks },
        },
      })
      .mockRejectedValueOnce(new Error("create failure"));
    const client = { request } as unknown as GraphQLClient;

    const result = await bulkCreateIssueRelations(
      client,
      [edge(2, "a", "b"), edge(5, "c", "d")],
      [
        { line: 4, error: "parse failure" },
        { line: 1, error: "resolve failure" },
      ],
    );

    expect(result.count).toBe(1);
    expect(result.errors.map((e) => e.line)).toEqual([1, 4, 5]);
  });

  it("refuses a blocks edge that would create a dependency cycle (lin-gv9)", async () => {
    vi.mocked(wouldCreateBlockingCycle)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const request = vi.fn().mockResolvedValue({
      issueRelationCreate: {
        success: true,
        issueRelation: { id: "rel-ok", type: IssueRelationType.Blocks },
      },
    });
    const client = { request } as unknown as GraphQLClient;

    const result = await bulkCreateIssueRelations(client, [
      edge(1, "a", "b"),
      edge(2, "c", "d"),
    ]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(result.count).toBe(1);
    expect(result.dependencies.map((d) => d.line)).toEqual([2]);
    expect(result.errors).toEqual([
      { line: 1, error: "adding dependency would create a cycle" },
    ]);
  });

  it("skips the cycle check for non-blocks edges (related, duplicate)", async () => {
    vi.mocked(wouldCreateBlockingCycle).mockClear();
    const request = vi.fn().mockResolvedValue({
      issueRelationCreate: {
        success: true,
        issueRelation: { id: "rel-rel", type: IssueRelationType.Related },
      },
    });
    const client = { request } as unknown as GraphQLClient;

    const relatedEdge: BulkRelationEdgeInput = {
      line: 1,
      issueId: "a",
      relatedIssueId: "b",
      type: IssueRelationType.Related,
      rawType: "related",
      issueLabel: "a",
      relatedLabel: "b",
    };

    await bulkCreateIssueRelations(client, [relatedEdge]);

    expect(wouldCreateBlockingCycle).not.toHaveBeenCalled();
  });
});
