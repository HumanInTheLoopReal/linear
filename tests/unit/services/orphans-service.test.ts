import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();
  return {
    ...actual,
    promisify:
      (fn: typeof execFileMock) =>
      async (cmd: string, args: string[], opts?: unknown) => {
        return new Promise((resolve, reject) => {
          fn(cmd, args, opts, (err: Error | null, stdout: string) => {
            if (err) reject(err);
            else resolve({ stdout, stderr: "" });
          });
        });
      },
  };
});

import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  closeOrphan,
  findOrphanedIssues,
} from "../../../src/services/orphans-service.js";

function mockClient(response: Record<string, unknown>): GraphQLClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  } as unknown as GraphQLClient;
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "i-1",
    identifier: "ENG-1",
    title: "Implement login",
    priority: 2,
    state: { id: "s-open", name: "Backlog", type: "backlog" },
    team: { id: "team-eng", key: "ENG", name: "ENG" },
    labels: { nodes: [] },
    ...overrides,
  };
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe("findOrphanedIssues", () => {
  it("returns issues that appear in git log and are still open", async () => {
    execFileMock
      // git rev-parse --git-dir (success → in repo)
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, ".git\n"))
      // git log
      .mockImplementationOnce((_cmd, _args, _opts, cb) =>
        cb(
          null,
          [
            "abc123 feat: implement ENG-1 login",
            "def456 chore: bump deps",
            "ghi789 fix: tidy ENG-2 edge case",
          ].join("\n"),
        ),
      );

    const client = mockClient({
      issues: {
        nodes: [
          makeIssue({ id: "i-1", identifier: "ENG-1" }),
          makeIssue({ id: "i-2", identifier: "ENG-2" }),
          makeIssue({ id: "i-3", identifier: "ENG-3" }), // never referenced
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const orphans = await findOrphanedIssues(client);

    expect(orphans.map((o) => o.identifier)).toEqual(["ENG-1", "ENG-2"]);
    expect(orphans[0].latest_commit).toBe("abc123");
    expect(orphans[0].latest_commit_message).toBe(
      "feat: implement ENG-1 login",
    );
  });

  it("records only the most-recent commit per orphan (git log lists newest first)", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, ".git\n"))
      .mockImplementationOnce((_cmd, _args, _opts, cb) =>
        cb(
          null,
          ["newest fix: ENG-1 follow-up", "older  feat: ENG-1 initial"].join(
            "\n",
          ),
        ),
      );

    const client = mockClient({
      issues: {
        nodes: [makeIssue({ id: "i-1", identifier: "ENG-1" })],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const orphans = await findOrphanedIssues(client);
    expect(orphans[0].latest_commit).toBe("newest");
  });

  it("returns [] when git rev-parse fails (not a git repo)", async () => {
    execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(new Error("not a git repo")),
    );
    const client = mockClient({
      issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    const orphans = await findOrphanedIssues(client);
    expect(orphans).toEqual([]);
    // Linear request must not have fired when we bailed out early.
    expect(client.request).not.toHaveBeenCalled();
  });

  it("applies AND label filter (labelIds): all listed ids must be attached", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, ".git\n"))
      .mockImplementationOnce((_cmd, _args, _opts, cb) =>
        cb(null, "abc feat: ENG-1 + ENG-2 done"),
      );

    const client = mockClient({
      issues: {
        nodes: [
          makeIssue({
            id: "i-1",
            identifier: "ENG-1",
            labels: { nodes: [{ id: "l-bug", name: "bug" }] },
          }),
          makeIssue({
            id: "i-2",
            identifier: "ENG-2",
            labels: {
              nodes: [
                { id: "l-bug", name: "bug" },
                { id: "l-fe", name: "frontend" },
              ],
            },
          }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const orphans = await findOrphanedIssues(client, {
      labelIds: ["l-bug", "l-fe"],
    });
    expect(orphans.map((o) => o.identifier)).toEqual(["ENG-2"]);
  });

  it("applies OR label filter (labelIdsAny): at least one listed id must be attached", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, ".git\n"))
      .mockImplementationOnce((_cmd, _args, _opts, cb) =>
        cb(null, "abc feat: ENG-1 + ENG-2"),
      );

    const client = mockClient({
      issues: {
        nodes: [
          makeIssue({
            id: "i-1",
            identifier: "ENG-1",
            labels: { nodes: [{ id: "l-fe", name: "frontend" }] },
          }),
          makeIssue({
            id: "i-2",
            identifier: "ENG-2",
            labels: { nodes: [{ id: "l-be", name: "backend" }] },
          }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const orphans = await findOrphanedIssues(client, {
      labelIdsAny: ["l-fe", "l-other"],
    });
    expect(orphans.map((o) => o.identifier)).toEqual(["ENG-1"]);
  });

  it("ignores identifiers in commits that do not correspond to open issues", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, ".git\n"))
      .mockImplementationOnce((_cmd, _args, _opts, cb) =>
        cb(null, "abc feat: implement ENG-99 (closed already)"),
      );

    const client = mockClient({
      issues: {
        nodes: [makeIssue({ id: "i-1", identifier: "ENG-1" })],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const orphans = await findOrphanedIssues(client);
    expect(orphans).toEqual([]);
  });
});

describe("closeOrphan", () => {
  it("updates the issue with a pre-resolved completed-state UUID", async () => {
    const client = mockClient({
      issueUpdate: {
        success: true,
        issue: { id: "i-1", identifier: "ENG-1" },
      },
    });
    const orphan = {
      issue_id: "i-1",
      identifier: "ENG-1",
      title: "Implement login",
      status: "Backlog",
      team_id: "team-eng",
    };

    await closeOrphan(client, orphan, "state-completed");

    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      id: "i-1",
      input: { stateId: "state-completed" },
    });
  });
});
