import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  createContext: vi.fn(() => ({ gql: { request: vi.fn() }, sdk: {} })),
  getRootOpts: vi.fn(() => ({})),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputSuccess: vi.fn(), outputResult: vi.fn() };
});

vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn(() => null),
}));

vi.mock("../../../src/common/scope-filter.js", () => ({
  getActiveScope: vi.fn(() => ({})),
}));

vi.mock("../../../src/resolvers/project-resolver.js", () => ({
  resolveProjectId: vi.fn().mockResolvedValue("resolved-project-uuid"),
}));

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn().mockResolvedValue("resolved-team-uuid"),
}));

vi.mock("../../../src/services/doctor-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/services/doctor-service.js")
    >();
  return {
    ...actual,
    runDoctor: vi.fn().mockResolvedValue({
      path: "/x",
      checks: [
        {
          name: "auth",
          status: "ok",
          message: "ok",
          category: "auth",
          observed_state: "obs",
          expected_state: "exp",
          explanation: "expl",
          commands: ["linear auth status"],
          severity: "info",
        },
      ],
      overall_ok: true,
      cli_version: "x",
      timestamp: "t",
      platform: { key: "linear" },
      suppressed_count: 0,
    }),
  };
});

import { setupDoctorCommands } from "../../../src/commands/doctor.js";
import { getDefaultTeam } from "../../../src/common/config-store.js";
import { outputResult } from "../../../src/common/output.js";
import { getActiveScope } from "../../../src/common/scope-filter.js";
import { resolveProjectId } from "../../../src/resolvers/project-resolver.js";
import { resolveTeamId } from "../../../src/resolvers/team-resolver.js";
import { runDoctor } from "../../../src/services/doctor-service.js";

function createProgram(): Command {
  const program = new Command();
  setupDoctorCommands(program);
  return program;
}

describe("linear doctor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    process.exitCode = 0;
    vi.mocked(getActiveScope).mockReturnValue({});
    vi.mocked(getDefaultTeam).mockReturnValue(null);
  });

  it("runs all four checks by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "doctor"]);
    const call = vi.mocked(runDoctor).mock.calls[0]?.[0];
    expect(call?.only).toBeUndefined();
    expect(call?.requiredLabels).toEqual([]);
    expect(call?.verbose).toBe(false);
    expect(call?.scope).toEqual({});
    expect(outputResult).toHaveBeenCalled();
  });

  it("resolves scope.default_project before the scope coverage check", async () => {
    vi.mocked(getActiveScope).mockReturnValueOnce({
      label: "git:linear-cli",
      project: "Roadmap",
    });
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "doctor",
      "--check",
      "scope_coverage",
    ]);

    expect(resolveProjectId).toHaveBeenCalledWith(expect.anything(), "Roadmap");
    expect(vi.mocked(runDoctor).mock.calls[0]?.[0].scope).toEqual({
      label: "git:linear-cli",
      project: "resolved-project-uuid",
    });
    expect(vi.mocked(runDoctor).mock.calls[0]?.[0].scopeProject).toEqual({
      name: "Roadmap",
      id: "resolved-project-uuid",
    });
  });

  it("passes stale scope.default_project as a diagnostic instead of aborting", async () => {
    vi.mocked(getActiveScope).mockReturnValueOnce({
      label: "git:linear-cli",
      project: "Missing Roadmap",
    });
    vi.mocked(resolveProjectId).mockRejectedValueOnce(
      new Error("Project not found"),
    );
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "doctor",
      "--check",
      "scope_coverage",
    ]);

    expect(runDoctor).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {
          label: "git:linear-cli",
          project: "Missing Roadmap",
        },
        scopeProject: {
          name: "Missing Roadmap",
          resolutionError: "Project not found",
        },
      }),
    );
  });

  it("resolves team.default before the team-scoped stale check", async () => {
    vi.mocked(getDefaultTeam).mockReturnValueOnce("ENG");
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "doctor",
      "--check",
      "stale_by_team_default",
    ]);

    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(vi.mocked(runDoctor).mock.calls[0]?.[0].defaultTeam).toEqual({
      name: "ENG",
      id: "resolved-team-uuid",
    });
  });

  it("passes a team.default resolution warning context instead of failing doctor", async () => {
    vi.mocked(getDefaultTeam).mockReturnValueOnce("MISSING");
    vi.mocked(resolveTeamId).mockRejectedValueOnce(new Error("Team not found"));
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "doctor",
      "--check",
      "stale_by_team_default",
    ]);

    expect(vi.mocked(runDoctor).mock.calls[0]?.[0].defaultTeam).toEqual({
      name: "MISSING",
      resolutionError: "Team not found",
    });
  });

  it("strips ZFC fields from each check unless --agent is set", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "doctor"]);
    const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
      checks: Array<Record<string, unknown>>;
    };
    expect(payload.checks[0]?.observed_state).toBeUndefined();
    expect(payload.checks[0]?.expected_state).toBeUndefined();
    expect(payload.checks[0]?.commands).toBeUndefined();
    expect(payload.checks[0]?.severity).toBeUndefined();
  });

  it("keeps ZFC fields when --agent is passed", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "doctor", "--agent"]);
    const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
      checks: Array<Record<string, unknown>>;
    };
    expect(payload.checks[0]?.observed_state).toBe("obs");
    expect(payload.checks[0]?.commands).toEqual(["linear auth status"]);
  });

  it("rejects an unknown --check name", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "doctor", "--check", "bogus"]);
    expect(runDoctor).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("parses --required-labels as a comma-separated list", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "doctor",
      "--required-labels",
      "convention:foo, tier:linear-direct,  ",
    ]);
    const call = vi.mocked(runDoctor).mock.calls[0]?.[0];
    expect(call?.requiredLabels).toEqual([
      "convention:foo",
      "tier:linear-direct",
    ]);
  });

  it("exits non-zero when the result reports overall_ok: false", async () => {
    vi.mocked(runDoctor).mockResolvedValueOnce({
      path: "/x",
      checks: [
        {
          name: "auth",
          status: "error",
          message: "boom",
          category: "auth",
        },
      ],
      overall_ok: false,
      cli_version: "x",
      timestamp: "t",
      platform: { key: "linear" },
      suppressed_count: 0,
    });
    const program = createProgram();
    await program.parseAsync(["node", "test", "doctor"]);
    expect(process.exitCode).toBe(1);
  });

  it("annotates the payload with a fix_skipped note when --fix is passed", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "doctor", "--fix"]);
    const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
      fix_skipped?: string;
    };
    expect(payload.fix_skipped).toContain("read-only advisory");
  });
});
