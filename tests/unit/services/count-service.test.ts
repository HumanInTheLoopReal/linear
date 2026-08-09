import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  countMatching,
  countMatchingGrouped,
} from "../../../src/services/count-service.js";

type IssueNode = {
  id: string;
  priority?: number;
  state: { id: string; type: string; name: string };
  assignee: { id: string; name: string } | null;
  labels: { nodes: Array<{ id: string; name: string }> };
};

const STATE_TYPE_TO_NAME: Record<string, string> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Todo",
  started: "In Progress",
  completed: "Done",
  canceled: "Canceled",
  duplicate: "Duplicate",
};

function statsResponse(nodes: IssueNode[]) {
  return {
    issues: {
      nodes,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function mockClient(nodes: IssueNode[]): GraphQLClient {
  const request = vi.fn(() => Promise.resolve(statsResponse(nodes)));
  return { request } as unknown as GraphQLClient;
}

function issue(
  id: string,
  type: string,
  opts: {
    priority?: number;
    assignee?: { id: string; name: string } | null;
    labels?: string[];
  } = {},
): IssueNode {
  return {
    id,
    priority: opts.priority ?? 0,
    state: {
      id: `state-${type}`,
      type,
      name: STATE_TYPE_TO_NAME[type] ?? type,
    },
    assignee: opts.assignee ?? null,
    labels: {
      nodes: (opts.labels ?? []).map((name, i) => ({
        id: `l-${id}-${i}`,
        name,
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("countMatching", () => {
  it("returns the total node count", async () => {
    const client = mockClient([
      issue("a", "unstarted"),
      issue("b", "started"),
      issue("c", "completed"),
    ]);
    const result = await countMatching(client, undefined);
    expect(result).toEqual({ count: 3 });
  });

  it("returns 0 when no issues match", async () => {
    const result = await countMatching(mockClient([]), undefined);
    expect(result).toEqual({ count: 0 });
  });
});

describe("countMatchingGrouped", () => {
  it("groups by status using Linear's workspace state.name", async () => {
    const client = mockClient([
      issue("a", "unstarted"),
      issue("b", "started"),
      issue("c", "started"),
      issue("d", "completed"),
      issue("e", "canceled"),
      issue("f", "triage"),
    ]);
    const result = await countMatchingGrouped(client, undefined, "status");
    expect(result.total).toBe(6);
    expect(result.groups).toEqual([
      { group: "Canceled", count: 1 },
      { group: "Done", count: 1 },
      { group: "In Progress", count: 2 },
      { group: "Todo", count: 1 },
      { group: "Triage", count: 1 },
    ]);
  });

  it("groups by priority with P-prefix", async () => {
    const client = mockClient([
      issue("a", "unstarted", { priority: 0 }),
      issue("b", "unstarted", { priority: 2 }),
      issue("c", "unstarted", { priority: 2 }),
      issue("d", "unstarted", { priority: 3 }),
    ]);
    const result = await countMatchingGrouped(client, undefined, "priority");
    expect(result.groups).toEqual([
      { group: "P0", count: 1 },
      { group: "P2", count: 2 },
      { group: "P3", count: 1 },
    ]);
  });

  it("groups by type via 'type:*' label, falling back to (no type)", async () => {
    const client = mockClient([
      issue("a", "unstarted", { labels: ["type:bug"] }),
      issue("b", "unstarted", { labels: ["type:bug", "foo"] }),
      issue("c", "unstarted", { labels: ["type:feature"] }),
      issue("d", "unstarted", { labels: ["foo"] }),
      issue("e", "unstarted", { labels: [] }),
    ]);
    const result = await countMatchingGrouped(client, undefined, "type");
    expect(result.groups).toEqual([
      { group: "(no type)", count: 2 },
      { group: "bug", count: 2 },
      { group: "feature", count: 1 },
    ]);
  });

  it("groups by assignee, bucketing nulls into (unassigned)", async () => {
    const client = mockClient([
      issue("a", "unstarted", {
        assignee: { id: "u1", name: "Alice" },
      }),
      issue("b", "unstarted", {
        assignee: { id: "u2", name: "Bob" },
      }),
      issue("c", "unstarted", {
        assignee: { id: "u1", name: "Alice" },
      }),
      issue("d", "unstarted", { assignee: null }),
    ]);
    const result = await countMatchingGrouped(client, undefined, "assignee");
    expect(result.groups).toEqual([
      { group: "(unassigned)", count: 1 },
      { group: "Alice", count: 2 },
      { group: "Bob", count: 1 },
    ]);
  });

  it("groups by label, counting each label separately ((no labels) for empties)", async () => {
    const client = mockClient([
      issue("a", "unstarted", { labels: ["foo", "bar"] }),
      issue("b", "unstarted", { labels: ["foo"] }),
      issue("c", "unstarted", { labels: [] }),
    ]);
    const result = await countMatchingGrouped(client, undefined, "label");
    expect(result.total).toBe(3);
    expect(result.groups).toEqual([
      { group: "(no labels)", count: 1 },
      { group: "bar", count: 1 },
      { group: "foo", count: 2 },
    ]);
  });
});
