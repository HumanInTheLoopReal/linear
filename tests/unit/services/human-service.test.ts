import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  dismissHumanIssue,
  getHumanIssueSnapshot,
  humanStats,
  isHumanStatusFilter,
  listHumanIssues,
  respondHumanIssue,
  summarizeHumanIssues,
} from "../../../src/services/human-service.js";

function makeClient(handler: () => unknown): GraphQLClient {
  const request = vi.fn(async () => handler());
  return { request } as unknown as GraphQLClient;
}

function isOpNamed(doc: unknown, name: string): boolean {
  const defs =
    (doc as { definitions?: Array<{ name?: { value?: string } }> })
      .definitions ?? [];
  return defs.some((d) => d.name?.value === name);
}

function makeDispatcher(
  handlers: Record<string, () => unknown>,
): GraphQLClient {
  return {
    request: vi.fn(async (doc: unknown) => {
      for (const [name, fn] of Object.entries(handlers)) {
        if (isOpNamed(doc, name)) return fn();
      }
      throw new Error("unexpected op");
    }),
  } as unknown as GraphQLClient;
}

function issueNode(args: {
  id: string;
  type: string;
  labels?: string[];
  priority?: number;
}) {
  return {
    id: args.id,
    identifier: `TEST-${args.id}`,
    title: `Issue ${args.id}`,
    priority: args.priority ?? 2,
    state: { id: `s-${args.type}`, name: args.type, type: args.type },
    team: { id: "t-1", key: "TEST" },
    labels: {
      nodes: (args.labels ?? ["human"]).map((n) => ({ id: `l-${n}`, name: n })),
    },
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function pageResp(nodes: ReturnType<typeof issueNode>[], hasNext = false) {
  return {
    issues: {
      nodes,
      pageInfo: { hasNextPage: hasNext, endCursor: hasNext ? "c" : null },
    },
  };
}

describe("isHumanStatusFilter", () => {
  it("accepts the shared lifecycle vocabulary", () => {
    expect(isHumanStatusFilter("open")).toBe(true);
    expect(isHumanStatusFilter("in_progress")).toBe(true);
    expect(isHumanStatusFilter("closed")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isHumanStatusFilter("Open")).toBe(false);
  });
});

describe("listHumanIssues — projection", () => {
  it("maps GraphQL nodes to flattened payload with status + labels", async () => {
    const client = makeClient(() =>
      pageResp([
        issueNode({ id: "1", type: "started", labels: ["human", "bug"] }),
      ]),
    );
    const out = await listHumanIssues({ client });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "1",
      identifier: "TEST-1",
      title: "Issue 1",
      status: "started",
      status_type: "started",
      team_key: "TEST",
      priority: 2,
      labels: ["human", "bug"],
    });
  });
});

describe("listHumanIssues — status filter", () => {
  it("returns all by default (no filter)", async () => {
    const client = makeClient(() =>
      pageResp([
        issueNode({ id: "1", type: "started" }),
        issueNode({ id: "2", type: "completed" }),
        issueNode({ id: "3", type: "canceled" }),
        issueNode({ id: "4", type: "backlog" }),
      ]),
    );
    const out = await listHumanIssues({ client });
    expect(out.map((i) => i.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("--status open keeps only triage/backlog/unstarted", async () => {
    const client = makeClient(() =>
      pageResp([
        issueNode({ id: "1", type: "started" }),
        issueNode({ id: "2", type: "completed" }),
        issueNode({ id: "3", type: "canceled" }),
        issueNode({ id: "4", type: "backlog" }),
      ]),
    );
    const out = await listHumanIssues({ client, status: "open" });
    expect(out.map((i) => i.id)).toEqual(["4"]);
  });

  it("--status in_progress keeps started issues", async () => {
    const client = makeClient(() =>
      pageResp([
        issueNode({ id: "1", type: "started" }),
        issueNode({ id: "2", type: "unstarted" }),
        issueNode({ id: "3", type: "completed" }),
      ]),
    );
    const out = await listHumanIssues({ client, status: "in_progress" });
    expect(out.map((issue) => issue.id)).toEqual(["1"]);
  });

  it("--status closed keeps all terminal types", async () => {
    const client = makeClient(() =>
      pageResp([
        issueNode({ id: "1", type: "started" }),
        issueNode({ id: "2", type: "completed" }),
        issueNode({ id: "3", type: "canceled" }),
        issueNode({ id: "4", type: "duplicate" }),
      ]),
    );
    const out = await listHumanIssues({ client, status: "closed" });
    expect(out.map((i) => i.id)).toEqual(["2", "3", "4"]);
  });
});

describe("listHumanIssues — pagination", () => {
  it("walks pages while hasNextPage is true", async () => {
    let page = 0;
    const client = makeClient(() => {
      page += 1;
      if (page === 1) {
        return pageResp([issueNode({ id: "1", type: "started" })], true);
      }
      return pageResp([issueNode({ id: "2", type: "completed" })], false);
    });
    const out = await listHumanIssues({ client });
    expect(out).toHaveLength(2);
  });
});

describe("getHumanIssueSnapshot", () => {
  it("returns the lean shape needed by respond / dismiss", async () => {
    const client = makeDispatcher({
      GetHumanIssueById: () => ({
        issue: issueNode({ id: "x", type: "started", labels: ["human"] }),
      }),
    });
    const snap = await getHumanIssueSnapshot(client, "x");
    expect(snap).toEqual({
      id: "x",
      identifier: "TEST-x",
      team_id: "t-1",
      team_key: "TEST",
      state_type: "started",
      has_human_label: true,
    });
  });

  it("reports has_human_label=false when label is missing", async () => {
    const client = makeDispatcher({
      GetHumanIssueById: () => ({
        issue: issueNode({ id: "x", type: "started", labels: ["bug"] }),
      }),
    });
    const snap = await getHumanIssueSnapshot(client, "x");
    expect(snap.has_human_label).toBe(false);
  });

  it("throws if the issue is not found", async () => {
    const client = makeDispatcher({
      GetHumanIssueById: () => ({ issue: null }),
    });
    await expect(getHumanIssueSnapshot(client, "ghost")).rejects.toThrow(
      /not found/,
    );
  });
});

describe("respondHumanIssue", () => {
  it("comments with `Response:` prefix and updates the state", async () => {
    const client = makeDispatcher({
      GetHumanIssueById: () => ({
        issue: issueNode({ id: "x", type: "started" }),
      }),
      CreateComment: () => ({
        commentCreate: { success: true, comment: { id: "c-1" } },
      }),
      UpdateIssue: () => ({
        issueUpdate: { success: true, issue: { id: "x" } },
      }),
    });
    const r = await respondHumanIssue({
      client,
      issueId: "x",
      stateId: "s-completed",
      response: "Use OAuth2",
    });
    expect(r.action).toBe("responded");
    expect(r.comment_id).toBe("c-1");
    expect(r.state_id).toBe("s-completed");
    expect(r.had_human_label).toBe(true);
  });

  it("refuses to act on an already-closed issue", async () => {
    const client = makeDispatcher({
      GetHumanIssueById: () => ({
        issue: issueNode({ id: "x", type: "completed" }),
      }),
    });
    await expect(
      respondHumanIssue({
        client,
        issueId: "x",
        stateId: "s",
        response: "late",
      }),
    ).rejects.toThrow(/already closed/);
  });
});

describe("dismissHumanIssue", () => {
  it("comments with `Dismissed:` prefix when a reason is given", async () => {
    const client = makeDispatcher({
      GetHumanIssueById: () => ({
        issue: issueNode({ id: "x", type: "started" }),
      }),
      CreateComment: () => ({
        commentCreate: { success: true, comment: { id: "c-2" } },
      }),
      UpdateIssue: () => ({
        issueUpdate: { success: true, issue: { id: "x" } },
      }),
    });
    const r = await dismissHumanIssue({
      client,
      issueId: "x",
      stateId: "s-canceled",
      reason: "no longer applicable",
    });
    expect(r.action).toBe("dismissed");
    expect(r.comment_id).toBe("c-2");
  });

  it("skips the comment when no reason is given", async () => {
    const calls: string[] = [];
    const client = {
      request: vi.fn(async (doc: unknown) => {
        if (isOpNamed(doc, "GetHumanIssueById")) {
          calls.push("get");
          return { issue: issueNode({ id: "x", type: "started" }) };
        }
        if (isOpNamed(doc, "CreateComment")) {
          calls.push("comment");
          return { commentCreate: { success: true, comment: { id: "c" } } };
        }
        if (isOpNamed(doc, "UpdateIssue")) {
          calls.push("update");
          return { issueUpdate: { success: true, issue: { id: "x" } } };
        }
        throw new Error("unexpected op");
      }),
    } as unknown as GraphQLClient;
    const r = await dismissHumanIssue({
      client,
      issueId: "x",
      stateId: "s-canceled",
    });
    expect(r.comment_id).toBeNull();
    expect(calls).toEqual(["get", "update"]);
  });

  it("refuses to act on an already-closed issue", async () => {
    const client = makeDispatcher({
      GetHumanIssueById: () => ({
        issue: issueNode({ id: "x", type: "canceled" }),
      }),
    });
    await expect(
      dismissHumanIssue({ client, issueId: "x", stateId: "s" }),
    ).rejects.toThrow(/already closed/);
  });
});

describe("summarizeHumanIssues / humanStats", () => {
  it("counts terminal types correctly", () => {
    const issues = [
      { status_type: "started" },
      { status_type: "completed" },
      { status_type: "completed" },
      { status_type: "canceled" },
      { status_type: "backlog" },
      { status_type: "duplicate" },
    ] as Parameters<typeof summarizeHumanIssues>[0];
    expect(summarizeHumanIssues(issues)).toEqual({
      total: 6,
      pending: 2,
      responded: 2,
      dismissed: 2,
    });
  });

  it("humanStats wires through listHumanIssues", async () => {
    const client = makeClient(() =>
      pageResp([
        issueNode({ id: "1", type: "started" }),
        issueNode({ id: "2", type: "completed" }),
      ]),
    );
    const stats = await humanStats({ client });
    expect(stats).toEqual({
      total: 2,
      pending: 1,
      responded: 1,
      dismissed: 0,
    });
  });
});
