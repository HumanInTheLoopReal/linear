import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileSyncMock = vi.fn<(...args: unknown[]) => string>();

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

const {
  deriveScopeLabel,
  getGitRemoteUrl,
  getGitTopLevel,
  parseRepoNameFromRemote,
} = await import("../../../src/common/git-remote.js");

describe("parseRepoNameFromRemote", () => {
  it("parses SSH-style git@host:org/repo.git", () => {
    expect(parseRepoNameFromRemote("git@github.com:org/repo.git")).toBe("repo");
  });

  it("parses HTTPS-style URLs", () => {
    expect(parseRepoNameFromRemote("https://github.com/org/repo.git")).toBe(
      "repo",
    );
  });

  it("strips trailing slash", () => {
    expect(parseRepoNameFromRemote("https://github.com/org/repo/")).toBe(
      "repo",
    );
  });

  it("strips trailing .git suffix", () => {
    expect(parseRepoNameFromRemote("https://github.com/org/repo.git")).toBe(
      "repo",
    );
  });

  it("handles SCP-ish form without .git suffix", () => {
    expect(parseRepoNameFromRemote("github.com:org/repo")).toBe("repo");
  });

  it("handles nested paths (last segment wins)", () => {
    expect(parseRepoNameFromRemote("git@gitlab.com:group/sub/repo.git")).toBe(
      "repo",
    );
  });

  it("handles file URLs", () => {
    expect(parseRepoNameFromRemote("file:///srv/git/repo.git")).toBe("repo");
  });

  it("handles a bare basename", () => {
    expect(parseRepoNameFromRemote("repo")).toBe("repo");
  });

  it("returns null on empty input", () => {
    expect(parseRepoNameFromRemote("")).toBeNull();
  });

  it("returns null when the URL collapses to just .git", () => {
    expect(parseRepoNameFromRemote(".git")).toBeNull();
  });

  it("trims whitespace before parsing", () => {
    expect(parseRepoNameFromRemote("  git@github.com:o/r.git\n")).toBe("r");
  });
});

describe("getGitRemoteUrl / getGitTopLevel", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it("getGitRemoteUrl returns the trimmed origin URL", () => {
    execFileSyncMock.mockReturnValueOnce(
      "git@github.com:fahadkaleem/linear-cli.git\n",
    );
    expect(getGitRemoteUrl()).toBe("git@github.com:fahadkaleem/linear-cli.git");
  });

  it("getGitRemoteUrl returns null when git throws (no origin / not a repo)", () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error("fatal: not a git repository");
    });
    expect(getGitRemoteUrl()).toBeNull();
  });

  it("getGitRemoteUrl returns null on empty stdout", () => {
    execFileSyncMock.mockReturnValueOnce("\n");
    expect(getGitRemoteUrl()).toBeNull();
  });

  it("getGitTopLevel returns the trimmed repo root", () => {
    execFileSyncMock.mockReturnValueOnce("/home/user/projects/linear-cli\n");
    expect(getGitTopLevel()).toBe("/home/user/projects/linear-cli");
  });

  it("getGitTopLevel returns null outside a git repo", () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error("not a repo");
    });
    expect(getGitTopLevel()).toBeNull();
  });
});

describe("deriveScopeLabel", () => {
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execFileSyncMock.mockReset();
    cwdSpy = vi.spyOn(process, "cwd");
  });

  afterEach(() => {
    cwdSpy.mockRestore();
  });

  it("prefers the remote-derived name when available", () => {
    execFileSyncMock.mockImplementation((_cmd: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv[0] === "remote") {
        return "git@github.com:fahadkaleem/linear-cli.git\n";
      }
      if (argv[0] === "rev-parse") return "/some/repo\n";
      throw new Error("unexpected git call");
    });
    expect(deriveScopeLabel()).toEqual({
      label: "git:linear-cli",
      source: "git_remote",
    });
  });

  it("falls back to toplevel basename when origin is absent", () => {
    execFileSyncMock.mockImplementation((_cmd: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv[0] === "remote") throw new Error("no origin");
      if (argv[0] === "rev-parse") {
        return "/home/me/projects/foo-repo\n";
      }
      throw new Error("unexpected");
    });
    expect(deriveScopeLabel()).toEqual({
      label: "git:foo-repo",
      source: "toplevel",
    });
  });

  it("falls back to cwd basename when not in a git repo", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not a repo");
    });
    cwdSpy.mockReturnValue("/tmp/bare-dir");
    expect(deriveScopeLabel()).toEqual({
      label: "git:bare-dir",
      source: "cwd",
    });
  });

  it("returns null when cwd is the filesystem root", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not a repo");
    });
    cwdSpy.mockReturnValue(path.parse(process.cwd()).root);
    expect(deriveScopeLabel()).toBeNull();
  });
});
