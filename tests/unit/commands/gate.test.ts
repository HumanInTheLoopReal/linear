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
  return { ...actual, outputSuccess: vi.fn(), outputResult: vi.fn() };
});

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn().mockResolvedValue("resolved-team-uuid"),
}));

vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn(() => null),
}));

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn().mockResolvedValue("resolved-issue-uuid"),
}));

vi.mock("../../../src/resolvers/status-resolver.js", () => ({
  resolveStateIdByType: vi.fn().mockResolvedValue("resolved-state-uuid"),
}));

vi.mock("../../../src/services/gate-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/services/gate-service.js")
    >();
  return {
    ...actual,
    listGates: vi.fn().mockResolvedValue([]),
    fetchGateForResolve: vi.fn().mockResolvedValue({
      id: "resolved-issue-uuid",
      identifier: "ENG-1",
      team_id: "gate-team-uuid",
    }),
    resolveGate: vi.fn().mockResolvedValue({
      id: "resolved-issue-uuid",
      identifier: "ENG-1",
      state_id: "resolved-state-uuid",
      state_name: "Done",
      comment_id: null,
      reason: null,
    }),
    runGateCheck: vi.fn().mockResolvedValue({
      checked: 0,
      resolved: 0,
      escalated: 0,
      pending: 0,
      skipped: 0,
      errors: 0,
      dry_run: false,
      results: [],
    }),
  };
});

import { setupGateCommands } from "../../../src/commands/gate.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveIssueId } from "../../../src/resolvers/issue-resolver.js";
import { resolveStateIdByType } from "../../../src/resolvers/status-resolver.js";
import { resolveTeamId } from "../../../src/resolvers/team-resolver.js";
import {
  fetchGateForResolve,
  GATE_LABEL_NAME,
  listGates,
  resolveGate,
  runGateCheck,
} from "../../../src/services/gate-service.js";

function createProgram(): Command {
  const program = new Command();
  setupGateCommands(program);
  return program;
}

describe("linear gate list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("defaults to open gates with limit 50", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "gate", "list"]);
    expect(listGates).toHaveBeenCalledWith(expect.anything(), {
      all: false,
      teamId: undefined,
      limit: 50,
    });
    expect(outputResult).toHaveBeenCalledWith(
      [],
      expect.any(Function),
      expect.anything(),
    );
  });

  it("--all forwards to the service", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "gate", "list", "--all"]);
    expect(listGates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ all: true }),
    );
  });

  it("--limit parses as a number", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "gate", "list", "--limit", "10"]);
    expect(listGates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 10 }),
    );
  });

  it("--team resolves the team UUID and forwards it", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "gate", "list", "--team", "ENG"]);
    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(listGates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ teamId: "resolved-team-uuid" }),
    );
  });

  it("emits the service result as JSON", async () => {
    vi.mocked(listGates).mockResolvedValueOnce([
      {
        id: "g-1",
        identifier: "ENG-1",
        title: "Gate: ci",
        status: "backlog",
        state_name: "Backlog",
        issue_type: "gate",
        await_type: "gh:run",
        await_id: "12345",
        timeout: null,
        waiters: [],
        created_at: "2026-05-01T00:00:00.000Z",
        team: { id: "t", key: "ENG", name: "Eng" },
      },
    ]);
    const program = createProgram();
    await program.parseAsync(["node", "test", "gate", "list"]);
    expect(outputResult).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ identifier: "ENG-1", await_type: "gh:run" }),
      ]),
      expect.any(Function),
      expect.anything(),
    );
  });
});

describe("linear gate resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("resolves the gate id, validates the gate, finds a 'completed' state, and applies the update", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "gate", "resolve", "ENG-1"]);
    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-1");
    expect(fetchGateForResolve).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
    );
    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "gate-team-uuid",
      "completed",
    );
    expect(resolveGate).toHaveBeenCalledWith(expect.anything(), {
      issueId: "resolved-issue-uuid",
      stateId: "resolved-state-uuid",
      reason: undefined,
    });
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ state_name: "Done" }),
      expect.any(Function),
      expect.anything(),
    );
  });

  it("forwards --reason to the service", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "gate",
      "resolve",
      "ENG-1",
      "--reason",
      "Manual override",
    ]);
    expect(resolveGate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: "Manual override" }),
    );
  });

  it("propagates 'not a gate' errors from fetchGateForResolve as process.exit(1)", async () => {
    vi.mocked(fetchGateForResolve).mockRejectedValueOnce(
      new Error(
        `Issue ENG-1 is not a gate (missing '${GATE_LABEL_NAME}' label)`,
      ),
    );
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const program = createProgram();
    await program.parseAsync(["node", "test", "gate", "resolve", "ENG-1"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(resolveGate).not.toHaveBeenCalled();
  });
});

describe("linear gate check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("defaults: no team, no type filter, dry-run off", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "gate", "check"]);
    expect(runGateCheck).toHaveBeenCalledWith(expect.anything(), {
      typeFilter: undefined,
      dryRun: false,
      limit: undefined,
      teamId: undefined,
      gates: [],
      completedStateByTeam: expect.any(Map),
    });
  });

  it("--dry-run forwards as dryRun=true", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "gate", "check", "--dry-run"]);
    expect(runGateCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("--type forwards as typeFilter and --limit parses as number", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "gate",
      "check",
      "--type",
      "gh",
      "--limit",
      "5",
    ]);
    expect(runGateCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ typeFilter: "gh", limit: 5 }),
    );
  });

  it("--team resolves the team UUID and forwards it", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "gate",
      "check",
      "--team",
      "ENG",
    ]);
    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(runGateCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ teamId: "resolved-team-uuid" }),
    );
  });

  it("resolves completed states once per gate team before service execution", async () => {
    vi.mocked(listGates).mockResolvedValueOnce([
      {
        id: "g-1",
        identifier: "ENG-1",
        title: "Gate: ci",
        status: "backlog",
        state_name: "Backlog",
        issue_type: "gate",
        await_type: "gh:run",
        await_id: "123",
        timeout: null,
        waiters: [],
        created_at: "2026-05-01T00:00:00.000Z",
        team: { id: "team-a", key: "ENG", name: "Engineering" },
      },
      {
        id: "g-2",
        identifier: "ENG-2",
        title: "Gate: deploy",
        status: "backlog",
        state_name: "Backlog",
        issue_type: "gate",
        await_type: "timer",
        await_id: null,
        timeout: "10m",
        waiters: [],
        created_at: "2026-05-01T00:00:00.000Z",
        team: { id: "team-a", key: "ENG", name: "Engineering" },
      },
    ]);
    const program = createProgram();

    await program.parseAsync(["node", "test", "gate", "check"]);

    expect(resolveStateIdByType).toHaveBeenCalledTimes(1);
    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-a",
      "completed",
    );
    const options = vi.mocked(runGateCheck).mock.calls[0]?.[1];
    expect(options?.completedStateByTeam?.get("team-a")).toEqual({
      stateId: "resolved-state-uuid",
    });
  });

  it("emits the summary as JSON", async () => {
    vi.mocked(runGateCheck).mockResolvedValueOnce({
      checked: 1,
      resolved: 1,
      escalated: 0,
      pending: 0,
      skipped: 0,
      errors: 0,
      dry_run: false,
      results: [
        {
          gate_id: "g-1",
          identifier: "ENG-1",
          await_type: "gh:run",
          await_id: "1",
          outcome: "resolved",
          reason: "workflow ci succeeded",
          closed: true,
          error: null,
        },
      ],
    });
    const program = createProgram();
    await program.parseAsync(["node", "test", "gate", "check"]);
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ checked: 1, resolved: 1 }),
      expect.any(Function),
      expect.anything(),
    );
  });
});
