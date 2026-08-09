import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  findUnscopedCandidates,
  tagWithScope,
} from "../../../src/services/adopt-service.js";

vi.mock("../../../src/services/issue-service.js", () => ({
  updateIssue: vi.fn().mockResolvedValue({ id: "x", identifier: "ENG-1" }),
}));

import { updateIssue } from "../../../src/services/issue-service.js";

function makeClient(pages: unknown[]): GraphQLClient {
  const fn = vi.fn();
  for (const page of pages) {
    fn.mockResolvedValueOnce(page);
  }
  return { request: fn } as unknown as GraphQLClient;
}

describe("findUnscopedCandidates", () => {
  it("ANDs open-state + label-every-neq into the GraphQL filter", async () => {
    const client = makeClient([
      {
        issues: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    await findUnscopedCandidates(client, { scopeLabel: "git:foo" });

    const requestFn = client.request as ReturnType<typeof vi.fn>;
    const variables = requestFn.mock.calls[0][1] as {
      filter: { and: unknown[] };
    };
    expect(variables.filter.and).toContainEqual({
      state: { type: { in: ["triage", "backlog", "unstarted", "started"] } },
    });
    expect(variables.filter.and).toContainEqual({
      labels: { every: { name: { neq: "git:foo" } } },
    });
  });

  it("includes team and project filters when supplied", async () => {
    const client = makeClient([
      {
        issues: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    await findUnscopedCandidates(client, {
      scopeLabel: "git:foo",
      teamId: "t-1",
      projectId: "p-1",
    });

    const requestFn = client.request as ReturnType<typeof vi.fn>;
    const variables = requestFn.mock.calls[0][1] as {
      filter: { and: unknown[] };
    };
    expect(variables.filter.and).toContainEqual({
      team: { id: { eq: "t-1" } },
    });
    expect(variables.filter.and).toContainEqual({
      project: { id: { eq: "p-1" } },
    });
  });

  it("flattens paginated results and stops at limit", async () => {
    const issueA = {
      id: "a",
      identifier: "ENG-1",
      title: "first",
      labels: { nodes: [{ id: "l-a", name: "old" }] },
    };
    const issueB = {
      id: "b",
      identifier: "ENG-2",
      title: "second",
      labels: { nodes: [] },
    };
    const client = makeClient([
      {
        issues: {
          nodes: [issueA, issueB],
          pageInfo: { hasNextPage: true, endCursor: "c1" },
        },
      },
    ]);

    const result = await findUnscopedCandidates(client, {
      scopeLabel: "git:foo",
      limit: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "a",
      identifier: "ENG-1",
      title: "first",
      currentLabelIds: ["l-a"],
    });
  });
});

describe("tagWithScope", () => {
  it("unions existing labels with the scope label id for each candidate", async () => {
    const client = { request: vi.fn() } as unknown as GraphQLClient;
    const tagged = await tagWithScope(
      client,
      [
        {
          id: "i-1",
          identifier: "ENG-1",
          title: "x",
          currentLabelIds: ["l-old"],
        },
      ],
      "l-scope",
    );

    expect(updateIssue).toHaveBeenCalledWith(client, "i-1", {
      labelIds: ["l-old", "l-scope"],
    });
    expect(tagged).toEqual([
      { id: "i-1", identifier: "ENG-1", labels_added: ["l-scope"] },
    ]);
  });

  it("skips candidates that already carry the scope label", async () => {
    vi.mocked(updateIssue).mockClear();
    const client = { request: vi.fn() } as unknown as GraphQLClient;

    const tagged = await tagWithScope(
      client,
      [
        {
          id: "i-1",
          identifier: "ENG-1",
          title: "already tagged",
          currentLabelIds: ["l-scope"],
        },
      ],
      "l-scope",
    );

    expect(updateIssue).not.toHaveBeenCalled();
    expect(tagged).toEqual([]);
  });
});
