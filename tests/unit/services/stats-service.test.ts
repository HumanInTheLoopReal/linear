import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { getStatus } from "../../../src/services/stats-service.js";

type IssueNode = {
  id: string;
  state: { id: string; type: string };
  labels: { nodes: Array<{ id: string; name: string }> };
};

function statsResponse(nodes: IssueNode[]) {
  return {
    issues: {
      nodes,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function mockClient(handlers: {
  closed?: IssueNode[];
  active?: IssueNode[];
  blocked?: IssueNode[];
  viewer?: { id: string };
}): GraphQLClient {
  const request = vi.fn((_doc: unknown, vars?: { filter?: unknown }) => {
    if (vars === undefined) {
      return Promise.resolve({
        viewer: handlers.viewer ?? { id: "viewer-uuid" },
      });
    }
    const filter = vars.filter as
      | { and?: Array<Record<string, unknown>> }
      | undefined;
    const fragments = filter?.and ?? [];
    const stateFrag = fragments.find(
      (f) => "state" in f && (f.state as { type?: unknown })?.type,
    ) as { state: { type: { in?: string[]; nin?: string[] } } } | undefined;
    const isClosedQuery = stateFrag?.state.type.in?.includes("completed");
    const isBlockedQuery = fragments.some((f) => "hasBlockedByRelations" in f);
    if (isClosedQuery)
      return Promise.resolve(statsResponse(handlers.closed ?? []));
    if (isBlockedQuery)
      return Promise.resolve(statsResponse(handlers.blocked ?? []));
    return Promise.resolve(statsResponse(handlers.active ?? []));
  });
  return { request } as unknown as GraphQLClient;
}

function issue(id: string, type: string, labels: string[] = []): IssueNode {
  return {
    id,
    state: { id: `state-${type}`, type },
    labels: {
      nodes: labels.map((name, i) => ({ id: `l-${id}-${i}`, name })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getStatus", () => {
  it("buckets issues into open/in_progress/blocked/deferred/closed", async () => {
    const client = mockClient({
      closed: [
        issue("c1", "completed"),
        issue("c2", "canceled"),
        issue("c3", "duplicate"),
      ],
      active: [
        issue("o1", "unstarted"),
        issue("o2", "backlog"),
        issue("o3", "triage"),
        issue("p1", "started"),
        issue("p2", "started"),
        issue("b1", "started"),
        issue("d1", "unstarted", ["deferred"]),
      ],
      blocked: [issue("b1", "started")],
    });

    const result = await getStatus(client, { today: "2026-05-12" });
    expect(result.summary).toEqual({
      total_issues: 10,
      open_issues: 3,
      in_progress_issues: 2,
      blocked_issues: 1,
      deferred_issues: 1,
      closed_issues: 3,
      ready_issues: 3,
      pinned_issues: 0,
      epics_eligible_for_closure: 0,
      average_lead_time: 0,
    });
    expect(result.recent_activity).toBeNull();
  });

  it("counts deferred-until:<future-date> as deferred", async () => {
    const client = mockClient({
      active: [
        issue("d1", "unstarted", ["deferred-until:2099-01-01"]),
        issue("d2", "unstarted", ["deferred-until:2020-01-01"]),
      ],
    });

    const result = await getStatus(client, { today: "2026-05-12" });
    expect(result.summary.deferred_issues).toBe(1);
    expect(result.summary.open_issues).toBe(1);
  });

  it("treats stale snooze (deferred + past-date) as ready, not deferred (lin-dpp1)", async () => {
    // Regression: `linear next` already resurfaced past-date snoozes, but
    // `linear issues status` counted the bare `deferred` label as
    // authoritative, so its Ready-to-Work count was lower than next's
    // list. Both now share `common/deferred-label.isDeferred` — past-date
    // wins, even when the bare `deferred` label is still attached.
    const client = mockClient({
      active: [
        issue("stale", "unstarted", ["deferred", "deferred-until:2020-01-01"]),
      ],
    });

    const result = await getStatus(client, { today: "2026-05-12" });
    expect(result.summary.deferred_issues).toBe(0);
    expect(result.summary.ready_issues).toBe(1);
  });

  it("prefers deferred over blocked when both apply", async () => {
    const client = mockClient({
      active: [issue("x1", "unstarted", ["deferred"])],
      blocked: [issue("x1", "unstarted")],
    });

    const result = await getStatus(client);
    expect(result.summary.deferred_issues).toBe(1);
    expect(result.summary.blocked_issues).toBe(0);
  });

  it("ready_issues mirrors open_issues exactly", async () => {
    const client = mockClient({
      active: [
        issue("o1", "unstarted"),
        issue("o2", "backlog"),
        issue("p1", "started"),
      ],
    });

    const result = await getStatus(client);
    expect(result.summary.ready_issues).toBe(result.summary.open_issues);
    expect(result.summary.ready_issues).toBe(2);
  });

  it("resolves viewer ID first when assignedOnly is set", async () => {
    const client = mockClient({
      viewer: { id: "me-uuid" },
      active: [],
    });

    await getStatus(client, { assignedOnly: true });

    const request = (client as unknown as { request: ReturnType<typeof vi.fn> })
      .request;
    const viewerCalls = request.mock.calls.filter((c) => c.length === 1);
    expect(viewerCalls.length).toBeGreaterThanOrEqual(1);
    const filterCalls = request.mock.calls.filter(
      (c) => c.length >= 2 && c[1] !== undefined,
    ) as Array<[unknown, { filter: { and: Array<Record<string, unknown>> } }]>;
    for (const [, vars] of filterCalls) {
      const hasAssigneeFilter = vars.filter.and.some(
        (f) =>
          "assignee" in f &&
          (f.assignee as { id?: { eq?: string } })?.id?.eq === "me-uuid",
      );
      expect(hasAssigneeFilter).toBe(true);
    }
  });

  it("always returns recent_activity as null", async () => {
    const client = mockClient({ active: [] });
    const result = await getStatus(client);
    expect(result.recent_activity).toBeNull();
  });
});
