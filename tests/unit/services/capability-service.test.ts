import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { shipCapability } from "../../../src/services/capability-service.js";
import * as issueService from "../../../src/services/issue-service.js";

vi.mock("../../../src/services/issue-service.js", () => ({
  updateIssue: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function makeClient(responses: unknown[]): GraphQLClient {
  const request = vi.fn();
  for (const r of responses) request.mockResolvedValueOnce(r);
  return { request } as unknown as GraphQLClient;
}

function shipCandidate(opts: {
  id?: string;
  identifier?: string;
  stateType?: string;
  stateName?: string;
  labels?: Array<{ id: string; name: string }>;
}) {
  return {
    id: opts.id ?? "issue-1",
    identifier: opts.identifier ?? "ENG-1",
    title: "Some title",
    state: {
      id: "s",
      name: opts.stateName ?? "Done",
      type: opts.stateType ?? "completed",
    },
    team: { id: "team-a", key: "ENG", name: "Eng" },
    labels: {
      nodes: opts.labels ?? [{ id: "l-export", name: "export:foo" }],
    },
  };
}

function issuesPage(nodes: ReturnType<typeof shipCandidate>[]) {
  return {
    issues: {
      nodes,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

describe("shipCapability", () => {
  it("ships a completed issue: ensures provides-label, then updates labels", async () => {
    const issue = shipCandidate({});
    const client = makeClient([
      // FindIssuesByLabelName
      issuesPage([issue]),
      // GetLabels for provides:foo → empty (label doesn't exist yet)
      { issueLabels: { nodes: [] } },
      // CreateIssueLabel for provides:foo
      {
        issueLabelCreate: {
          success: true,
          issueLabel: { id: "l-provides", name: "provides:foo" },
        },
      },
    ]);
    const updateMock = vi
      .mocked(issueService.updateIssue)
      .mockResolvedValueOnce({ id: "issue-1" } as never);

    const result = await shipCapability(client, "foo", {
      force: false,
      dryRun: false,
    });

    expect(result.status).toBe("shipped");
    expect(result.capability).toBe("foo");
    expect(result.issue_id).toBe("issue-1");
    expect(result.label).toBe("provides:foo");
    expect(updateMock).toHaveBeenCalledWith(client, "issue-1", {
      labelIds: expect.arrayContaining(["l-export", "l-provides"]),
    });
  });

  it("reuses an existing provides-label rather than recreating it", async () => {
    const issue = shipCandidate({});
    const client = makeClient([
      issuesPage([issue]),
      // GetLabels for provides:foo → already exists
      {
        issueLabels: {
          nodes: [{ id: "l-provides", name: "provides:foo", color: "#000" }],
        },
      },
    ]);
    vi.mocked(issueService.updateIssue).mockResolvedValueOnce({
      id: "issue-1",
    } as never);

    const result = await shipCapability(client, "foo", {
      force: false,
      dryRun: false,
    });
    expect(result.status).toBe("shipped");
    // Only 2 GraphQL requests (find + getLabels), no CreateIssueLabel.
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      2,
    );
  });

  it("returns already_shipped when the provides-label is already attached", async () => {
    const issue = shipCandidate({
      labels: [
        { id: "l-export", name: "export:foo" },
        { id: "l-provides-existing", name: "provides:foo" },
      ],
    });
    const client = makeClient([issuesPage([issue])]);

    const result = await shipCapability(client, "foo", {
      force: false,
      dryRun: false,
    });

    expect(result.status).toBe("already_shipped");
    expect(result.label).toBeUndefined();
    expect(issueService.updateIssue).not.toHaveBeenCalled();
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      1,
    );
  });

  it("returns dry_run without writing", async () => {
    const issue = shipCandidate({});
    const client = makeClient([issuesPage([issue])]);

    const result = await shipCapability(client, "foo", {
      force: false,
      dryRun: true,
    });

    expect(result.status).toBe("dry_run");
    expect(result.would_add).toBe("provides:foo");
    expect(issueService.updateIssue).not.toHaveBeenCalled();
  });

  it("throws when no issue carries the export label", async () => {
    const client = makeClient([issuesPage([])]);
    await expect(
      shipCapability(client, "foo", { force: false, dryRun: false }),
    ).rejects.toThrow(/no issue found with label 'export:foo'/);
  });

  it("throws when multiple issues carry the export label", async () => {
    const client = makeClient([
      issuesPage([
        shipCandidate({ id: "i-1", identifier: "ENG-1" }),
        shipCandidate({ id: "i-2", identifier: "ENG-2" }),
      ]),
    ]);
    await expect(
      shipCapability(client, "foo", { force: false, dryRun: false }),
    ).rejects.toThrow(/multiple issues carry label 'export:foo'/);
  });

  it("rejects an unfinished issue without --force", async () => {
    const issue = shipCandidate({
      stateType: "started",
      stateName: "In Progress",
    });
    const client = makeClient([issuesPage([issue])]);

    await expect(
      shipCapability(client, "foo", { force: false, dryRun: false }),
    ).rejects.toThrow(/not completed/);
  });

  it("--force bypasses the completed-state gate", async () => {
    const issue = shipCandidate({
      stateType: "started",
      stateName: "In Progress",
    });
    const client = makeClient([
      issuesPage([issue]),
      { issueLabels: { nodes: [] } },
      {
        issueLabelCreate: {
          success: true,
          issueLabel: { id: "l-provides", name: "provides:foo" },
        },
      },
    ]);
    vi.mocked(issueService.updateIssue).mockResolvedValueOnce({
      id: "issue-1",
    } as never);

    const result = await shipCapability(client, "foo", {
      force: true,
      dryRun: false,
    });
    expect(result.status).toBe("shipped");
  });

  it("throws when label-create reports failure", async () => {
    const issue = shipCandidate({});
    const client = makeClient([
      issuesPage([issue]),
      { issueLabels: { nodes: [] } },
      { issueLabelCreate: { success: false, issueLabel: null } },
    ]);

    await expect(
      shipCapability(client, "foo", { force: false, dryRun: false }),
    ).rejects.toThrow(/failed to create label 'provides:foo'/);
  });
});
