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

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn().mockResolvedValue("resolved-team-uuid"),
}));

vi.mock("../../../src/resolvers/user-resolver.js", () => ({
  resolveUserId: vi.fn().mockResolvedValue("resolved-user-uuid"),
}));

vi.mock("../../../src/resolvers/label-resolver.js", () => ({
  resolveLabelIds: vi
    .fn()
    .mockImplementation(async (_sdk, names: string[]) =>
      names.map((n) => `lbl-${n}`),
    ),
  // lin-ufud: permissive variant returns `lbl-<name>` for known names and
  // skips `*missing*` so tests can model "user typed a nonexistent label".
  resolveLabelIdsPermissive: vi
    .fn()
    .mockImplementation(async (_sdk, names: string[]) =>
      names.filter((n) => !n.includes("missing")).map((n) => `lbl-${n}`),
    ),
}));

vi.mock("../../../src/resolvers/status-resolver.js", () => ({
  resolveStateIdByType: vi.fn().mockResolvedValue("state-started-uuid"),
}));

vi.mock("../../../src/common/scope-filter.js", () => ({
  getActiveScope: vi.fn(() => ({})),
  buildScopeFragments: vi.fn(() => []),
  applyScopeToFilter: vi.fn((base: unknown) => base),
  resolveScopeOption: vi.fn((opt: unknown) => (opt === false ? undefined : {})),
}));

vi.mock("../../../src/services/next-service.js", () => ({
  listNextIssues: vi.fn().mockResolvedValue([
    {
      id: "i-1",
      identifier: "ENG-1",
      title: "ready 1",
      priority: 2,
      team: { id: "team-1", key: "ENG", name: "ENG" },
      state: { id: "s-1", name: "Backlog" },
      labels: { nodes: [] },
    },
  ]),
  claimReadyIssue: vi.fn().mockResolvedValue({
    id: "i-1",
    identifier: "ENG-1",
    assignee_id: "viewer-uuid",
    state_id: "state-started-uuid",
  }),
  READY_SORT_POLICIES: ["priority", "oldest", "hybrid"],
}));

import { setupNextCommands } from "../../../src/commands/next.js";
import { outputResult } from "../../../src/common/output.js";
import {
  resolveLabelIds,
  resolveLabelIdsPermissive,
} from "../../../src/resolvers/label-resolver.js";
import { resolveStateIdByType } from "../../../src/resolvers/status-resolver.js";
import { resolveTeamId } from "../../../src/resolvers/team-resolver.js";
import { resolveUserId } from "../../../src/resolvers/user-resolver.js";
import {
  claimReadyIssue,
  listNextIssues,
} from "../../../src/services/next-service.js";

function createProgram(): Command {
  const program = new Command();
  program.option("--api-token <token>");
  setupNextCommands(program);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

describe("next (list mode)", () => {
  it("passes resolved filters to listNextIssues and outputs the candidates", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "next",
      "--team",
      "ENG",
      "--limit",
      "25",
      "--priority",
      "2",
      "--assignee",
      "ada",
      "--label",
      "bug,frontend",
      "--type",
      "task",
    ]);

    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(resolveUserId).toHaveBeenCalledWith(expect.anything(), "ada");
    expect(resolveLabelIds).toHaveBeenCalledWith(expect.anything(), [
      "bug",
      "frontend",
    ]);
    expect(listNextIssues).toHaveBeenCalledWith(expect.anything(), {
      teamId: "resolved-team-uuid",
      assigneeId: "resolved-user-uuid",
      unassigned: false,
      priority: 2,
      labelIds: ["lbl-bug", "lbl-frontend"],
      typeLabel: "type:task",
      parentId: undefined,
      sort: "priority",
      limit: 25,
      includeDeferred: false,
      scope: {},
    });
    expect(claimReadyIssue).not.toHaveBeenCalled();
    // Read-only path goes through the text-default dispatcher; --json
    // delegates back to outputSuccess inside outputResult.
    expect(outputResult).toHaveBeenCalled();
  });

  it("uses unassigned filter when -u is set", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "next", "-u"]);

    const call = vi.mocked(listNextIssues).mock.calls[0][1];
    expect(call?.unassigned).toBe(true);
  });

  // lin-ufud: --exclude-label resolves permissively (typos skip silently)
  // and threads excludeLabelIds into listNextIssues.
  it("resolves --exclude-label permissively and forwards excludeLabelIds", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "next",
      "--exclude-label",
      "example,seed,missing-label",
    ]);

    expect(resolveLabelIdsPermissive).toHaveBeenCalledWith(expect.anything(), [
      "example",
      "seed",
      "missing-label",
    ]);
    const call = vi.mocked(listNextIssues).mock.calls[0][1];
    expect(call?.excludeLabelIds).toEqual(["lbl-example", "lbl-seed"]);
  });

  it("leaves excludeLabelIds undefined when --exclude-label is omitted", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "next"]);

    expect(resolveLabelIdsPermissive).not.toHaveBeenCalled();
    const call = vi.mocked(listNextIssues).mock.calls[0][1];
    expect(call?.excludeLabelIds).toBeUndefined();
  });

  it("compiles --label-pattern into a labelPatternFilter fragment (lin-ym1m)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "next",
      "--label-pattern",
      "type:*",
    ]);
    const call = vi.mocked(listNextIssues).mock.calls[0][1];
    expect(call?.labelPatternFilter).toEqual({
      labels: { some: { name: { startsWith: "type:" } } },
    });
  });

  it("rejects --label-pattern combined with --label (lin-ym1m)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "next",
      "--label",
      "bug",
      "--label-pattern",
      "type:*",
    ]);
    // Conflict short-circuits before the service call.
    expect(listNextIssues).not.toHaveBeenCalled();
  });

  it("rejects a complex --label-pattern glob (lin-ym1m)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "next",
      "--label-pattern",
      "a*b",
    ]);
    expect(listNextIssues).not.toHaveBeenCalled();
  });

  it("defaults the sort policy to priority (lin-pazf)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "next"]);
    const call = vi.mocked(listNextIssues).mock.calls[0][1];
    expect(call?.sort).toBe("priority");
  });

  it("forwards --sort oldest to listNextIssues (lin-pazf)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "next", "--sort", "oldest"]);
    const call = vi.mocked(listNextIssues).mock.calls[0][1];
    expect(call?.sort).toBe("oldest");
  });

  it("rejects an unknown --sort policy (lin-pazf)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "next", "--sort", "bogus"]);
    // Invalid policy short-circuits before the service call.
    expect(listNextIssues).not.toHaveBeenCalled();
  });
});

describe("next --claim", () => {
  it("resolves the started state for the candidate's team and calls claimReadyIssue", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "next", "--claim"]);

    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-1",
      "started",
    );
    expect(claimReadyIssue).toHaveBeenCalled();
    // Claim path now routes through outputResult (text-default w/ formatter
    // for human view, --json falls back to outputSuccess inside the dispatcher).
    // JSON envelope shape is unchanged: the same single-element array.
    expect(outputResult).toHaveBeenCalledWith(
      [
        {
          id: "i-1",
          identifier: "ENG-1",
          assignee_id: "viewer-uuid",
          state_id: "state-started-uuid",
        },
      ],
      expect.any(Function),
      expect.anything(),
    );
  });

  it("outputs [] when no candidates match", async () => {
    vi.mocked(listNextIssues).mockResolvedValueOnce([]);
    const program = createProgram();
    await program.parseAsync(["node", "test", "next", "--claim"]);

    expect(claimReadyIssue).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      [],
      expect.any(Function),
      expect.anything(),
    );
  });

  it("rejects --claim + --assignee (exits 1)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "next",
      "--claim",
      "--assignee",
      "ada",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(listNextIssues).not.toHaveBeenCalled();
  });

  it("rejects --claim + --unassigned (exits 1)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "next", "--claim", "-u"]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(listNextIssues).not.toHaveBeenCalled();
  });
});
