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
  };
});

vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn(() => null),
}));

vi.mock("../../../src/common/scope-filter.js", () => ({
  getActiveScope: vi.fn(() => ({ label: "git:linear-cli" })),
}));

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn().mockResolvedValue("resolved-team-uuid"),
}));

vi.mock("../../../src/resolvers/project-resolver.js", () => ({
  resolveProjectId: vi.fn().mockResolvedValue("resolved-project-uuid"),
}));

vi.mock("../../../src/services/label-service.js", () => ({
  ensureWorkspaceLabel: vi.fn().mockResolvedValue("resolved-label-uuid"),
}));

vi.mock("../../../src/services/adopt-service.js", () => ({
  findUnscopedCandidates: vi.fn().mockResolvedValue([]),
  tagWithScope: vi.fn().mockResolvedValue([]),
}));

import { setupAdoptCommands } from "../../../src/commands/adopt.js";
import { outputResult } from "../../../src/common/output.js";
import { getActiveScope } from "../../../src/common/scope-filter.js";
import { resolveProjectId } from "../../../src/resolvers/project-resolver.js";
import {
  findUnscopedCandidates,
  tagWithScope,
} from "../../../src/services/adopt-service.js";
import { ensureWorkspaceLabel } from "../../../src/services/label-service.js";

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  setupAdoptCommands(program);
  return program;
}

describe("linear adopt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getActiveScope).mockReturnValue({ label: "git:linear-cli" });
    vi.mocked(findUnscopedCandidates).mockResolvedValue([]);
    vi.mocked(tagWithScope).mockResolvedValue([]);
  });

  it("default mode is dry-run (does not call tagWithScope)", async () => {
    vi.mocked(findUnscopedCandidates).mockResolvedValueOnce([
      { id: "i-1", identifier: "ENG-1", title: "x", currentLabelIds: [] },
    ]);

    const program = makeProgram();
    await program.parseAsync(["node", "linear", "adopt"]);

    expect(findUnscopedCandidates).toHaveBeenCalled();
    expect(tagWithScope).not.toHaveBeenCalled();
    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: true }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("--all triggers ensureWorkspaceLabel + tagWithScope", async () => {
    vi.mocked(findUnscopedCandidates).mockResolvedValueOnce([
      { id: "i-1", identifier: "ENG-1", title: "x", currentLabelIds: [] },
    ]);
    vi.mocked(tagWithScope).mockResolvedValueOnce([
      { id: "i-1", identifier: "ENG-1", labels_added: ["resolved-label-uuid"] },
    ]);

    const program = makeProgram();
    await program.parseAsync(["node", "linear", "adopt", "--all"]);

    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "git:linear-cli",
      expect.any(String),
    );
    expect(tagWithScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Array),
      "resolved-label-uuid",
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: false, tagged: expect.any(Array) }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("--all --dry-run does NOT mutate", async () => {
    vi.mocked(findUnscopedCandidates).mockResolvedValueOnce([
      { id: "i-1", identifier: "ENG-1", title: "x", currentLabelIds: [] },
    ]);

    const program = makeProgram();
    await program.parseAsync(["node", "linear", "adopt", "--all", "--dry-run"]);

    expect(tagWithScope).not.toHaveBeenCalled();
    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
  });

  it("--scope <label> overrides the resolved scope label", async () => {
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "linear",
      "adopt",
      "--scope",
      "git:other",
    ]);

    expect(getActiveScope).toHaveBeenCalledWith(expect.anything(), {
      label: "git:other",
    });
  });

  it("resolves scope.default_project names before querying candidates", async () => {
    vi.mocked(getActiveScope).mockReturnValueOnce({
      label: "git:linear-cli",
      project: "Roadmap",
    });
    const program = makeProgram();

    await program.parseAsync(["node", "linear", "adopt"]);

    expect(resolveProjectId).toHaveBeenCalledWith(expect.anything(), "Roadmap");
    expect(findUnscopedCandidates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "resolved-project-uuid" }),
    );
  });

  it("errors when no scope is configured", async () => {
    vi.mocked(getActiveScope).mockReturnValueOnce({});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = makeProgram();
    await expect(
      program.parseAsync(["node", "linear", "adopt"]),
    ).rejects.toThrow();
    expect(errSpy.mock.calls.join(" ")).toMatch(/scope\.label/);

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("--all with zero candidates skips the write path", async () => {
    vi.mocked(findUnscopedCandidates).mockResolvedValueOnce([]);

    const program = makeProgram();
    await program.parseAsync(["node", "linear", "adopt", "--all"]);

    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
    expect(tagWithScope).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: true, candidates: [] }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("rejects --limit 0 with invalid parameter error", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = makeProgram();
    await expect(
      program.parseAsync(["node", "linear", "adopt", "--limit", "0"]),
    ).rejects.toThrow();
    expect(errSpy.mock.calls.join(" ")).toMatch(/positive integer/);

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
