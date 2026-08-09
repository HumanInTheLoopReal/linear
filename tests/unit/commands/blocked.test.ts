import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn(async (_sdk: unknown, id: string) => `uuid-${id}`),
}));

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn().mockResolvedValue("resolved-team-uuid"),
}));

vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn(() => null),
}));

vi.mock("../../../src/common/scope-filter.js", () => ({
  getActiveScope: vi.fn(() => ({})),
  buildScopeFragments: vi.fn(() => []),
  applyScopeToFilter: vi.fn((base: unknown) => base),
  resolveScopeOption: vi.fn((opt: unknown) => (opt === false ? undefined : {})),
}));

vi.mock("../../../src/services/blocked-service.js", () => ({
  listBlockedIssues: vi.fn().mockResolvedValue([]),
}));

import {
  resolveBlockedCap,
  setupBlockedCommands,
} from "../../../src/commands/blocked.js";
import { getRootOpts } from "../../../src/common/context.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveIssueId } from "../../../src/resolvers/issue-resolver.js";
import { resolveTeamId } from "../../../src/resolvers/team-resolver.js";
import { listBlockedIssues } from "../../../src/services/blocked-service.js";

function createProgram(): Command {
  const program = new Command();
  setupBlockedCommands(program);
  return program;
}

function makeBlocked(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `i-${i}`,
    identifier: `ENG-${i}`,
    title: `Blocked ${i}`,
    priority: 2,
    status: "started",
    state_name: "In Progress",
    blocked_by: ["ENG-100"],
    blocked_by_details: [],
    blocked_by_count: 1,
    team: { id: "t", key: "ENG", name: "Eng" },
  }));
}

describe("linear blocked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("emits the service result as JSON (default: no filters)", async () => {
    vi.mocked(listBlockedIssues).mockResolvedValueOnce([
      {
        id: "i-1",
        identifier: "ENG-1",
        title: "Blocked thing",
        priority: 2,
        status: "started",
        state_name: "In Progress",
        blocked_by: ["ENG-100"],
        blocked_by_details: [
          { identifier: "ENG-100", title: "Blocker", status: "started" },
        ],
        blocked_by_count: 1,
        team: { id: "t", key: "ENG", name: "Eng" },
      },
    ]);
    const program = createProgram();
    await program.parseAsync(["node", "test", "blocked"]);
    expect(listBlockedIssues).toHaveBeenCalledWith(expect.anything(), {
      parentId: undefined,
      teamId: undefined,
      scope: {},
    });
    expect(outputResult).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ identifier: "ENG-1" }),
      ]),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("--parent resolves the issue ID and forwards it", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "blocked", "--parent", "ENG-7"]);
    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-7");
    expect(listBlockedIssues).toHaveBeenCalledWith(expect.anything(), {
      parentId: "uuid-ENG-7",
      teamId: undefined,
      scope: {},
    });
  });

  it("--team resolves the team UUID and forwards it", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "blocked", "--team", "ENG"]);
    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(listBlockedIssues).toHaveBeenCalledWith(expect.anything(), {
      parentId: undefined,
      teamId: "resolved-team-uuid",
      scope: {},
    });
  });

  it("passes both --parent and --team together", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "blocked",
      "--parent",
      "ENG-7",
      "--team",
      "ENG",
    ]);
    expect(listBlockedIssues).toHaveBeenCalledWith(expect.anything(), {
      parentId: "uuid-ENG-7",
      teamId: "resolved-team-uuid",
      scope: {},
    });
  });

  it("forwards an empty result to outputResult when nothing is blocked", async () => {
    vi.mocked(listBlockedIssues).mockResolvedValueOnce([]);
    const program = createProgram();
    await program.parseAsync(["node", "test", "blocked"]);
    expect(outputResult).toHaveBeenCalledWith(
      [],
      expect.any(Function),
      expect.any(Object),
    );
  });
});

// lin-g1hy: blocked is a raw array (no pageInfo), so agent-mode trimming
// caps the output and surfaces the tell on stderr.
describe("resolveBlockedCap", () => {
  it("returns undefined (all) for a human with no --limit", () => {
    expect(resolveBlockedCap(undefined, "default", false)).toBeUndefined();
  });

  it("caps to the agent default for an agent with no --limit", () => {
    expect(resolveBlockedCap(undefined, "default", true)).toBe(20);
  });

  it("honors an explicit --limit over the agent default", () => {
    expect(resolveBlockedCap("5", "cli", true)).toBe(5);
  });

  it("treats explicit --limit 0 as all (undefined)", () => {
    expect(resolveBlockedCap("0", "cli", true)).toBeUndefined();
  });

  it("rejects a negative --limit", () => {
    expect(() => resolveBlockedCap("-3", "cli", true)).toThrow();
  });
});

describe("linear blocked agent-mode trim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  // getRootOpts is set per-test via mockReturnValue; clearAllMocks does NOT
  // drain that, so restore the factory default to avoid leaking agentMode
  // into any later test (lin-muz6 lesson).
  afterEach(() => {
    vi.mocked(getRootOpts).mockReturnValue({ apiToken: "test-token" });
  });

  it("caps to 20 and warns on stderr in agent mode", async () => {
    vi.mocked(getRootOpts).mockReturnValue({
      apiToken: "test-token",
      agentMode: true,
    });
    vi.mocked(listBlockedIssues).mockResolvedValueOnce(makeBlocked(25));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(["node", "test", "blocked"]);

    const shown = vi.mocked(outputResult).mock.calls[0][0] as unknown[];
    expect(shown).toHaveLength(20);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Showing 20 of 25 blocked issues"),
    );
  });

  it("shows all (no warning) for a human even with 25 blocked", async () => {
    vi.mocked(getRootOpts).mockReturnValue({
      apiToken: "test-token",
      agentMode: false,
    });
    vi.mocked(listBlockedIssues).mockResolvedValueOnce(makeBlocked(25));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(["node", "test", "blocked"]);

    const shown = vi.mocked(outputResult).mock.calls[0][0] as unknown[];
    expect(shown).toHaveLength(25);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("an explicit --limit wins in agent mode", async () => {
    vi.mocked(getRootOpts).mockReturnValue({
      apiToken: "test-token",
      agentMode: true,
    });
    vi.mocked(listBlockedIssues).mockResolvedValueOnce(makeBlocked(25));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(["node", "test", "blocked", "--limit", "3"]);

    const shown = vi.mocked(outputResult).mock.calls[0][0] as unknown[];
    expect(shown).toHaveLength(3);
  });

  it("--limit 0 returns all even in agent mode", async () => {
    vi.mocked(getRootOpts).mockReturnValue({
      apiToken: "test-token",
      agentMode: true,
    });
    vi.mocked(listBlockedIssues).mockResolvedValueOnce(makeBlocked(25));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(["node", "test", "blocked", "--limit", "0"]);

    const shown = vi.mocked(outputResult).mock.calls[0][0] as unknown[];
    expect(shown).toHaveLength(25);
  });
});
