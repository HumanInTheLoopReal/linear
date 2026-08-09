import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addWorktree,
  branchNameFromIssue,
  isLinkedWorktree,
  listWorktrees,
  mainRepoRoot,
  remoteBranchExists,
  removeWorktree,
  slugify,
  worktreeSafetyIssue,
} from "../../../src/services/git-service.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

/** Make execFileSync resolve successfully with `stdout` for the next call. */
function gitOk(stdout = ""): void {
  vi.mocked(execFileSync).mockReturnValueOnce(stdout);
}

/** Make execFileSync throw a non-zero git exit for the next call. */
function gitFail(status = 1, stdout = ""): void {
  vi.mocked(execFileSync).mockImplementationOnce(() => {
    const err = new Error("git failed") as Error & {
      status: number;
      stdout: string;
    };
    err.status = status;
    err.stdout = stdout;
    throw err;
  });
}

/** The argv passed to the Nth (0-based) git invocation. */
function gitArgs(call: number): readonly string[] {
  return vi.mocked(execFileSync).mock.calls[call][1] as readonly string[];
}

describe("slugify", () => {
  it("lowercases and replaces non-alphanumerics with single dashes", () => {
    expect(slugify("Add Search Filter")).toBe("add-search-filter");
    expect(slugify("Fix: bug in API!!")).toBe("fix-bug-in-api");
    expect(slugify("hello___world")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("--leading and trailing--")).toBe("leading-and-trailing");
    expect(slugify("!@#$ surrounded %^&*")).toBe("surrounded");
  });

  it("caps at maxLen and trims trailing dashes from the truncation", () => {
    const long = "a".repeat(80);
    expect(slugify(long, 50)).toBe("a".repeat(50));
    // truncation lands inside a dash run — must not end with `-`
    expect(slugify("abc-def-ghi-jkl-mno-pqrs", 8)).toBe("abc-def");
  });

  it("returns an empty string for input that has no alphanumerics", () => {
    expect(slugify("---")).toBe("");
    expect(slugify("@#$%")).toBe("");
    expect(slugify("   ")).toBe("");
  });
});

describe("listWorktrees (porcelain parser)", () => {
  it("parses main + linked worktrees with branches", () => {
    vi.mocked(execFileSync).mockReturnValueOnce(
      [
        "worktree /home/u/proj",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /home/u/eng-42",
        "HEAD def456",
        "branch refs/heads/eng-42/add-search",
        "",
      ].join("\n"),
    );
    const out = listWorktrees();
    expect(out).toEqual([
      { path: "/home/u/proj", branch: "main", isMain: true },
      {
        path: "/home/u/eng-42",
        branch: "eng-42/add-search",
        isMain: false,
      },
    ]);
  });

  it("flags detached worktrees with empty branch", () => {
    vi.mocked(execFileSync).mockReturnValueOnce(
      [
        "worktree /home/u/proj",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /home/u/detached",
        "HEAD def456",
        "detached",
        "",
      ].join("\n"),
    );
    const out = listWorktrees();
    expect(out[1].branch).toBe("");
    expect(out[1].isMain).toBe(false);
  });

  it("returns [] when git fails", () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      const err = new Error("not a repo") as Error & { status: number };
      err.status = 128;
      throw err;
    });
    expect(listWorktrees()).toEqual([]);
  });
});

describe("branchNameFromIssue", () => {
  it("combines lowercased identifier with slugified title", () => {
    expect(branchNameFromIssue("ENG-42", "Add Search Filter")).toBe(
      "eng-42/add-search-filter",
    );
  });

  it("falls back to the identifier alone when the slug is empty", () => {
    expect(branchNameFromIssue("ENG-1", "---")).toBe("eng-1");
    expect(branchNameFromIssue("ENG-1", "")).toBe("eng-1");
  });

  it("preserves numeric suffixes on identifiers", () => {
    expect(branchNameFromIssue("TES-1234", "x")).toBe("tes-1234/x");
  });
});

describe("remoteBranchExists", () => {
  afterEach(() => vi.clearAllMocks());

  it("matches a branch name under any remote (remote-agnostic)", () => {
    gitOk("origin/main\nupstream/feature-x\norigin/HEAD\n");
    expect(remoteBranchExists("feature-x")).toBe(true);
  });

  it("returns false when no remote carries the branch", () => {
    gitOk("origin/main\norigin/develop\n");
    expect(remoteBranchExists("feature-x")).toBe(false);
  });

  it("returns false when the for-each-ref call fails", () => {
    gitFail(128);
    expect(remoteBranchExists("anything")).toBe(false);
  });
});

describe("addWorktree", () => {
  afterEach(() => vi.clearAllMocks());

  it("attaches an existing local branch (no -b)", () => {
    gitOk(); // branchExists → show-ref succeeds
    gitOk(); // worktree add <path> <branch>
    expect(addWorktree("/wt/eng-1", "eng-1/x")).toBe("attached");
    expect(gitArgs(1)).toEqual(["worktree", "add", "/wt/eng-1", "eng-1/x"]);
  });

  it("DWIMs a remote-tracking branch into a local one (attach, no -b)", () => {
    gitFail(1); // branchExists → no local branch
    gitOk("origin/team-branch\n"); // remoteBranchExists → match
    gitOk(); // worktree add <path> <branch>
    expect(addWorktree("/wt/team", "team-branch")).toBe("attached");
    expect(gitArgs(2)).toEqual(["worktree", "add", "/wt/team", "team-branch"]);
  });

  it("creates a fresh branch from HEAD when nothing matches (-b)", () => {
    gitFail(1); // no local branch
    gitOk("origin/main\n"); // no remote match
    gitOk(); // worktree add -b <branch> <path>
    expect(addWorktree("/wt/new", "brand-new")).toBe("created");
    expect(gitArgs(2)).toEqual([
      "worktree",
      "add",
      "-b",
      "brand-new",
      "/wt/new",
    ]);
  });
});

describe("removeWorktree", () => {
  afterEach(() => vi.clearAllMocks());

  it("runs `worktree remove <path>` without --force by default", () => {
    gitOk();
    removeWorktree("/wt/eng-1", false);
    expect(gitArgs(0)).toEqual(["worktree", "remove", "/wt/eng-1"]);
  });

  it("adds --force when requested", () => {
    gitOk();
    removeWorktree("/wt/eng-1", true);
    expect(gitArgs(0)).toEqual(["worktree", "remove", "--force", "/wt/eng-1"]);
  });

  it("throws when git exits non-zero", () => {
    gitFail(1);
    expect(() => removeWorktree("/wt/eng-1", false)).toThrow(/failed/);
  });
});

describe("worktreeSafetyIssue", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns null for a clean, fully-pushed tree", () => {
    gitOk(""); // status --porcelain (clean)
    gitOk(""); // log @{upstream}.. (nothing unpushed)
    expect(worktreeSafetyIssue("/wt/eng-1")).toBeNull();
  });

  it("flags uncommitted changes", () => {
    gitOk(" M src/foo.ts\n");
    expect(worktreeSafetyIssue("/wt/eng-1")).toBe(
      "worktree has uncommitted changes",
    );
  });

  it("flags unpushed commits", () => {
    gitOk(""); // clean status
    gitOk("abc123 wip\n"); // unpushed log
    expect(worktreeSafetyIssue("/wt/eng-1")).toBe(
      "worktree has unpushed commits",
    );
  });

  it("treats a missing upstream as safe (no comparison possible)", () => {
    gitOk(""); // clean status
    gitFail(128); // log @{upstream}.. → no upstream
    expect(worktreeSafetyIssue("/wt/eng-1")).toBeNull();
  });
});

describe("isLinkedWorktree", () => {
  afterEach(() => vi.clearAllMocks());

  it("is true when git-dir differs from git-common-dir", () => {
    gitOk("/home/u/proj/.git/worktrees/eng-1\n"); // --git-dir
    gitOk("/home/u/proj/.git\n"); // --git-common-dir
    expect(isLinkedWorktree()).toBe(true);
  });

  it("is false in the main working tree (dirs identical)", () => {
    gitOk("/home/u/proj/.git\n");
    gitOk("/home/u/proj/.git\n");
    expect(isLinkedWorktree()).toBe(false);
  });
});

describe("mainRepoRoot", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns the parent of the shared git common dir", () => {
    gitOk("/home/u/proj/.git\n");
    expect(mainRepoRoot()).toBe("/home/u/proj");
  });

  it("returns empty string when not in a repo", () => {
    gitFail(128);
    expect(mainRepoRoot()).toBe("");
  });
});
