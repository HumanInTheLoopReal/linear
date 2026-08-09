import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  __ghDeps,
  fetchGateForResolve,
  GATE_LABEL_NAME,
  listGates,
  parseTimeoutToMs,
  resolveGate,
  runGateCheck,
} from "../../../src/services/gate-service.js";

function makeClient(responses: unknown[]): GraphQLClient {
  const request = vi.fn();
  for (const r of responses) request.mockResolvedValueOnce(r);
  return { request } as unknown as GraphQLClient;
}

function gateNode(opts: {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string;
  stateType?: string;
  stateName?: string;
}) {
  return {
    id: opts.id ?? "g-1",
    identifier: opts.identifier ?? "ENG-G",
    title: opts.title ?? "Gate: ci passes",
    description: opts.description ?? "",
    priority: 0,
    state: {
      id: "s",
      name: opts.stateName ?? "Backlog",
      type: opts.stateType ?? "backlog",
    },
    team: { id: "team-a", key: "ENG", name: "Eng" },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    labels: { nodes: [{ id: "l-gate", name: GATE_LABEL_NAME }] },
  };
}

function page(
  nodes: ReturnType<typeof gateNode>[],
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return { issues: { nodes, pageInfo: { hasNextPage, endCursor } } };
}

describe("listGates", () => {
  it("parses await_type/await_id/timeout from the description block", async () => {
    const desc =
      "Gate metadata:\n- await_type: gh:run\n- await_id: 12345\n- timeout: 30m\n";
    const client = makeClient([page([gateNode({ description: desc })])]);
    const result = await listGates(client);
    expect(result).toHaveLength(1);
    expect(result[0]?.await_type).toBe("gh:run");
    expect(result[0]?.await_id).toBe("12345");
    expect(result[0]?.timeout).toBe("30m");
    expect(result[0]?.issue_type).toBe("gate");
  });

  it("parses a comma-separated waiters list", async () => {
    const desc = "waiters: my/agent-1, my/agent-2, my/agent-3\n";
    const client = makeClient([page([gateNode({ description: desc })])]);
    const result = await listGates(client);
    expect(result[0]?.waiters).toEqual([
      "my/agent-1",
      "my/agent-2",
      "my/agent-3",
    ]);
  });

  it("returns empty waiters for missing or trailing-only entries", async () => {
    const client = makeClient([
      page([
        gateNode({ id: "g-no", description: "no waiters block" }),
        gateNode({ id: "g-trailing", description: "waiters: , , " }),
      ]),
    ]);
    const result = await listGates(client);
    expect(result[0]?.waiters).toEqual([]);
    expect(result[1]?.waiters).toEqual([]);
  });

  it("returns null fields when the description is missing keys", async () => {
    const client = makeClient([
      page([gateNode({ description: "just freeform text" })]),
    ]);
    const result = await listGates(client);
    expect(result[0]?.await_type).toBeNull();
    expect(result[0]?.await_id).toBeNull();
    expect(result[0]?.timeout).toBeNull();
  });

  it("defaults to OPEN gates only; --all relaxes the state filter", async () => {
    const requestSpy = vi.fn().mockResolvedValueOnce(page([]));
    const client = { request: requestSpy } as unknown as GraphQLClient;

    await listGates(client);
    expect(requestSpy).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        filter: expect.objectContaining({
          labels: { name: { eq: GATE_LABEL_NAME } },
          state: { type: { in: expect.any(Array) } },
        }),
      }),
    );

    requestSpy.mockResolvedValueOnce(page([]));
    await listGates(client, { all: true });
    const allCall = requestSpy.mock.calls[1]?.[1] as { filter: IssueFilter };
    expect(allCall.filter).not.toHaveProperty("state");
  });

  it("forwards --team to the issue filter", async () => {
    const requestSpy = vi.fn().mockResolvedValueOnce(page([]));
    const client = { request: requestSpy } as unknown as GraphQLClient;
    await listGates(client, { teamId: "team-uuid" });
    expect(requestSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filter: expect.objectContaining({
          team: { id: { eq: "team-uuid" } },
        }),
      }),
    );
  });

  it("respects --limit and stops paginating once filled", async () => {
    const client = makeClient([
      page(
        [gateNode({ id: "g-1" }), gateNode({ id: "g-2" })],
        true,
        "cursor-1",
      ),
      page([gateNode({ id: "g-3" })], true, "cursor-2"),
    ]);
    const result = await listGates(client, { limit: 3 });
    expect(result).toHaveLength(3);
    // Stopped after page 2 since limit reached; should NOT make a third request.
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      2,
    );
  });

  it("returns [] when no gates exist", async () => {
    const client = makeClient([page([])]);
    const result = await listGates(client);
    expect(result).toEqual([]);
  });
});

// Helper type used by the filter assertion above.
type IssueFilter = {
  labels: unknown;
  state?: unknown;
  team?: unknown;
};

describe("fetchGateForResolve", () => {
  function issueFor(opts: {
    id?: string;
    identifier?: string;
    teamId?: string;
    labels?: string[];
  }) {
    return {
      id: opts.id ?? "g-uuid",
      identifier: opts.identifier ?? "ENG-1",
      title: "Gate: ci",
      description: "",
      state: { id: "s1", name: "Backlog" },
      team: { id: opts.teamId ?? "team-uuid", key: "ENG", name: "Eng" },
      labels: {
        nodes: (opts.labels ?? [GATE_LABEL_NAME]).map((n) => ({
          id: `l-${n}`,
          name: n,
        })),
      },
    };
  }

  it("returns id/identifier/team_id for a labeled gate issue", async () => {
    const client = {
      request: vi.fn().mockResolvedValueOnce({ issue: issueFor({}) }),
    } as unknown as GraphQLClient;
    const ctx = await fetchGateForResolve(client, "g-uuid");
    expect(ctx).toEqual({
      id: "g-uuid",
      identifier: "ENG-1",
      team_id: "team-uuid",
    });
  });

  it("throws when the issue does not carry the gate label", async () => {
    const client = {
      request: vi.fn().mockResolvedValueOnce({
        issue: issueFor({ labels: ["other-label"] }),
      }),
    } as unknown as GraphQLClient;
    await expect(fetchGateForResolve(client, "g-uuid")).rejects.toThrow(
      /not a gate/,
    );
  });
});

describe("parseTimeoutToMs", () => {
  it("parses duration suffixes", () => {
    expect(parseTimeoutToMs("30s")).toBe(30_000);
    expect(parseTimeoutToMs("5m")).toBe(5 * 60_000);
    expect(parseTimeoutToMs("2h")).toBe(2 * 3_600_000);
    expect(parseTimeoutToMs("1d")).toBe(86_400_000);
    expect(parseTimeoutToMs("100ms")).toBe(100);
  });

  it("returns null for malformed or empty input", () => {
    expect(parseTimeoutToMs(null)).toBeNull();
    expect(parseTimeoutToMs("")).toBeNull();
    expect(parseTimeoutToMs("forever")).toBeNull();
    expect(parseTimeoutToMs("1h30m")).toBeNull();
    expect(parseTimeoutToMs("-1m")).toBeNull();
  });
});

describe("runGateCheck", () => {
  let origRunView: typeof __ghDeps.runViewJSON;
  let origPRView: typeof __ghDeps.prViewJSON;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:30:00.000Z"));
    origRunView = __ghDeps.runViewJSON;
    origPRView = __ghDeps.prViewJSON;
  });

  afterEach(() => {
    vi.useRealTimers();
    __ghDeps.runViewJSON = origRunView;
    __ghDeps.prViewJSON = origPRView;
    vi.restoreAllMocks();
  });

  function gatePage(
    descriptions: Array<{
      id: string;
      identifier: string;
      teamId?: string;
      desc: string;
      createdAt?: string;
    }>,
  ) {
    return {
      issues: {
        nodes: descriptions.map((d) => ({
          id: d.id,
          identifier: d.identifier,
          title: `Gate: ${d.identifier}`,
          description: d.desc,
          priority: 0,
          state: { id: "s1", name: "Backlog", type: "backlog" },
          team: { id: d.teamId ?? "team-a", key: "ENG", name: "Eng" },
          createdAt: d.createdAt ?? "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
          labels: { nodes: [{ id: "l-gate", name: GATE_LABEL_NAME }] },
        })),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  }

  it("resolves a gh:run gate when status=completed AND conclusion=success", async () => {
    const request = vi.fn();
    request.mockResolvedValueOnce(
      gatePage([
        {
          id: "g-1",
          identifier: "ENG-1",
          desc: "await_type: gh:run\nawait_id: 12345\n",
        },
      ]),
    );
    request.mockResolvedValueOnce({
      issueUpdate: {
        success: true,
        issue: {
          id: "g-1",
          identifier: "ENG-1",
          state: { id: "s-done", name: "Done" },
        },
      },
    });
    const gql = { request } as unknown as GraphQLClient;
    __ghDeps.runViewJSON = vi.fn().mockResolvedValue({
      status: "completed",
      conclusion: "success",
      name: "ci",
    });

    const summary = await runGateCheck(gql, {
      completedStateByTeam: new Map([["team-a", { stateId: "s-done" }]]),
    });
    expect(summary.checked).toBe(1);
    expect(summary.resolved).toBe(1);
    expect(summary.results[0]?.outcome).toBe("resolved");
    expect(summary.results[0]?.closed).toBe(true);
    // Two requests: listGates page + issueUpdate
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("escalates a gh:pr gate when state=CLOSED without merge (does NOT close)", async () => {
    const request = vi.fn();
    request.mockResolvedValueOnce(
      gatePage([
        {
          id: "g-2",
          identifier: "ENG-2",
          desc: "await_type: gh:pr\nawait_id: 42\n",
        },
      ]),
    );
    const gql = { request } as unknown as GraphQLClient;
    __ghDeps.prViewJSON = vi
      .fn()
      .mockResolvedValue({ state: "CLOSED", title: "the-pr" });

    const summary = await runGateCheck(gql);
    expect(summary.checked).toBe(1);
    expect(summary.escalated).toBe(1);
    expect(summary.resolved).toBe(0);
    expect(summary.results[0]?.outcome).toBe("escalated");
    expect(summary.results[0]?.closed).toBe(false);
    // Only one request — the listGates page; no issueUpdate.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("resolves a timer gate once created_at + timeout < now", async () => {
    // System time is 2026-05-12T00:30:00Z; gate created at 00:00:00Z with 10m timeout.
    const request = vi.fn();
    request.mockResolvedValueOnce(
      gatePage([
        {
          id: "g-3",
          identifier: "ENG-3",
          desc: "await_type: timer\ntimeout: 10m\n",
          createdAt: "2026-05-12T00:00:00.000Z",
        },
      ]),
    );
    request.mockResolvedValueOnce({
      issueUpdate: {
        success: true,
        issue: {
          id: "g-3",
          identifier: "ENG-3",
          state: { id: "s-done", name: "Done" },
        },
      },
    });
    const gql = { request } as unknown as GraphQLClient;
    const summary = await runGateCheck(gql, {
      completedStateByTeam: new Map([["team-a", { stateId: "s-done" }]]),
    });
    expect(summary.resolved).toBe(1);
    expect(summary.results[0]?.reason).toMatch(/timer expired/);
  });

  it("marks human gates as skipped without calling gh CLI", async () => {
    const ghSpy = vi.fn();
    __ghDeps.runViewJSON = ghSpy;
    __ghDeps.prViewJSON = ghSpy;
    const request = vi.fn().mockResolvedValueOnce(
      gatePage([
        {
          id: "g-4",
          identifier: "ENG-4",
          desc: "await_type: human\nawait_id: needs-review\n",
        },
      ]),
    );
    const gql = { request } as unknown as GraphQLClient;
    const summary = await runGateCheck(gql);
    expect(summary.skipped).toBe(1);
    expect(summary.results[0]?.outcome).toBe("skipped");
    expect(ghSpy).not.toHaveBeenCalled();
  });

  it("dry-run reports resolved without calling issueUpdate", async () => {
    const request = vi.fn().mockResolvedValueOnce(
      gatePage([
        {
          id: "g-5",
          identifier: "ENG-5",
          desc: "await_type: timer\ntimeout: 10m\n",
        },
      ]),
    );
    const gql = { request } as unknown as GraphQLClient;
    const summary = await runGateCheck(gql, { dryRun: true });
    expect(summary.resolved).toBe(1);
    expect(summary.results[0]?.closed).toBe(false);
    expect(summary.dry_run).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("respects --type filter: gh-prefix matches both gh:run and gh:pr", async () => {
    const request = vi.fn().mockResolvedValueOnce(
      gatePage([
        {
          id: "g-a",
          identifier: "ENG-A",
          desc: "await_type: gh:run\nawait_id: 1\n",
        },
        {
          id: "g-b",
          identifier: "ENG-B",
          desc: "await_type: gh:pr\nawait_id: 2\n",
        },
        {
          id: "g-c",
          identifier: "ENG-C",
          desc: "await_type: timer\ntimeout: 1h\n",
        },
      ]),
    );
    const gql = { request } as unknown as GraphQLClient;
    __ghDeps.runViewJSON = vi.fn().mockResolvedValue({
      status: "in_progress",
    });
    __ghDeps.prViewJSON = vi
      .fn()
      .mockResolvedValue({ state: "OPEN", title: "pr-2" });
    const summary = await runGateCheck(gql, {
      typeFilter: "gh",
      dryRun: true,
    });
    expect(summary.checked).toBe(2);
    expect(summary.results.map((r) => r.identifier)).toEqual([
      "ENG-A",
      "ENG-B",
    ]);
  });
});

describe("resolveGate", () => {
  function updateIssueResponse(stateName = "Done") {
    return {
      issueUpdate: {
        success: true,
        issue: {
          id: "g-uuid",
          identifier: "ENG-1",
          state: { id: "state-done-uuid", name: stateName },
        },
      },
    };
  }

  it("calls issueUpdate with stateId and returns the new state metadata", async () => {
    const request = vi.fn().mockResolvedValueOnce(updateIssueResponse());
    const client = { request } as unknown as GraphQLClient;
    const result = await resolveGate(client, {
      issueId: "g-uuid",
      stateId: "state-done-uuid",
    });
    expect(request).toHaveBeenCalledTimes(1);
    const updateCallVars = request.mock.calls[0]?.[1] as {
      id: string;
      input: { stateId: string };
    };
    expect(updateCallVars.id).toBe("g-uuid");
    expect(updateCallVars.input).toEqual({ stateId: "state-done-uuid" });
    expect(result).toEqual({
      id: "g-uuid",
      identifier: "ENG-1",
      state_id: "state-done-uuid",
      state_name: "Done",
      comment_id: null,
      reason: null,
    });
  });

  it("posts a comment when --reason is provided and captures its id", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(updateIssueResponse())
      .mockResolvedValueOnce({
        commentCreate: {
          success: true,
          comment: { id: "comment-uuid", body: "...", createdAt: "" },
        },
      });
    const client = { request } as unknown as GraphQLClient;
    const result = await resolveGate(client, {
      issueId: "g-uuid",
      stateId: "state-done-uuid",
      reason: "Manual override",
    });
    expect(request).toHaveBeenCalledTimes(2);
    const commentVars = request.mock.calls[1]?.[1] as {
      input: { issueId: string; body: string };
    };
    expect(commentVars.input.issueId).toBe("g-uuid");
    expect(commentVars.input.body).toContain("Manual override");
    expect(result.comment_id).toBe("comment-uuid");
    expect(result.reason).toBe("Manual override");
  });

  it("skips the comment when --reason is whitespace-only", async () => {
    const request = vi.fn().mockResolvedValueOnce(updateIssueResponse());
    const client = { request } as unknown as GraphQLClient;
    const result = await resolveGate(client, {
      issueId: "g-uuid",
      stateId: "state-done-uuid",
      reason: "   ",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.comment_id).toBeNull();
    expect(result.reason).toBeNull();
  });
});
