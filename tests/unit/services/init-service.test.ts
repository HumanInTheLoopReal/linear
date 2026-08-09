import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  runInit,
  STEALTH_EXCLUDE_PATTERNS,
  setupGitExclude,
} from "../../../src/services/init-service.js";

function isOpNamed(doc: unknown, name: string): boolean {
  const defs =
    (doc as { definitions?: Array<{ name?: { value?: string } }> })
      .definitions ?? [];
  return defs.some((d) => d.name?.value === name);
}

function viewerResp() {
  return {
    viewer: {
      id: "u1",
      name: "Alice",
      email: "alice@acme.com",
      organization: { id: "o1", name: "Acme", urlKey: "acme" },
    },
  };
}

function teamResp(key: string) {
  return {
    teams: { nodes: [{ id: `t-${key}`, key, name: `Team ${key}` }] },
  };
}

function makeClient(
  handlers: Record<string, () => unknown> = {},
): GraphQLClient {
  return {
    request: vi.fn(async (doc: unknown) => {
      for (const [name, fn] of Object.entries(handlers)) {
        if (isOpNamed(doc, name)) return fn();
      }
      throw new Error("unexpected op");
    }),
  } as unknown as GraphQLClient;
}

let tmpHome: string;
let tmpCwd: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "init-home-"));
  tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "init-cwd-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

describe("runInit — happy path (default plan, hooks opted out for tmpdir)", () => {
  it("validates identity, writes AGENTS.md, installs claude hook", async () => {
    const client = makeClient({
      GetViewerWithOrg: viewerResp,
    });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      cwd: tmpCwd,
      env: {},
      hooks: [], // skip hook install (no .git in tmpdir)
    });

    expect(result.backend).toBe("linear");
    expect(result.role).toBe("maintainer");
    expect(result.context.viewer).toEqual({
      id: "u1",
      name: "Alice",
      email: "alice@acme.com",
    });
    expect(result.context.workspace?.url_key).toBe("acme");

    expect(result.team_written).toBeNull();
    expect(result.agents_action).toBe("created");
    expect(result.agents_profile).toBe("minimal");
    expect(result.agents_file).toBe(path.join(tmpCwd, "AGENTS.md"));
    expect(fs.existsSync(path.join(tmpCwd, "AGENTS.md"))).toBe(true);

    // Thin CLAUDE.md pointer is written when absent.
    expect(result.claude_md_action).toBe("created");
    expect(result.claude_md_file).toBe(path.join(tmpCwd, "CLAUDE.md"));
    expect(fs.existsSync(path.join(tmpCwd, "CLAUDE.md"))).toBe(true);

    expect(result.claude_hook?.recipe).toBe("claude");
    expect(result.claude_hook?.scope).toBe("global");
    expect(result.claude_hook?.path).toBe(
      path.join(tmpHome, ".claude", "settings.json"),
    );
    expect(fs.existsSync(result.claude_hook?.path ?? "")).toBe(true);

    expect(result.hooks).toBeNull();
    expect(result.hooks_skipped_reason).toMatch(/no hooks selected/);
  });
});

describe("runInit — --team", () => {
  it("writes team.default before running identity probe", async () => {
    const client = makeClient({
      GetViewerWithOrg: viewerResp,
      GetTeamByKey: () => teamResp("ENG"),
    });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      team: "ENG",
      cwd: tmpCwd,
      env: {},
      hooks: [],
    });

    expect(result.team_written).toBe("ENG");
    expect(result.context.default_team.configured).toBe("ENG");
    expect(result.context.default_team.resolved).toEqual({
      id: "t-ENG",
      key: "ENG",
      name: "Team ENG",
    });
  });
});

describe("runInit — --skip-agents", () => {
  it("skips AGENTS.md, CLAUDE.md, and claude hook install", async () => {
    const client = makeClient({ GetViewerWithOrg: viewerResp });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      skipAgents: true,
      cwd: tmpCwd,
      env: {},
      hooks: [],
    });

    expect(result.agents_action).toBe("skipped");
    expect(result.agents_file).toBeNull();
    expect(result.claude_md_action).toBe("skipped");
    expect(result.claude_md_file).toBeNull();
    expect(result.claude_hook).toBeNull();
    expect(fs.existsSync(path.join(tmpCwd, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpCwd, "CLAUDE.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpHome, ".claude", "settings.json"))).toBe(
      false,
    );
  });
});

describe("runInit — AGENTS.md already exists without our markers", () => {
  it("appends the managed block; preserves the user content", async () => {
    const agentsPath = path.join(tmpCwd, "AGENTS.md");
    fs.writeFileSync(agentsPath, "# pre-existing\n");
    const client = makeClient({ GetViewerWithOrg: viewerResp });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      cwd: tmpCwd,
      env: {},
      hooks: [],
    });
    // The behavior appends the managed block when the file exists
    // without markers.
    expect(result.agents_action).toBe("appended");
    const next = fs.readFileSync(agentsPath, "utf8");
    expect(next.startsWith("# pre-existing\n")).toBe(true);
    expect(next).toContain("BEGIN LINEAR INTEGRATION");
    expect(next).toContain("END LINEAR INTEGRATION");
  });
});

describe("runInit — CLAUDE.md already exists", () => {
  it("never overwrites; reports claude_md_action=exists", async () => {
    const claudePath = path.join(tmpCwd, "CLAUDE.md");
    fs.writeFileSync(claudePath, "# my custom claude config\n");
    const client = makeClient({ GetViewerWithOrg: viewerResp });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      cwd: tmpCwd,
      env: {},
      hooks: [],
    });
    expect(result.claude_md_action).toBe("exists");
    expect(fs.readFileSync(claudePath, "utf8")).toBe(
      "# my custom claude config\n",
    );
  });
});

describe("runInit — --skip-hooks", () => {
  it("reports the explicit skip reason", async () => {
    const client = makeClient({ GetViewerWithOrg: viewerResp });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      skipHooks: true,
      skipAgents: true,
      cwd: tmpCwd,
      env: {},
    });
    expect(result.hooks_skipped_reason).toMatch(/explicitly skipped/);
  });
});

describe("runInit — --stealth", () => {
  it("skips AGENTS.md, CLAUDE.md, recipes, hooks; team still writes", async () => {
    const client = makeClient({
      GetViewerWithOrg: viewerResp,
      GetTeamByKey: () => teamResp("ENG"),
    });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      team: "ENG",
      stealth: true,
      cwd: tmpCwd,
      env: {},
    });
    expect(result.stealth).toBe(true);
    expect(result.team_written).toBe("ENG");
    expect(result.agents_action).toBe("skipped");
    expect(result.agents_file).toBeNull();
    expect(result.claude_md_action).toBe("skipped");
    expect(result.recipes).toEqual([]);
    expect(result.hooks).toBeNull();
    expect(result.hooks_skipped_reason).toMatch(/stealth/);
    expect(fs.existsSync(path.join(tmpCwd, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpCwd, "CLAUDE.md"))).toBe(false);
    // tmpCwd has no .git → stealth git-exclude is skipped, not a hard error.
    expect(result.stealth_exclude?.skipped_not_git).toBe(true);
  });
});

describe("runInit — --contributor", () => {
  it("skips team write, recipes, hooks, agent files; identity probe still runs", async () => {
    const client = makeClient({
      GetViewerWithOrg: viewerResp,
    });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      contributor: true,
      // even with --team given, contributor mode does not write team.default
      team: "ENG",
      cwd: tmpCwd,
      env: {},
    });
    expect(result.role).toBe("contributor");
    expect(result.team_written).toBeNull();
    expect(result.agents_action).toBe("skipped");
    expect(result.claude_md_action).toBe("skipped");
    expect(result.recipes).toEqual([]);
    expect(result.hooks).toBeNull();
    expect(result.hooks_skipped_reason).toMatch(/contributor/);
  });
});

describe("runInit — --agents-profile=full", () => {
  it("writes the full-profile managed block; re-running with minimal preserves full", async () => {
    const client = makeClient({ GetViewerWithOrg: viewerResp });
    const r1 = await runInit({
      client,
      cliVersion: "9.9.9",
      cwd: tmpCwd,
      env: {},
      hooks: [],
      agentsProfile: "full",
    });
    expect(r1.agents_action).toBe("created");
    expect(r1.agents_profile).toBe("full");
    const content1 = fs.readFileSync(path.join(tmpCwd, "AGENTS.md"), "utf8");
    expect(content1).toContain("profile:full");

    const r2 = await runInit({
      client,
      cliVersion: "9.9.9",
      cwd: tmpCwd,
      env: {},
      hooks: [],
      agentsProfile: "minimal",
    });
    expect(r2.agents_profile).toBe("full");
    // Should report preserved or current (not replaced/appended).
    expect(["preserved", "current"]).toContain(r2.agents_action);
    const content2 = fs.readFileSync(path.join(tmpCwd, "AGENTS.md"), "utf8");
    expect(content2).toContain("profile:full");
    expect(content2).not.toContain("profile:minimal");
  });
});

describe("runInit — --agents-file", () => {
  it("writes to the custom filename and persists agents.file in config", async () => {
    const client = makeClient({ GetViewerWithOrg: viewerResp });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      cwd: tmpCwd,
      env: {},
      hooks: [],
      agentsFile: "NOTES.md",
    });
    expect(result.agents_file).toBe(path.join(tmpCwd, "NOTES.md"));
    expect(fs.existsSync(path.join(tmpCwd, "NOTES.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpCwd, "AGENTS.md"))).toBe(false);

    // The persisted config value should now reflect the custom filename.
    const cfgPath = path.join(tmpHome, ".linear", "config.json");
    expect(fs.existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    expect(cfg["agents.file"]).toBe("NOTES.md");
  });
});

describe("runInit — --agents-template", () => {
  it("clobbers the file with the custom template when absent", async () => {
    const templatePath = path.join(tmpCwd, "tpl.md");
    fs.writeFileSync(templatePath, "# custom from --agents-template\n");
    const client = makeClient({ GetViewerWithOrg: viewerResp });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      cwd: tmpCwd,
      env: {},
      hooks: [],
      agentsTemplate: templatePath,
    });
    expect(result.agents_action).toBe("created");
    expect(fs.readFileSync(path.join(tmpCwd, "AGENTS.md"), "utf8")).toBe(
      "# custom from --agents-template\n",
    );
  });
});

describe("runInit — interactive=false in non-TTY env", () => {
  it("interactive flag is false when stdin is not a TTY and no flags set", async () => {
    const client = makeClient({ GetViewerWithOrg: viewerResp });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      cwd: tmpCwd,
      env: {},
      isTTY: false,
      hooks: [],
    });
    expect(result.interactive).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// setupGitExclude — stealth .git/info/exclude (lin-lntd)
// Needs a real git repo so `git rev-parse --git-common-dir` resolves.
// ──────────────────────────────────────────────────────────────────────

describe("setupGitExclude (stealth git-exclude)", () => {
  let repo: string;

  function excludePath(): string {
    return path.join(repo, ".git", "info", "exclude");
  }

  beforeEach(() => {
    repo = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "init-stealth-")),
    );
    execFileSync("git", ["-C", repo, "init", "-q"], { stdio: "ignore" });
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("appends linear's local-only patterns under a marker header", () => {
    const result = setupGitExclude(repo);
    expect(result.skipped_not_git).toBe(false);
    expect(result.added).toEqual(STEALTH_EXCLUDE_PATTERNS);
    expect(result.already_present).toEqual([]);

    const content = fs.readFileSync(excludePath(), "utf8");
    expect(content).toContain("# Linear stealth mode");
    for (const p of STEALTH_EXCLUDE_PATTERNS) {
      expect(content).toContain(p);
    }
  });

  it("is idempotent — a second run adds nothing", () => {
    setupGitExclude(repo);
    const before = fs.readFileSync(excludePath(), "utf8");
    const second = setupGitExclude(repo);
    expect(second.added).toEqual([]);
    expect(second.already_present).toEqual(STEALTH_EXCLUDE_PATTERNS);
    expect(fs.readFileSync(excludePath(), "utf8")).toBe(before);
  });

  it("preserves pre-existing exclude content and only adds the missing patterns", () => {
    fs.mkdirSync(path.join(repo, ".git", "info"), { recursive: true });
    fs.writeFileSync(excludePath(), "# user's own ignore\nbuild/\n.linear/\n");
    const result = setupGitExclude(repo);
    // .linear/ already present; only .claude/settings.local.json is added
    expect(result.already_present).toContain(".linear/");
    expect(result.added).toEqual([".claude/settings.local.json"]);
    const content = fs.readFileSync(excludePath(), "utf8");
    expect(content).toContain("build/");
    expect(content).toContain(".claude/settings.local.json");
  });

  it("reports skipped_not_git when cwd is not a git repo", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "init-nogit-"));
    try {
      const result = setupGitExclude(bare);
      expect(result.skipped_not_git).toBe(true);
      expect(result.path).toBeNull();
      expect(result.added).toEqual([]);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it("runInit --stealth writes the exclude in a real git repo", async () => {
    execFileSync("git", ["-C", repo, "init", "-q"], { stdio: "ignore" });
    const client = makeClient({
      GetViewerWithOrg: viewerResp,
      GetTeamByKey: () => teamResp("ENG"),
    });
    const result = await runInit({
      client,
      cliVersion: "9.9.9",
      team: "ENG",
      stealth: true,
      cwd: repo,
      env: {},
    });
    expect(result.stealth_exclude?.skipped_not_git).toBe(false);
    expect(result.stealth_exclude?.added).toEqual(STEALTH_EXCLUDE_PATTERNS);
    expect(fs.readFileSync(excludePath(), "utf8")).toContain(
      ".claude/settings.local.json",
    );
  });
});
