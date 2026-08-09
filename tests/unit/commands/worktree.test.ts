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
  repoRoot: vi.fn(() => "/home/u/proj"),
  listWorktrees: vi.fn(() => []),
  addWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  worktreeSafetyIssue: vi.fn(() => null),
  isLinkedWorktree: vi.fn(() => false),
  mainRepoRoot: vi.fn(() => "/home/u/proj"),
  currentBranch: vi.fn(() => "eng-1/x"),
  branchNameFromIssue: vi.fn(
    (id: string, title: string) =>
      `${id.toLowerCase()}/${title.toLowerCase().replace(/\s+/g, "-")}`,
  ),
}));

import {
  defaultWorktreePath,
  formatWorktree,
  resolveWorktreePath,
  setupWorktreeCommands,
} from "../../../src/commands/worktree.js";
import { outputResult } from "../../../src/common/output.js";
import * as gitService from "../../../src/services/git-service.js";
import { getIssue } from "../../../src/services/issue-service.js";

function createProgram(): Command {
  const program = new Command();
  setupWorktreeCommands(program);
  return program;
}

describe("defaultWorktreePath", () => {
  it("places the worktree as a sibling of the repo root, named after the lowercased id", () => {
    expect(defaultWorktreePath("/home/u/proj", "ENG-42")).toBe(
      "/home/u/eng-42",
    );
    expect(defaultWorktreePath("/Users/foo/bar/baz", "TES-1")).toBe(
      "/Users/foo/bar/tes-1",
    );
  });
});

describe("linear worktree list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitService.isGitRepo).mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("emits {worktrees, main} envelope with main path resolved from isMain", async () => {
    vi.mocked(gitService.listWorktrees).mockReturnValueOnce([
      { path: "/home/u/proj", branch: "main", isMain: true },
      { path: "/home/u/eng-42", branch: "eng-42/x", isMain: false },
    ]);

    const program = createProgram();
    await program.parseAsync(["node", "test", "worktree", "list"]);

    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        main: "/home/u/proj",
        worktrees: expect.arrayContaining([
          expect.objectContaining({ path: "/home/u/proj", isMain: true }),
        ]),
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("exits with error when not in a git repo", async () => {
    vi.mocked(gitService.isGitRepo).mockReturnValueOnce(false);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const program = createProgram();
    await program.parseAsync(["node", "test", "worktree", "list"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(outputResult).not.toHaveBeenCalled();
  });
});

describe("linear worktree create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitService.isGitRepo).mockReturnValue(true);
    vi.mocked(gitService.repoRoot).mockReturnValue("/home/u/proj");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("uses default path (sibling of repo root) when no path arg supplied", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "uuid-ENG-42",
      identifier: "ENG-42",
      title: "Add Search Filter",
    } as never);
    vi.mocked(gitService.addWorktree).mockReturnValueOnce("created");

    const program = createProgram();
    await program.parseAsync(["node", "test", "worktree", "create", "ENG-42"]);

    expect(gitService.addWorktree).toHaveBeenCalledWith(
      "/home/u/eng-42",
      "eng-42/add-search-filter",
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        created: "/home/u/eng-42",
        branch: "eng-42/add-search-filter",
        action: "created",
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("honors a custom path arg (resolves to absolute)", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "uuid-ENG-7",
      identifier: "ENG-7",
      title: "x",
    } as never);
    vi.mocked(gitService.addWorktree).mockReturnValueOnce("created");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "worktree",
      "create",
      "ENG-7",
      "/tmp/scratch-7",
    ]);

    expect(gitService.addWorktree).toHaveBeenCalledWith(
      "/tmp/scratch-7",
      "eng-7/x",
    );
  });

  it("reports action='attached' when branch already exists", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "uuid-ENG-9",
      identifier: "ENG-9",
      title: "x",
    } as never);
    vi.mocked(gitService.addWorktree).mockReturnValueOnce("attached");

    const program = createProgram();
    await program.parseAsync(["node", "test", "worktree", "create", "ENG-9"]);

    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ action: "attached" }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("honors --branch override instead of the issue-derived name", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "uuid-ENG-42",
      identifier: "ENG-42",
      title: "Add Search Filter",
    } as never);
    vi.mocked(gitService.addWorktree).mockReturnValueOnce("attached");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "worktree",
      "create",
      "ENG-42",
      "--branch",
      "team/shared-feature",
    ]);

    expect(gitService.addWorktree).toHaveBeenCalledWith(
      "/home/u/eng-42",
      "team/shared-feature",
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "team/shared-feature" }),
      expect.any(Function),
      expect.any(Object),
    );
  });
});

describe("linear worktree remove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitService.isGitRepo).mockReturnValue(true);
    vi.mocked(gitService.repoRoot).mockReturnValue("/home/u/proj");
    vi.mocked(gitService.worktreeSafetyIssue).mockReturnValue(null);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("resolves an issue id to its sibling worktree and removes it", async () => {
    vi.mocked(gitService.listWorktrees).mockReturnValue([
      { path: "/home/u/proj", branch: "main", isMain: true },
      { path: "/home/u/eng-42", branch: "eng-42/x", isMain: false },
    ]);

    const program = createProgram();
    await program.parseAsync(["node", "test", "worktree", "remove", "ENG-42"]);

    expect(gitService.worktreeSafetyIssue).toHaveBeenCalledWith(
      "/home/u/eng-42",
    );
    expect(gitService.removeWorktree).toHaveBeenCalledWith(
      "/home/u/eng-42",
      false,
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        removed: "/home/u/eng-42",
        branch: "eng-42/x",
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("errors (no removal) when no worktree matches", async () => {
    vi.mocked(gitService.listWorktrees).mockReturnValue([
      { path: "/home/u/proj", branch: "main", isMain: true },
    ]);

    const program = createProgram();
    await program.parseAsync(["node", "test", "worktree", "remove", "ENG-99"]);

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("refuses to remove the main worktree", async () => {
    vi.mocked(gitService.listWorktrees).mockReturnValue([
      { path: "/home/u/proj", branch: "main", isMain: true },
    ]);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "worktree",
      "remove",
      "/home/u/proj",
    ]);

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("blocks an unsafe tree unless --force is given", async () => {
    vi.mocked(gitService.listWorktrees).mockReturnValue([
      { path: "/home/u/proj", branch: "main", isMain: true },
      { path: "/home/u/eng-42", branch: "eng-42/x", isMain: false },
    ]);
    vi.mocked(gitService.worktreeSafetyIssue).mockReturnValue(
      "worktree has uncommitted changes",
    );

    const program = createProgram();
    await program.parseAsync(["node", "test", "worktree", "remove", "ENG-42"]);

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("--force skips the safety check and removes anyway", async () => {
    vi.mocked(gitService.listWorktrees).mockReturnValue([
      { path: "/home/u/proj", branch: "main", isMain: true },
      { path: "/home/u/eng-42", branch: "eng-42/x", isMain: false },
    ]);
    vi.mocked(gitService.worktreeSafetyIssue).mockReturnValue(
      "worktree has uncommitted changes",
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "worktree",
      "remove",
      "ENG-42",
      "--force",
    ]);

    expect(gitService.worktreeSafetyIssue).not.toHaveBeenCalled();
    expect(gitService.removeWorktree).toHaveBeenCalledWith(
      "/home/u/eng-42",
      true,
    );
  });
});

describe("linear worktree info", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitService.isGitRepo).mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("reports isWorktree:false in the main repo", async () => {
    vi.mocked(gitService.isLinkedWorktree).mockReturnValue(false);

    const program = createProgram();
    await program.parseAsync(["node", "test", "worktree", "info"]);

    expect(outputResult).toHaveBeenCalledWith(
      { isWorktree: false },
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("reports path/name/branch/mainRepo inside a linked worktree", async () => {
    vi.mocked(gitService.isLinkedWorktree).mockReturnValue(true);
    vi.mocked(gitService.repoRoot).mockReturnValue("/home/u/eng-42");
    vi.mocked(gitService.currentBranch).mockReturnValue("eng-42/x");
    vi.mocked(gitService.mainRepoRoot).mockReturnValue("/home/u/proj");

    const program = createProgram();
    await program.parseAsync(["node", "test", "worktree", "info"]);

    expect(outputResult).toHaveBeenCalledWith(
      {
        isWorktree: true,
        path: "/home/u/eng-42",
        name: "eng-42",
        branch: "eng-42/x",
        mainRepo: "/home/u/proj",
      },
      expect.any(Function),
      expect.any(Object),
    );
  });
});

describe("resolveWorktreePath", () => {
  const worktrees = [
    { path: "/home/u/proj", branch: "main", isMain: true },
    { path: "/home/u/eng-42", branch: "eng-42/x", isMain: false },
  ];

  it("resolves an issue identifier to the sibling worktree path", () => {
    expect(resolveWorktreePath("ENG-42", "/home/u/proj", worktrees)).toBe(
      "/home/u/eng-42",
    );
  });

  it("resolves an absolute path that matches the registry", () => {
    expect(
      resolveWorktreePath("/home/u/eng-42", "/home/u/proj", worktrees),
    ).toBe("/home/u/eng-42");
  });

  it("resolves by basename when the path prefix differs", () => {
    expect(resolveWorktreePath("eng-42", "/somewhere/else", worktrees)).toBe(
      "/home/u/eng-42",
    );
  });

  it("returns null when nothing matches", () => {
    expect(resolveWorktreePath("ENG-99", "/home/u/proj", worktrees)).toBeNull();
  });
});

describe("formatWorktree", () => {
  it("(list): renders 📁 header with * on main and [branch] tags", () => {
    const out = formatWorktree({
      main: "/home/u/proj",
      worktrees: [
        { path: "/home/u/proj", branch: "main", isMain: true },
        { path: "/home/u/eng-42", branch: "eng-42/x", isMain: false },
      ],
    });
    expect(out).toContain("📁 Worktrees:");
    expect(out).toContain("  * /home/u/proj [main]");
    expect(out).toContain("    /home/u/eng-42 [eng-42/x]");
  });

  it("(list): tags detached worktrees as [detached]", () => {
    const out = formatWorktree({
      main: "/home/u/proj",
      worktrees: [
        { path: "/home/u/proj", branch: "main", isMain: true },
        { path: "/home/u/orphan", branch: "", isMain: false },
      ],
    });
    expect(out).toContain("    /home/u/orphan [detached]");
  });

  it("(create): 'Created worktree at <path> on branch <branch>' for action=created", () => {
    const out = formatWorktree({
      created: "/home/u/eng-42",
      branch: "eng-42/x",
      action: "created",
      issue: { id: "u", identifier: "ENG-42", title: "x" },
    });
    expect(out).toBe("Created worktree at /home/u/eng-42 on branch eng-42/x\n");
  });

  it("(create): 'Attached worktree at <path> on branch <branch>' for action=attached", () => {
    const out = formatWorktree({
      created: "/home/u/eng-9",
      branch: "eng-9/x",
      action: "attached",
      issue: { id: "u", identifier: "ENG-9", title: "x" },
    });
    expect(out).toBe("Attached worktree at /home/u/eng-9 on branch eng-9/x\n");
  });

  it("(remove): 'Removed worktree <path> (branch <branch>)'", () => {
    const out = formatWorktree({
      removed: "/home/u/eng-42",
      branch: "eng-42/x",
    });
    expect(out).toBe("Removed worktree /home/u/eng-42 (branch eng-42/x)\n");
  });

  it("(remove): omits the branch tag when unknown", () => {
    const out = formatWorktree({ removed: "/home/u/eng-42", branch: "" });
    expect(out).toBe("Removed worktree /home/u/eng-42\n");
  });

  it("(info): renders the worktree block for a linked worktree", () => {
    const out = formatWorktree({
      isWorktree: true,
      path: "/home/u/eng-42",
      name: "eng-42",
      branch: "eng-42/x",
      mainRepo: "/home/u/proj",
    });
    expect(out).toContain("Worktree: /home/u/eng-42");
    expect(out).toContain("  Name: eng-42");
    expect(out).toContain("  Branch: eng-42/x");
    expect(out).toContain("  Main repo: /home/u/proj");
  });

  it("(info): reports the main repository when not in a worktree", () => {
    const out = formatWorktree({ isWorktree: false });
    expect(out).toBe("Not in a git worktree (this is the main repository)\n");
  });
});
