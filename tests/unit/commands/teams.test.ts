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
    outputResult: vi.fn(),
    outputSuccess: vi.fn(),
  };
});

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn().mockResolvedValue("resolved-team-uuid"),
}));

vi.mock("../../../src/services/team-service.js", () => ({
  listTeams: vi.fn().mockResolvedValue({
    nodes: [{ id: "team-1", key: "ENG", name: "Engineering" }],
    pageInfo: { hasNextPage: false, endCursor: null },
  }),
  getTeam: vi.fn().mockResolvedValue({
    id: "team-1",
    key: "ENG",
    validEstimates: [
      { value: 1, label: "1" },
      { value: 2, label: "2" },
      { value: 3, label: "3" },
      { value: 5, label: "5" },
      { value: 8, label: "8" },
    ],
    estimationSource: "self",
  }),
  renameTeamKey: vi.fn().mockResolvedValue({
    team_id: "team-1",
    old_key: "ENG",
    new_key: "NEW",
    changed: true,
    dry_run: false,
    warning: "stub warning",
  }),
}));

import { setupTeamsCommands } from "../../../src/commands/teams.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveTeamId } from "../../../src/resolvers/team-resolver.js";
import {
  getTeam,
  listTeams,
  renameTeamKey,
} from "../../../src/services/team-service.js";

function createProgram(): Command {
  const program = new Command();
  program.option("--api-token <token>");
  setupTeamsCommands(program);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

describe("teams read", () => {
  it("resolves team id and outputs team detail", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "teams", "read", "ENG"]);

    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(getTeam).toHaveBeenCalledWith(expect.anything(), {
      id: "resolved-team-uuid",
    });
    expect(outputResult).toHaveBeenCalledWith(
      {
        id: "team-1",
        key: "ENG",
        validEstimates: [
          { value: 1, label: "1" },
          { value: 2, label: "2" },
          { value: 3, label: "3" },
          { value: 5, label: "5" },
          { value: 8, label: "8" },
        ],
        estimationSource: "self",
      },
      expect.any(Function),
      expect.anything(),
    );
  });
});

describe("teams list", () => {
  it("uses listTeams path and outputs nodes", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "teams", "list"]);

    expect(listTeams).toHaveBeenCalledWith(expect.anything(), {
      limit: 50,
      after: undefined,
    });
    expect(outputResult).toHaveBeenCalledWith(
      {
        nodes: [{ id: "team-1", key: "ENG", name: "Engineering" }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      expect.any(Function),
      expect.anything(),
    );
  });
});

describe("linear teams rename-prefix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("resolves the team, reads current key, and forwards dryRun=false by default", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "teams",
      "rename-prefix",
      "ENG",
      "NEW",
    ]);
    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(getTeam).toHaveBeenCalledWith(expect.anything(), {
      id: "resolved-team-uuid",
    });
    expect(renameTeamKey).toHaveBeenCalledWith(expect.anything(), {
      teamId: "resolved-team-uuid",
      currentKey: "ENG",
      newKey: "NEW",
      dryRun: false,
    });
  });

  it("forwards --dry-run", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "teams",
      "rename-prefix",
      "ENG",
      "NEW",
      "--dry-run",
    ]);
    expect(renameTeamKey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("emits the service result as JSON", async () => {
    vi.mocked(renameTeamKey).mockResolvedValueOnce({
      team_id: "team-1",
      old_key: "ENG",
      new_key: "BACK",
      changed: true,
      dry_run: false,
      warning: "warning text",
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "teams",
      "rename-prefix",
      "ENG",
      "BACK",
    ]);
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ old_key: "ENG", new_key: "BACK" }),
      expect.any(Function),
      expect.anything(),
    );
  });

  it("propagates invalid-key errors as process.exit(1)", async () => {
    vi.mocked(renameTeamKey).mockRejectedValueOnce(
      new Error("invalid team key: key '1bad' must start with a letter"),
    );
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "teams",
      "rename-prefix",
      "ENG",
      "1bad",
    ]);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
