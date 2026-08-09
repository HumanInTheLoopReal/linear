import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  addLabelToIssues,
  createWorkspaceLabel,
  ensureLabelForIssueTeam,
  ensureWorkspaceLabel,
  ensureWorkspaceLabelIds,
  getLabelsForIssue,
  listLabels,
  listProjectLabels,
  propagateLabelToChildren,
  removeLabelFromIssues,
  updateWorkspaceLabel,
} from "../../../src/services/label-service.js";

function mockGqlClient(response: Record<string, unknown>): GraphQLClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  } as unknown as GraphQLClient;
}

describe("listLabels", () => {
  it("returns issue labels with type", async () => {
    const client = mockGqlClient({
      issueLabels: {
        nodes: [
          { id: "lbl-1", name: "Bug", color: "#ff0000", description: "A bug" },
        ],
        pageInfo: { hasNextPage: false, endCursor: "c1" },
      },
    });

    const result = await listLabels(client);

    expect(result.nodes).toEqual([
      {
        id: "lbl-1",
        name: "Bug",
        color: "#ff0000",
        description: "A bug",
        type: "issue",
      },
    ]);
    expect(result.pageInfo).toEqual({ hasNextPage: false, endCursor: "c1" });
  });

  it("returns empty result", async () => {
    const client = mockGqlClient({
      issueLabels: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const result = await listLabels(client);

    expect(result.nodes).toEqual([]);
    expect(result.pageInfo.hasNextPage).toBe(false);
  });

  it("passes after cursor", async () => {
    const client = mockGqlClient({
      issueLabels: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    await listLabels(client, undefined, { after: "cur1" });

    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      first: 50,
      after: "cur1",
      filter: undefined,
    });
  });

  it("uses default limit of 50", async () => {
    const client = mockGqlClient({
      issueLabels: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    await listLabels(client);

    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      first: 50,
      after: undefined,
      filter: undefined,
    });
  });

  it("filters by team when teamId provided", async () => {
    const client = mockGqlClient({
      issueLabels: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    await listLabels(client, "team-1");

    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      first: 50,
      after: undefined,
      filter: { team: { id: { eq: "team-1" } } },
    });
  });

  it("filters workspace issue labels by null team", async () => {
    const client = mockGqlClient({
      issueLabels: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    await listLabels(client, undefined, { scope: "workspace" });

    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      first: 50,
      after: undefined,
      filter: { team: { null: true } },
    });
  });

  it("keeps team scope on the resolved team filter", async () => {
    const client = mockGqlClient({
      issueLabels: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    await listLabels(client, "team-1", { scope: "team" });

    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      first: 50,
      after: undefined,
      filter: { team: { id: { eq: "team-1" }, null: false } },
    });
  });

  it("converts null description to undefined", async () => {
    const client = mockGqlClient({
      issueLabels: {
        nodes: [
          { id: "lbl-2", name: "Feature", color: "#00ff00", description: null },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const result = await listLabels(client);

    expect(result.nodes[0].description).toBeUndefined();
    expect(result.nodes[0].type).toBe("issue");
  });
});

describe("listProjectLabels", () => {
  it("returns project labels with type", async () => {
    const client = mockGqlClient({
      projectLabels: {
        nodes: [
          {
            id: "plbl-1",
            name: "Customer",
            color: "#0000ff",
            description: "Customer-facing",
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: "p1" },
      },
    });

    const result = await listProjectLabels(client);

    expect(result.nodes).toEqual([
      {
        id: "plbl-1",
        name: "Customer",
        color: "#0000ff",
        description: "Customer-facing",
        type: "project",
      },
    ]);
    expect(result.pageInfo).toEqual({ hasNextPage: false, endCursor: "p1" });
  });

  it("uses default limit of 50", async () => {
    const client = mockGqlClient({
      projectLabels: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    await listProjectLabels(client);

    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      first: 50,
      after: undefined,
    });
  });

  it("passes pagination without filter", async () => {
    const client = mockGqlClient({
      projectLabels: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    await listProjectLabels(client, { limit: 25, after: "cur2" });

    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      first: 25,
      after: "cur2",
    });
  });

  it("converts null description to undefined", async () => {
    const client = mockGqlClient({
      projectLabels: {
        nodes: [
          {
            id: "plbl-2",
            name: "Internal",
            color: "#123456",
            description: null,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const result = await listProjectLabels(client);

    expect(result.nodes[0].description).toBeUndefined();
    expect(result.nodes[0].type).toBe("project");
  });
});

// lin-s9hs: createWorkspaceLabel differs from ensureWorkspaceLabel in that
// it reports whether the label was actually created or merely found. The
// `linear labels create` command uses the bool to print a different status
// line for each case.
describe("createWorkspaceLabel", () => {
  it("returns created=false when the label already exists", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: { nodes: [{ id: "l-existing", name: "bug" }] },
    });
    const client = { request } as unknown as GraphQLClient;

    const result = await createWorkspaceLabel(client, "bug", "A bug.");

    expect(result).toEqual({ id: "l-existing", name: "bug", created: false });
    // One lookup call; create mutation must NOT fire.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("creates the label and returns created=true when missing", async () => {
    const request = vi
      .fn()
      // First lookup in createWorkspaceLabel: not found.
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      // Second lookup in ensureWorkspaceLabel: also not found.
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      // Create mutation: success.
      .mockResolvedValueOnce({
        issueLabelCreate: {
          success: true,
          issueLabel: { id: "l-new", name: "Bug" },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    const result = await createWorkspaceLabel(client, "Bug", "A bug.");

    expect(result).toEqual({ id: "l-new", name: "Bug", created: true });
  });

  it("treats case-insensitive name match as existing (no create)", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: { nodes: [{ id: "l-cap", name: "Bug" }] },
    });
    const client = { request } as unknown as GraphQLClient;

    const result = await createWorkspaceLabel(client, "bug", "A bug.");

    expect(result.created).toBe(false);
    expect(result.id).toBe("l-cap");
  });
});

describe("ensureWorkspaceLabel", () => {
  it("reuses an existing label without calling the create mutation", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: {
        nodes: [{ id: "l-existing", name: "type:task" }],
      },
    });
    const client = { request } as unknown as GraphQLClient;
    const id = await ensureWorkspaceLabel(
      client,
      "type:task",
      "Issue type 'task'.",
    );
    expect(id).toBe("l-existing");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing label with different casing (eqIgnoreCase)", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: {
        nodes: [{ id: "l-existing", name: "Bug" }],
      },
    });
    const client = { request } as unknown as GraphQLClient;
    const id = await ensureWorkspaceLabel(client, "bug", "desc");
    expect(id).toBe("l-existing");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.anything(), {
      first: 50,
      filter: { name: { eqIgnoreCase: "bug" } },
    });
  });

  it("creates the label when no match is found", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      .mockResolvedValueOnce({
        issueLabelCreate: {
          success: true,
          issueLabel: { id: "l-new", name: "type:task" },
        },
      });
    const client = { request } as unknown as GraphQLClient;
    const id = await ensureWorkspaceLabel(client, "type:task", "desc");
    expect(id).toBe("l-new");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("throws when label creation fails", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      .mockResolvedValueOnce({
        issueLabelCreate: { success: false, issueLabel: null },
      });
    const client = { request } as unknown as GraphQLClient;
    await expect(
      ensureWorkspaceLabel(client, "type:task", "desc"),
    ).rejects.toThrow(/failed to create label 'type:task'/);
  });

  it("recovers from 'already exists' by re-querying with includeArchived", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      .mockRejectedValueOnce(
        new Error(
          'GraphQL request failed: Duplicate label name - Label "Bug" already exists in the workspace.',
        ),
      )
      .mockResolvedValueOnce({
        issueLabels: {
          nodes: [{ id: "l-archived", name: "Bug" }],
        },
      });
    const client = { request } as unknown as GraphQLClient;
    const id = await ensureWorkspaceLabel(client, "bug", "desc");
    expect(id).toBe("l-archived");
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenLastCalledWith(expect.anything(), {
      first: 50,
      filter: { name: { eqIgnoreCase: "bug" } },
      includeArchived: true,
    });
  });

  it("rethrows non-'already exists' errors without retrying", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      .mockRejectedValueOnce(new Error("Network error"));
    const client = { request } as unknown as GraphQLClient;
    await expect(ensureWorkspaceLabel(client, "bug", "desc")).rejects.toThrow(
      /Network error/,
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rethrows 'already exists' when the archived re-lookup also returns nothing", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      .mockRejectedValueOnce(new Error("Label already exists"))
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } });
    const client = { request } as unknown as GraphQLClient;
    await expect(ensureWorkspaceLabel(client, "bug", "desc")).rejects.toThrow(
      /already exists/,
    );
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe("ensureWorkspaceLabelIds", () => {
  it("passes UUIDs through, ignores blanks, and resolves names in order", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: { nodes: [{ id: "l-bug", name: "Bug" }] },
    });
    const client = { request } as unknown as GraphQLClient;
    const uuid = "550e8400-e29b-41d4-a716-446655440000";

    const result = await ensureWorkspaceLabelIds(client, ["  ", uuid, " Bug "]);

    expect(result).toEqual([uuid, "l-bug"]);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(expect.anything(), {
      first: 50,
      filter: { name: { eqIgnoreCase: "Bug" } },
    });
  });
});

describe("ensureLabelForIssueTeam (lin-ay7q: team-scope inference)", () => {
  it("reuses a label already scoped to the issue's team in one query", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: { nodes: [{ id: "l-team", name: "backlog" }] },
    });
    const client = { request } as unknown as GraphQLClient;
    const id = await ensureLabelForIssueTeam(
      client,
      "backlog",
      "team-ENG",
      "Label 'backlog'.",
    );
    expect(id).toBe("l-team");
    // Single query, narrowed to the issue's team and non-null (team-scoped).
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.anything(), {
      first: 50,
      filter: {
        name: { eqIgnoreCase: "backlog" },
        team: { id: { eq: "team-ENG" }, null: false },
      },
    });
  });

  it("matches the team-scoped label case-insensitively", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: { nodes: [{ id: "l-team", name: "Backlog" }] },
    });
    const client = { request } as unknown as GraphQLClient;
    const id = await ensureLabelForIssueTeam(
      client,
      "backlog",
      "team-ENG",
      "desc",
    );
    expect(id).toBe("l-team");
  });

  it("falls back to the workspace find-or-create when no team label exists", async () => {
    const request = vi
      .fn()
      // 1. team-scoped probe → empty
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      // 2. ensureWorkspaceLabel lookup → existing workspace label
      .mockResolvedValueOnce({
        issueLabels: { nodes: [{ id: "l-workspace", name: "backlog" }] },
      });
    const client = { request } as unknown as GraphQLClient;
    const id = await ensureLabelForIssueTeam(
      client,
      "backlog",
      "team-ENG",
      "desc",
    );
    expect(id).toBe("l-workspace");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("creates the label workspace-wide when it exists nowhere", async () => {
    const request = vi
      .fn()
      // 1. team-scoped probe → empty
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      // 2. ensureWorkspaceLabel lookup → empty
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      // 3. create mutation
      .mockResolvedValueOnce({
        issueLabelCreate: {
          success: true,
          issueLabel: { id: "l-new", name: "backlog" },
        },
      });
    const client = { request } as unknown as GraphQLClient;
    const id = await ensureLabelForIssueTeam(
      client,
      "backlog",
      "team-ENG",
      "desc",
    );
    expect(id).toBe("l-new");
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe("getLabelsForIssue", () => {
  it("returns sorted label names", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issue: {
        id: "i-1",
        identifier: "ENG-1",
        labels: {
          nodes: [
            { id: "l-2", name: "zebra" },
            { id: "l-1", name: "alpha" },
          ],
        },
      },
    });
    const client = { request } as unknown as GraphQLClient;
    const result = await getLabelsForIssue(client, "i-1");
    expect(result).toEqual(["alpha", "zebra"]);
  });

  it("returns empty array when issue has no labels", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issue: { id: "i-1", identifier: "ENG-1", labels: { nodes: [] } },
    });
    const client = { request } as unknown as GraphQLClient;
    const result = await getLabelsForIssue(client, "i-1");
    expect(result).toEqual([]);
  });
});

describe("addLabelToIssues", () => {
  it("adds label and returns changed=true when issue lacks it", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        issue: {
          id: "i-1",
          identifier: "ENG-1",
          labels: { nodes: [{ id: "l-existing", name: "x" }] },
        },
      })
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "i-1", identifier: "ENG-1" },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    const results = await addLabelToIssues(client, ["i-1"], "l-bug", "bug");

    expect(results).toEqual([
      {
        status: "added",
        issue_id: "i-1",
        issue_identifier: "ENG-1",
        label: "bug",
        changed: true,
      },
    ]);
    expect(request.mock.calls[1][1]).toEqual({
      id: "i-1",
      input: { labelIds: ["l-existing", "l-bug"] },
    });
  });

  it("reports changed=false and skips updateIssue when label already present", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issue: {
        id: "i-1",
        identifier: "ENG-1",
        labels: { nodes: [{ id: "l-bug", name: "bug" }] },
      },
    });
    const client = { request } as unknown as GraphQLClient;

    const results = await addLabelToIssues(client, ["i-1"], "l-bug", "bug");

    expect(results[0].changed).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("processes multiple issues independently", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        issue: { id: "i-1", identifier: "ENG-1", labels: { nodes: [] } },
      })
      .mockResolvedValueOnce({
        issueUpdate: { success: true, issue: { id: "i-1" } },
      })
      .mockResolvedValueOnce({
        issue: {
          id: "i-2",
          identifier: "ENG-2",
          labels: { nodes: [{ id: "l-bug", name: "bug" }] },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    const results = await addLabelToIssues(
      client,
      ["i-1", "i-2"],
      "l-bug",
      "bug",
    );

    expect(results).toEqual([
      {
        status: "added",
        issue_id: "i-1",
        issue_identifier: "ENG-1",
        label: "bug",
        changed: true,
      },
      {
        status: "added",
        issue_id: "i-2",
        issue_identifier: "ENG-2",
        label: "bug",
        changed: false,
      },
    ]);
  });
});

describe("removeLabelFromIssues", () => {
  it("removes label and returns changed=true when issue had it", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        issue: {
          id: "i-1",
          identifier: "ENG-1",
          labels: {
            nodes: [
              { id: "l-bug", name: "bug" },
              { id: "l-other", name: "other" },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        issueUpdate: { success: true, issue: { id: "i-1" } },
      });
    const client = { request } as unknown as GraphQLClient;

    const results = await removeLabelFromIssues(
      client,
      ["i-1"],
      "l-bug",
      "bug",
    );

    expect(results[0]).toEqual({
      status: "removed",
      issue_id: "i-1",
      issue_identifier: "ENG-1",
      label: "bug",
      changed: true,
    });
    expect(request.mock.calls[1][1]).toEqual({
      id: "i-1",
      input: { labelIds: ["l-other"] },
    });
  });

  it("reports changed=false and skips update when label not on issue", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issue: {
        id: "i-1",
        identifier: "ENG-1",
        labels: { nodes: [{ id: "l-other", name: "other" }] },
      },
    });
    const client = { request } as unknown as GraphQLClient;

    const results = await removeLabelFromIssues(
      client,
      ["i-1"],
      "l-bug",
      "bug",
    );

    expect(results[0].changed).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("propagateLabelToChildren", () => {
  it("applies label to every child that lacks it", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        issues: {
          nodes: [
            { id: "c-1", identifier: "ENG-2", labels: { nodes: [] } },
            {
              id: "c-2",
              identifier: "ENG-3",
              labels: { nodes: [{ id: "l-bug", name: "bug" }] },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      })
      .mockResolvedValueOnce({
        issueUpdate: { success: true, issue: { id: "c-1" } },
      });
    const client = { request } as unknown as GraphQLClient;

    const results = await propagateLabelToChildren(
      client,
      "parent-uuid",
      "l-bug",
      "bug",
    );

    expect(request).toHaveBeenNthCalledWith(1, expect.anything(), {
      first: 250,
      after: undefined,
      filter: { and: [{ parent: { id: { eq: "parent-uuid" } } }] },
      orderBy: "updatedAt",
      includeArchived: false,
    });

    expect(results).toEqual([
      {
        status: "propagated",
        issue_id: "c-1",
        issue_identifier: "ENG-2",
        label: "bug",
        changed: true,
      },
      {
        status: "propagated",
        issue_id: "c-2",
        issue_identifier: "ENG-3",
        label: "bug",
        changed: false,
      },
    ]);
  });

  it("returns empty array when parent has no children", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issues: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });
    const client = { request } as unknown as GraphQLClient;

    const results = await propagateLabelToChildren(
      client,
      "parent-uuid",
      "l-bug",
      "bug",
    );

    expect(results).toEqual([]);
  });
});

describe("updateWorkspaceLabel", () => {
  it("sends only the fields given and returns the updated label", async () => {
    const client = mockGqlClient({
      issueLabelUpdate: {
        success: true,
        issueLabel: {
          id: "label-1",
          name: "renamed",
          color: "#fff",
          description: "kept",
        },
      },
    });

    const result = await updateWorkspaceLabel(client, "label-1", {
      name: "renamed",
    });

    expect(result).toEqual({
      id: "label-1",
      name: "renamed",
      description: "kept",
    });
    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      id: "label-1",
      input: { name: "renamed" },
    });
  });

  it("throws when the update fails", async () => {
    const client = mockGqlClient({
      issueLabelUpdate: { success: false, issueLabel: null },
    });

    await expect(
      updateWorkspaceLabel(client, "label-1", { name: "renamed" }),
    ).rejects.toThrow("Failed to update label");
  });
});
