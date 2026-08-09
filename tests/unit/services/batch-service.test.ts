import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import type {
  BatchOp,
  ResolvedBatchOp,
} from "../../../src/common/batch-script.js";
import {
  buildDryRunResult,
  runBatchOps,
} from "../../../src/services/batch-service.js";

describe("buildDryRunResult", () => {
  it("echoes parsed ops with their source line numbers", () => {
    const ops: BatchOp[] = [
      { line: 1, raw: "close lin-1", cmd: "close", args: ["lin-1"] },
      {
        line: 2,
        raw: "update lin-2 status=closed",
        cmd: "update",
        args: ["lin-2", "status=closed"],
      },
    ];
    expect(buildDryRunResult(ops)).toEqual({
      dry_run: true,
      operations: 2,
      results: [
        { line: 1, raw: "close lin-1" },
        { line: 2, raw: "update lin-2 status=closed" },
      ],
    });
  });
});

function makeClient(gqlResponses: Record<string, unknown>): GraphQLClient {
  const request = vi.fn(async (doc: unknown) => {
    const definitions =
      (doc as { definitions?: Array<{ name?: { value?: string } }> })
        .definitions ?? [];
    for (const definition of definitions) {
      const name = definition.name?.value;
      if (name && gqlResponses[name]) {
        return gqlResponses[name];
      }
    }
    throw new Error(
      `no response configured for query '${definitions[0]?.name?.value}'`,
    );
  });
  return { request } as unknown as GraphQLClient;
}

describe("runBatchOps — close", () => {
  it("comments and closes with only pre-resolved UUIDs", async () => {
    const operations: ResolvedBatchOp[] = [
      {
        line: 1,
        raw: 'close LIN-1 "stale, closing"',
        cmd: "close",
        target: "LIN-1",
        issueId: "uuid-1",
        stateId: "state-done",
        reason: "stale, closing",
      },
    ];
    const client = makeClient({
      CreateComment: {
        commentCreate: { success: true, comment: { id: "c-1" } },
      },
      UpdateIssue: {
        issueUpdate: {
          success: true,
          issue: { id: "uuid-1", identifier: "LIN-1" },
        },
      },
    });

    const result = await runBatchOps(operations, { gql: client });
    expect(result.operations).toBe(1);
    expect(result.results).toEqual([{ line: 1, op: "close", target: "LIN-1" }]);
    expect(client.request).toHaveBeenNthCalledWith(2, expect.anything(), {
      id: "uuid-1",
      input: { stateId: "state-done" },
    });
  });
});

describe("runBatchOps — dep ops", () => {
  it("dep.add creates a relation with pre-resolved endpoints", async () => {
    const client = makeClient({
      CreateIssueRelation: {
        issueRelationCreate: {
          success: true,
          issueRelation: {
            id: "rel-1",
            type: "blocks",
            issue: { id: "uuid-1" },
            relatedIssue: { id: "uuid-2" },
          },
        },
      },
    });
    const operations: ResolvedBatchOp[] = [
      {
        line: 1,
        raw: "dep add LIN-1 LIN-2",
        cmd: "dep.add",
        target: "LIN-1->LIN-2",
        fromId: "uuid-1",
        toId: "uuid-2",
        type: "blocks",
      },
    ];

    const result = await runBatchOps(operations, { gql: client });
    expect(result.results[0]?.target).toBe("LIN-1->LIN-2");
  });

  it("dep.remove rejects an unknown relation with the line-prefixed error", async () => {
    const client = makeClient({
      GetIssueRelations: {
        issue: {
          id: "uuid-1",
          relations: { nodes: [] },
          inverseRelations: { nodes: [] },
        },
      },
    });
    const operations: ResolvedBatchOp[] = [
      {
        line: 1,
        raw: "dep remove LIN-1 LIN-2",
        cmd: "dep.remove",
        target: "LIN-1->LIN-2",
        fromId: "uuid-1",
        toId: "uuid-2",
      },
    ];

    await expect(runBatchOps(operations, { gql: client })).rejects.toThrow(
      /^line 1 \(dep remove LIN-1 LIN-2\):/,
    );
  });
});

describe("runBatchOps — create", () => {
  it("creates with the resolved team and normalized priority", async () => {
    const client = makeClient({
      CreateIssue: {
        issueCreate: {
          success: true,
          issue: { id: "u-new", identifier: "ENG-9", title: "Sample issue" },
        },
      },
    });
    const operations: ResolvedBatchOp[] = [
      {
        line: 1,
        raw: 'create task P1 "Sample issue"',
        cmd: "create",
        target: "Sample issue",
        teamId: "team-a",
        issueType: "task",
        title: "Sample issue",
        priority: 1,
        labelIds: ["type-task-label"],
      },
    ];

    const result = await runBatchOps(operations, { gql: client });

    expect(result.results[0]?.target).toBe("ENG-9");
    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      input: expect.objectContaining({
        priority: 1,
        labelIds: ["type-task-label"],
      }),
    });
  });
});
