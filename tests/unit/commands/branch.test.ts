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

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn(async (_sdk: unknown, id: string) => `uuid-${id}`),
}));

vi.mock("../../../src/services/issue-service.js", () => ({
  getIssue: vi.fn(),
}));

vi.mock("../../../src/services/git-service.js", () => ({
  isGitRepo: vi.fn(() => true),
  currentBranch: vi.fn(() => "main"),
  listBranches: vi.fn(() => ["main", "feature-xyz"]),
  switchToBranch: vi.fn(),
  branchNameFromIssue: vi.fn(
    (id: string, title: string) =>
      `${id.toLowerCase()}/${title.toLowerCase().replace(/\s+/g, "-")}`,
  ),
}));

import {
  formatBranch,
  setupBranchCommands,
} from "../../../src/commands/branch.js";
import { outputResult } from "../../../src/common/output.js";
import * as gitService from "../../../src/services/git-service.js";
import { getIssue } from "../../../src/services/issue-service.js";

function createProgram(): Command {
  const program = new Command();
  setupBranchCommands(program);
  return program;
}

describe("linear branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitService.isGitRepo).mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("list mode (no args): emits {current, branches} envelope", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "branch"]);

    expect(outputResult).toHaveBeenCalledWith(
      { current: "main", branches: ["main", "feature-xyz"] },
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("create mode: resolves issue, derives slug, switches, emits {created, issue, action}", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "uuid-ENG-42",
      identifier: "ENG-42",
      title: "Add Search Filter",
    } as never);
    vi.mocked(gitService.switchToBranch).mockReturnValueOnce("created");

    const program = createProgram();
    await program.parseAsync(["node", "test", "branch", "ENG-42"]);

    expect(gitService.branchNameFromIssue).toHaveBeenCalledWith(
      "ENG-42",
      "Add Search Filter",
    );
    expect(gitService.switchToBranch).toHaveBeenCalledWith(
      "eng-42/add-search-filter",
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        created: "eng-42/add-search-filter",
        action: "created",
        issue: expect.objectContaining({ identifier: "ENG-42" }),
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("create mode: reports action='switched' when branch already exists", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "uuid-ENG-7",
      identifier: "ENG-7",
      title: "x",
    } as never);
    vi.mocked(gitService.switchToBranch).mockReturnValueOnce("switched");

    const program = createProgram();
    await program.parseAsync(["node", "test", "branch", "ENG-7"]);

    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ action: "switched" }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("fails cleanly when cwd is not a git repo", async () => {
    vi.mocked(gitService.isGitRepo).mockReturnValueOnce(false);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const program = createProgram();
    await program.parseAsync(["node", "test", "branch"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(outputResult).not.toHaveBeenCalled();
  });

  it("formatBranch (list): renders 🌿 header with * on current", () => {
    const out = formatBranch({
      current: "main",
      branches: ["main", "feature-xyz"],
    });
    expect(out).toContain("🌿 Branches:");
    expect(out).toContain("  * main");
    expect(out).toContain("    feature-xyz");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("formatBranch (create): emits 'Created branch:' for action=created", () => {
    const out = formatBranch({
      created: "eng-42/add-search-filter",
      action: "created",
      issue: { id: "u", identifier: "ENG-42", title: "x" },
    });
    expect(out).toBe("Created branch: eng-42/add-search-filter\n");
  });

  it("formatBranch (create): emits 'Switched to branch:' for action=switched", () => {
    const out = formatBranch({
      created: "eng-7/x",
      action: "switched",
      issue: { id: "u", identifier: "ENG-7", title: "x" },
    });
    expect(out).toBe("Switched to branch: eng-7/x\n");
  });
});
