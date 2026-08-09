import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  createContext: vi.fn(() => ({
    gql: { request: vi.fn() },
    sdk: { sdk: {} },
  })),
  getRootOpts: vi.fn(() => ({ apiToken: "test-token" })),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return {
    ...actual,
    outputSuccess: vi.fn(),
    outputResult: vi.fn(),
  };
});

vi.mock("../../../src/resolvers/label-resolver.js", () => ({
  resolveLabelIds: vi
    .fn()
    .mockImplementation(async (_sdk, names: string[]) =>
      names.map((n) => `lbl-${n}`),
    ),
}));

vi.mock("../../../src/resolvers/status-resolver.js", () => ({
  resolveStateIdByType: vi.fn().mockResolvedValue("completed-state-uuid"),
}));

vi.mock("../../../src/services/orphans-service.js", () => ({
  findOrphanedIssues: vi.fn(),
  closeOrphan: vi.fn().mockResolvedValue(undefined),
}));

import { setupOrphansCommands } from "../../../src/commands/orphans.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveLabelIds } from "../../../src/resolvers/label-resolver.js";
import { resolveStateIdByType } from "../../../src/resolvers/status-resolver.js";
import {
  closeOrphan,
  findOrphanedIssues,
} from "../../../src/services/orphans-service.js";

function createProgram(): Command {
  const program = new Command();
  program.option("--api-token <token>");
  setupOrphansCommands(program);
  return program;
}

const sampleOrphans = [
  {
    issue_id: "i-1",
    identifier: "ENG-1",
    title: "shipped already",
    status: "Backlog",
    team_id: "team-eng",
    latest_commit: "abc123",
    latest_commit_message: "feat: ENG-1 done",
  },
  {
    issue_id: "i-2",
    identifier: "ENG-2",
    title: "also shipped",
    status: "In Progress",
    team_id: "team-eng",
    latest_commit: "def456",
    latest_commit_message: "fix: ENG-2",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  process.exitCode = 0;
  vi.mocked(findOrphanedIssues).mockResolvedValue(sampleOrphans);
});

describe("orphans (list mode)", () => {
  it("strips commit details by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "orphans"]);

    const arg = vi.mocked(outputResult).mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(arg).toHaveLength(2);
    expect(arg[0]).not.toHaveProperty("latest_commit");
    expect(arg[0]).not.toHaveProperty("latest_commit_message");
  });

  it("includes commit details when --details is set", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "orphans", "--details"]);

    const arg = vi.mocked(outputResult).mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(arg[0]).toHaveProperty("latest_commit", "abc123");
    expect(arg[0]).toHaveProperty("latest_commit_message", "feat: ENG-1 done");
  });

  it("resolves --label names to UUIDs and forwards them", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "orphans",
      "--label",
      "bug,frontend",
    ]);

    expect(resolveLabelIds).toHaveBeenCalledWith(expect.anything(), [
      "bug",
      "frontend",
    ]);
    expect(findOrphanedIssues).toHaveBeenCalledWith(expect.anything(), {
      repoPath: undefined,
      limit: undefined,
      labelIds: ["lbl-bug", "lbl-frontend"],
      labelIdsAny: undefined,
    });
  });

  it("forwards --repo to the service", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "orphans",
      "--repo",
      "/tmp/repo",
    ]);

    expect(findOrphanedIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ repoPath: "/tmp/repo" }),
    );
  });
});

describe("orphans --fix", () => {
  it("rejects --force without --fix (exits 1)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "orphans", "--force"]);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(findOrphanedIssues).not.toHaveBeenCalled();
  });

  it("rejects --yes without --fix (exits 1)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "orphans", "--yes"]);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(findOrphanedIssues).not.toHaveBeenCalled();
  });

  it("closes every orphan with --fix --force (no prompt)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "orphans", "--fix", "--force"]);

    expect(closeOrphan).toHaveBeenCalledTimes(2);
    expect(resolveStateIdByType).toHaveBeenCalledTimes(1);
    expect(outputResult).toHaveBeenCalledOnce();
    const arg = vi.mocked(outputResult).mock.calls[0][0] as {
      closed: unknown[];
      failed: unknown[];
    };
    expect(arg.closed).toHaveLength(2);
    expect(arg.failed).toEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it("treats --yes as an alias for --force", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "orphans", "--fix", "--yes"]);

    expect(closeOrphan).toHaveBeenCalledTimes(2);
  });

  it("proceeds (agent-safe) with --fix when stdin is non-TTY", async () => {
    // The standardized contract (lin-iowg): a non-interactive caller is
    // never blocked on a Y/n it cannot answer — --fix is treated as consent.
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    const program = createProgram();
    await program.parseAsync(["node", "test", "orphans", "--fix"]);

    expect(process.exit).not.toHaveBeenCalled();
    expect(closeOrphan).toHaveBeenCalledTimes(2);
  });

  it("returns an empty structured result when there are no orphans to fix", async () => {
    vi.mocked(findOrphanedIssues).mockResolvedValueOnce([]);
    const program = createProgram();
    await program.parseAsync(["node", "test", "orphans", "--fix", "--force"]);

    expect(closeOrphan).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      { closed: [], failed: [] },
      expect.any(Function),
      expect.anything(),
    );
  });

  it("reports mixed close results and exits nonzero on partial failure", async () => {
    vi.mocked(closeOrphan)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("state update failed"));
    const program = createProgram();

    await program.parseAsync(["node", "test", "orphans", "--fix", "--force"]);

    const result = vi.mocked(outputResult).mock.calls[0][0] as {
      closed: Array<{ identifier: string }>;
      failed: Array<{ issue: { identifier: string }; error: string }>;
    };
    expect(result.closed).toEqual([
      expect.objectContaining({ identifier: "ENG-1" }),
    ]);
    expect(result.failed).toEqual([
      {
        issue: expect.objectContaining({ identifier: "ENG-2" }),
        error: "state update failed",
      },
    ]);
    expect(process.exitCode).toBe(1);
  });
});
