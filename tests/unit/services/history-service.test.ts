import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { getIssueHistory } from "../../../src/services/history-service.js";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev-1",
    createdAt: "2026-05-10T12:00:00.000Z",
    updatedDescription: false,
    actor: null,
    fromState: null,
    toState: null,
    fromPriority: null,
    toPriority: null,
    fromTitle: null,
    toTitle: null,
    fromAssignee: null,
    toAssignee: null,
    fromParent: null,
    toParent: null,
    addedLabels: null,
    removedLabels: null,
    ...overrides,
  };
}

function makeIssue(events: ReturnType<typeof makeEvent>[], hasNext = false) {
  return {
    issue: {
      id: "issue-uuid",
      identifier: "TES-1",
      title: "demo",
      history: {
        nodes: events,
        pageInfo: {
          hasNextPage: hasNext,
          endCursor: hasNext ? "cursor-1" : null,
        },
      },
    },
  };
}

describe("getIssueHistory", () => {
  it("shapes a single page of events into HistoryResult", async () => {
    const events = [
      makeEvent({
        id: "ev-a",
        actor: {
          id: "u1",
          name: "alice",
          displayName: "Alice",
          email: "a@b.c",
        },
        fromState: { id: "s1", name: "Backlog", type: "backlog" },
        toState: { id: "s2", name: "In Progress", type: "started" },
      }),
      makeEvent({
        id: "ev-b",
        fromPriority: 0,
        toPriority: 2,
      }),
    ];
    const client = {
      request: vi.fn().mockResolvedValue(makeIssue(events)),
    } as unknown as GraphQLClient;

    const result = await getIssueHistory(client, "issue-uuid", 0);

    expect(result.issue).toEqual({
      id: "issue-uuid",
      identifier: "TES-1",
      title: "demo",
    });
    expect(result.total).toBe(2);
    expect(result.events[0].id).toBe("ev-a");
    expect(result.events[0].actor?.email).toBe("a@b.c");
    expect(result.events[0].fromState?.name).toBe("Backlog");
    expect(result.events[1].fromPriority).toBe(0);
    expect(result.events[1].toPriority).toBe(2);
    expect(result.events[0].addedLabels).toEqual([]);
    // New delta fields default to empty/null when the node omits them.
    expect(result.events[0].relationChanges).toEqual([]);
    expect(result.events[0].archived).toBeNull();
    expect(result.events[0].fromCycle).toBeNull();
  });

  it("surfaces relationChanges and the extra delta fields (lin-8yl1.8)", async () => {
    const events = [
      makeEvent({
        id: "ev-rel",
        relationChanges: [{ identifier: "TES-9", type: "ab" }],
        archived: true,
        fromEstimate: 1,
        toEstimate: 3,
        fromDueDate: "2026-01-01",
        toDueDate: "2026-02-01",
        fromCycle: { id: "c1", name: "Sprint 1", number: 1 },
        toCycle: { id: "c2", name: null, number: 2 },
        fromProject: { id: "p1", name: "Old" },
        toProject: { id: "p2", name: "New" },
      }),
    ];
    const client = {
      request: vi.fn().mockResolvedValue(makeIssue(events)),
    } as unknown as GraphQLClient;

    const result = await getIssueHistory(client, "issue-uuid", 0);
    const e = result.events[0];
    expect(e.relationChanges).toEqual([{ identifier: "TES-9", type: "ab" }]);
    expect(e.archived).toBe(true);
    expect(e.fromEstimate).toBe(1);
    expect(e.toEstimate).toBe(3);
    expect(e.fromDueDate).toBe("2026-01-01");
    expect(e.toCycle).toEqual({ id: "c2", name: null, number: 2 });
    expect(e.toProject).toEqual({ id: "p2", name: "New" });
  });

  it("paginates when hasNextPage is true", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(makeIssue([makeEvent({ id: "p1" })], true))
      .mockResolvedValueOnce(makeIssue([makeEvent({ id: "p2" })], false));
    const client = { request } as unknown as GraphQLClient;

    const result = await getIssueHistory(client, "issue-uuid", 0);

    expect(result.total).toBe(2);
    expect(result.events.map((e) => e.id)).toEqual(["p1", "p2"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toMatchObject({
      first: 100,
      after: undefined,
    });
    expect(request.mock.calls[1][1]).toMatchObject({
      first: 100,
      after: "cursor-1",
    });
  });

  it("respects --limit by truncating after the cap is reached", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        makeIssue([makeEvent({ id: "x1" }), makeEvent({ id: "x2" })], true),
      );
    const client = { request } as unknown as GraphQLClient;

    const result = await getIssueHistory(client, "issue-uuid", 2);

    expect(result.total).toBe(2);
    expect(result.events.map((e) => e.id)).toEqual(["x1", "x2"]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({ first: 2 });
  });

  it("limits the page size to the remaining cap across pages", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(makeIssue([makeEvent({ id: "a" })], true))
      .mockResolvedValueOnce(makeIssue([makeEvent({ id: "b" })], true));
    const client = { request } as unknown as GraphQLClient;

    const result = await getIssueHistory(client, "issue-uuid", 2);

    expect(result.total).toBe(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1].first).toBe(2);
    expect(request.mock.calls[1][1].first).toBe(1);
  });

  it("returns empty events when issue has no history", async () => {
    const client = {
      request: vi.fn().mockResolvedValue(makeIssue([])),
    } as unknown as GraphQLClient;

    const result = await getIssueHistory(client, "issue-uuid", 0);
    expect(result.total).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.issue.identifier).toBe("TES-1");
  });
});
