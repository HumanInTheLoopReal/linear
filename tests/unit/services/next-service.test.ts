import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  claimReadyIssue,
  listNextIssues,
  sortReadyIssues,
} from "../../../src/services/next-service.js";

function mockGqlClient(response: Record<string, unknown>): GraphQLClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  } as unknown as GraphQLClient;
}

function makeIssue(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "i-1",
    identifier: "ENG-1",
    title: "t",
    priority: 2,
    state: { id: "s-1", name: "Backlog" },
    team: { id: "team-1", key: "ENG", name: "ENG" },
    labels: { nodes: [] },
    ...overrides,
  };
}

describe("listNextIssues", () => {
  it("sends an AND filter with open state types and hasBlockedByRelations=false", async () => {
    const client = mockGqlClient({
      issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    await listNextIssues(client);

    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      first: 100,
      filter: {
        and: [
          { state: { type: { in: ["triage", "backlog", "unstarted"] } } },
          { hasBlockedByRelations: { eq: false } },
        ],
      },
    });
  });

  it("appends every filter fragment when options are provided", async () => {
    const client = mockGqlClient({
      issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    await listNextIssues(client, {
      teamId: "t-1",
      assigneeId: "u-1",
      priority: 2,
      labelIds: ["l-1", "l-2"],
      typeLabel: "type:task",
      limit: 50,
    });

    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      first: 50,
      filter: {
        and: [
          { state: { type: { in: ["triage", "backlog", "unstarted"] } } },
          { hasBlockedByRelations: { eq: false } },
          { team: { id: { eq: "t-1" } } },
          { assignee: { id: { eq: "u-1" } } },
          { priority: { eq: 2 } },
          { labels: { some: { id: { in: ["l-1", "l-2"] } } } },
          { labels: { some: { name: { eq: "type:task" } } } },
        ],
      },
    });
  });

  // lin-ufud: --exclude-label is the inverse of --label. Encoded as
  // labels.every.id.nin so an issue with zero labels still passes (the
  // common case for fresh imports), and we don't pull labels client-side.
  it("appends excludeLabelIds as a labels.every.id.nin fragment", async () => {
    const client = mockGqlClient({
      issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    await listNextIssues(client, {
      excludeLabelIds: ["l-noise-a", "l-noise-b"],
    });

    const variables = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as { filter: { and: unknown[] } };
    expect(variables.filter.and).toContainEqual({
      labels: { every: { id: { nin: ["l-noise-a", "l-noise-b"] } } },
    });
  });

  it("omits the exclude-label fragment when excludeLabelIds is empty", async () => {
    const client = mockGqlClient({
      issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    await listNextIssues(client, { excludeLabelIds: [] });

    const variables = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as { filter: { and: unknown[] } };
    for (const frag of variables.filter.and) {
      const f = frag as { labels?: { every?: unknown } };
      expect(f.labels?.every).toBeUndefined();
    }
  });

  it("appends scope label fragment when scope.label is active", async () => {
    const client = mockGqlClient({
      issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    await listNextIssues(client, { scope: { label: "git:foo" } });

    const variables = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as { filter: { and: unknown[] } };
    expect(variables.filter.and).toContainEqual({
      labels: { some: { name: { eq: "git:foo" } } },
    });
  });

  it("does not add any scope fragment when scope is empty", async () => {
    const client = mockGqlClient({
      issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    await listNextIssues(client, { scope: {} });

    const variables = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as { filter: { and: unknown[] } };
    expect(variables.filter.and).toEqual([
      { state: { type: { in: ["triage", "backlog", "unstarted"] } } },
      { hasBlockedByRelations: { eq: false } },
    ]);
  });

  it("uses assignee:null filter when unassigned is true", async () => {
    const client = mockGqlClient({
      issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    await listNextIssues(client, { unassigned: true });

    const variables = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as { filter: { and: unknown[] } };
    expect(variables.filter.and).toContainEqual({
      assignee: { null: true },
    });
  });

  it("filters out issues with the 'deferred' label by default", async () => {
    const client = mockGqlClient({
      issues: {
        nodes: [
          makeIssue({
            id: "i-1",
            identifier: "ENG-1",
            priority: 1,
            labels: { nodes: [{ id: "l-x", name: "deferred" }] },
          }),
          makeIssue({ id: "i-2", identifier: "ENG-2", priority: 1 }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const issues = await listNextIssues(client);

    expect(issues).toHaveLength(1);
    expect(issues[0].identifier).toBe("ENG-2");
  });

  it("filters out issues with future 'deferred-until:<date>' label", async () => {
    const client = mockGqlClient({
      issues: {
        nodes: [
          makeIssue({
            id: "i-future",
            identifier: "ENG-1",
            labels: {
              nodes: [{ id: "l-f", name: "deferred-until:2099-01-01" }],
            },
          }),
          makeIssue({
            id: "i-past",
            identifier: "ENG-2",
            labels: {
              nodes: [{ id: "l-p", name: "deferred-until:2000-01-01" }],
            },
          }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const issues = await listNextIssues(client, { today: "2026-05-12" });

    expect(issues.map((i) => i.identifier)).toEqual(["ENG-2"]);
  });

  it("re-surfaces issues with both 'deferred' AND past 'deferred-until:<date>'", async () => {
    const client = mockGqlClient({
      issues: {
        nodes: [
          makeIssue({
            id: "i-hidden",
            identifier: "ENG-1",
            labels: {
              nodes: [
                { id: "l-d", name: "deferred" },
                { id: "l-u", name: "deferred-until:2099-01-01" },
              ],
            },
          }),
          makeIssue({
            id: "i-resurface",
            identifier: "ENG-2",
            labels: {
              nodes: [
                { id: "l-d", name: "deferred" },
                { id: "l-u", name: "deferred-until:2000-01-01" },
              ],
            },
          }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const issues = await listNextIssues(client, { today: "2026-05-12" });

    expect(issues.map((i) => i.identifier)).toEqual(["ENG-2"]);
  });

  it("keeps deferred issues when includeDeferred is true", async () => {
    const client = mockGqlClient({
      issues: {
        nodes: [
          makeIssue({
            id: "i-1",
            identifier: "ENG-1",
            labels: { nodes: [{ id: "l-x", name: "deferred" }] },
          }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const issues = await listNextIssues(client, { includeDeferred: true });
    expect(issues).toHaveLength(1);
  });

  it("sorts priority asc with 0 sunk to the end, then identifier", async () => {
    const client = mockGqlClient({
      issues: {
        nodes: [
          makeIssue({ id: "z", identifier: "ENG-3", priority: 0 }),
          makeIssue({ id: "a", identifier: "ENG-1", priority: 4 }),
          makeIssue({ id: "b", identifier: "ENG-2", priority: 1 }),
          makeIssue({ id: "c", identifier: "ENG-4", priority: 1 }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const issues = await listNextIssues(client);
    expect(issues.map((i) => i.identifier)).toEqual([
      "ENG-2",
      "ENG-4",
      "ENG-1",
      "ENG-3",
    ]);
  });

  it("appends a parent.id.eq fragment for parentId (lin-igmg)", async () => {
    const client = mockGqlClient({
      issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    await listNextIssues(client, { parentId: "epic-uuid" });

    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      first: 100,
      filter: {
        and: [
          { state: { type: { in: ["triage", "backlog", "unstarted"] } } },
          { hasBlockedByRelations: { eq: false } },
          { parent: { id: { eq: "epic-uuid" } } },
        ],
      },
    });
  });

  it("appends a label-pattern glob fragment for labelPatternFilter (lin-ym1m)", async () => {
    const client = mockGqlClient({
      issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    await listNextIssues(client, {
      labelPatternFilter: {
        labels: { some: { name: { startsWith: "type:" } } },
      },
    });

    const arg = vi.mocked(client.request).mock.calls[0][1] as {
      filter: { and: unknown[] };
    };
    expect(arg.filter.and).toContainEqual({
      labels: { some: { name: { startsWith: "type:" } } },
    });
  });
});

describe("sortReadyIssues — ready ordering policies (lin-pazf)", () => {
  const NOW = "2026-06-01T00:00:00.000Z";
  // recent = within 48h of NOW; old = well before.
  const make = (id: string, priority: number, createdAt: string) => ({
    identifier: id,
    priority,
    createdAt,
  });

  it("priority: urgent-first, 0 sunk, id tiebreak", () => {
    const out = sortReadyIssues(
      [
        make("E-3", 0, "2026-05-01T00:00:00Z"),
        make("E-1", 4, "2026-05-01T00:00:00Z"),
        make("E-2", 1, "2026-05-01T00:00:00Z"),
        make("E-4", 1, "2026-05-01T00:00:00Z"),
      ],
      "priority",
    );
    expect(out.map((i) => i.identifier)).toEqual(["E-2", "E-4", "E-1", "E-3"]);
  });

  it("oldest: FIFO drain by createdAt then id, ignoring priority", () => {
    const out = sortReadyIssues(
      [
        make("E-1", 1, "2026-05-03T00:00:00Z"),
        make("E-2", 4, "2026-05-01T00:00:00Z"),
        make("E-3", 2, "2026-05-02T00:00:00Z"),
      ],
      "oldest",
    );
    expect(out.map((i) => i.identifier)).toEqual(["E-2", "E-3", "E-1"]);
  });

  it("hybrid: recent (<48h) issues ordered by priority float above older drain", () => {
    const out = sortReadyIssues(
      [
        // older issues (created days ago) — should drain oldest-first BELOW
        make("OLD-hi", 1, "2026-05-20T00:00:00Z"),
        make("OLD-older", 4, "2026-05-10T00:00:00Z"),
        // recent issues (within 48h of NOW) — priority-ordered, ON TOP
        make("NEW-lo", 3, "2026-05-31T12:00:00Z"),
        make("NEW-hi", 1, "2026-05-31T18:00:00Z"),
      ],
      "hybrid",
      NOW,
    );
    expect(out.map((i) => i.identifier)).toEqual([
      "NEW-hi", // recent, P1
      "NEW-lo", // recent, P3
      "OLD-older", // older drain: oldest createdAt first
      "OLD-hi",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [make("E-2", 2, "2026-05-02T00:00:00Z"), make("E-1", 1, "x")];
    const copy = [...input];
    sortReadyIssues(input, "priority");
    expect(input).toEqual(copy);
  });
});

describe("claimReadyIssue", () => {
  it("looks up the viewer and updates state + assignee", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        viewer: { id: "viewer-uuid", name: "Ada" },
      })
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "i-1", identifier: "ENG-1" },
        },
      });
    const client = { request } as unknown as GraphQLClient;
    const candidate = makeIssue() as unknown as Parameters<
      typeof claimReadyIssue
    >[1];

    const result = await claimReadyIssue(client, candidate, "state-started");

    expect(result).toEqual({
      id: "i-1",
      identifier: "ENG-1",
      assignee_id: "viewer-uuid",
      state_id: "state-started",
    });
    expect(request.mock.calls[1][1]).toEqual({
      id: "i-1",
      input: { stateId: "state-started", assigneeId: "viewer-uuid" },
    });
  });
});
