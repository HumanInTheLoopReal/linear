import { describe, expect, it, vi } from "vitest";
import type { LinearSdkClient } from "../../../src/client/linear-client.js";
import {
  normalizeBatchOps,
  parseBatchScript,
} from "../../../src/common/batch-script.js";
import { resolveBatchOps } from "../../../src/resolvers/batch-resolver.js";

function mockSdkClient(
  overrides: {
    issues?: ReturnType<typeof vi.fn>;
    workflowStates?: ReturnType<typeof vi.fn>;
    users?: ReturnType<typeof vi.fn>;
    issueLabels?: ReturnType<typeof vi.fn>;
  } = {},
): LinearSdkClient {
  return {
    sdk: {
      issues: overrides.issues ?? vi.fn(),
      workflowStates: overrides.workflowStates ?? vi.fn(),
      users: overrides.users ?? vi.fn(),
      issueLabels:
        overrides.issueLabels ?? vi.fn().mockResolvedValue({ nodes: [] }),
    },
  } as unknown as LinearSdkClient;
}

function normalized(script: string, hasDefaultTeam = false) {
  return normalizeBatchOps(parseBatchScript(script), { hasDefaultTeam });
}

describe("resolveBatchOps", () => {
  it("resolves close issue, team, and completed state before execution", async () => {
    const issues = vi.fn().mockResolvedValue({
      nodes: [
        {
          id: "issue-uuid",
          team: { id: "00000000-0000-4000-8000-000000000001" },
        },
      ],
    });
    const workflowStates = vi.fn().mockResolvedValue({
      nodes: [{ id: "completed-state" }],
    });
    const client = mockSdkClient({ issues, workflowStates });

    const result = await resolveBatchOps(
      client,
      normalized('close LIN-1 "done now"'),
    );

    expect(result).toEqual([
      {
        line: 1,
        raw: 'close LIN-1 "done now"',
        cmd: "close",
        target: "LIN-1",
        issueId: "issue-uuid",
        stateId: "completed-state",
        reason: "done now",
      },
    ]);
    expect(workflowStates).toHaveBeenCalledWith({
      filter: {
        team: { id: { eq: "00000000-0000-4000-8000-000000000001" } },
        type: { eq: "completed" },
      },
      first: 1,
    });
  });

  it("resolves update state and assignee to UUIDs", async () => {
    const client = mockSdkClient({
      issues: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: "issue-uuid",
            team: { id: "00000000-0000-4000-8000-000000000001" },
          },
        ],
      }),
      workflowStates: vi.fn().mockResolvedValue({
        nodes: [{ id: "custom-state" }],
      }),
      users: vi.fn().mockResolvedValue({
        nodes: [{ id: "user-uuid", name: "Alex", email: "alex@example.com" }],
      }),
    });

    const [result] = await resolveBatchOps(
      client,
      normalized(
        "update LIN-2 status=Review assignee=alex@example.com priority=P2",
      ),
    );

    expect(result).toMatchObject({
      cmd: "update",
      issueId: "issue-uuid",
      input: {
        stateId: "custom-state",
        assigneeId: "user-uuid",
        priority: 2,
      },
    });
  });

  it("reuses issue, state, and user lookups across repeated operations", async () => {
    const issues = vi.fn().mockResolvedValue({
      nodes: [
        {
          id: "issue-uuid",
          team: { id: "00000000-0000-4000-8000-000000000001" },
        },
      ],
    });
    const workflowStates = vi.fn().mockResolvedValue({
      nodes: [{ id: "review-state" }],
    });
    const users = vi.fn().mockResolvedValue({
      nodes: [{ id: "user-uuid", name: "Alex", email: "alex@example.com" }],
    });
    const client = mockSdkClient({ issues, workflowStates, users });

    await resolveBatchOps(
      client,
      normalized(
        [
          "update LIN-2 status=Review assignee=Alex",
          "update lin-2 title=Renamed assignee=alex",
          "update LIN-2 status=review",
        ].join("\n"),
      ),
    );

    expect(issues).toHaveBeenCalledTimes(1);
    expect(workflowStates).toHaveBeenCalledTimes(1);
    expect(users).toHaveBeenCalledTimes(1);
  });

  it("resolves an existing type label for create input", async () => {
    const issues = vi.fn();
    const issueLabels = vi
      .fn()
      .mockResolvedValue({ nodes: [{ id: "type-task-label" }] });
    const client = mockSdkClient({ issues, issueLabels });

    const result = await resolveBatchOps(
      client,
      normalized('create task P1 "Urgent issue"', true),
      { defaultTeamId: "team-uuid" },
    );

    expect(result[0]).toMatchObject({
      cmd: "create",
      teamId: "team-uuid",
      issueType: "task",
      title: "Urgent issue",
      priority: 1,
      labelIds: ["type-task-label"],
    });
    expect(issues).not.toHaveBeenCalled();
    expect(issueLabels).toHaveBeenCalledWith({
      filter: {
        name: { eqIgnoreCase: "type:task" },
        team: { null: true },
      },
      first: 1,
    });
  });

  it("omits the type label when no matching workspace label exists", async () => {
    const result = await resolveBatchOps(
      mockSdkClient(),
      normalized('create custom P3 "Custom issue"', true),
      { defaultTeamId: "team-uuid" },
    );

    expect(result[0]).toMatchObject({
      cmd: "create",
      issueType: "custom",
      title: "Custom issue",
    });
    expect(result[0]).not.toHaveProperty("labelIds");
  });

  it.each([
    "0",
    "2junk",
    "5",
  ])("rejects invalid create priority %s before SDK calls", async (priority) => {
    const issues = vi.fn();
    const client = mockSdkClient({ issues });

    await expect(
      Promise.resolve().then(() =>
        resolveBatchOps(
          client,
          normalized(`create task ${priority} "Bad priority"`, true),
          { defaultTeamId: "team-uuid" },
        ),
      ),
    ).rejects.toThrow(/line 1.*must be 1-4/);
    expect(issues).not.toHaveBeenCalled();
  });

  it("requires a default team for create operations", async () => {
    await expect(
      Promise.resolve().then(() =>
        resolveBatchOps(
          mockSdkClient(),
          normalized('create task 2 "Missing team"', true),
        ),
      ),
    ).rejects.toThrow(/line 1.*requires --team/);
  });

  it("rejects an invalid dependency type before resolving endpoints", async () => {
    const issues = vi.fn();
    const client = mockSdkClient({ issues });

    await expect(
      Promise.resolve().then(() =>
        resolveBatchOps(client, normalized("dep add LIN-1 LIN-2 nonsense")),
      ),
    ).rejects.toThrow(/line 1.*invalid dependency type 'nonsense'/);
    expect(issues).not.toHaveBeenCalled();
  });
});
