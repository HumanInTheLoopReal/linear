//
// Format tests for `linear where` and `linear context`. Output is
// header + indented sections, using linear vocabulary (Workspace /
// Viewer / Default team).

import { describe, expect, it } from "vitest";
import { formatContext } from "../../../src/commands/context.js";
import { formatWhere } from "../../../src/commands/where.js";

describe("formatWhere", () => {
  const basePaths = {
    token_dir: "/Users/x/.linear",
    token_path: "/Users/x/.linear/token",
    token_exists: true,
    memory_path: "/Users/x/.linear/memory.json",
    memory_exists: true,
    audit_path: "/Users/x/.linear/interactions.jsonl",
    audit_exists: false,
    snapshots_dir: "/Users/x/.linear/snapshots",
    snapshots_exists: true,
  };

  it("renders the header + path block in an indented layout", () => {
    const out = formatWhere({
      cli_version: "2026.4.9",
      platform: { key: "linear" },
      cwd: "/repo",
      paths: basePaths,
      token: { source: "stored", resolved: true },
    });
    expect(out).toContain("linear v2026.4.9\n");
    expect(out).toContain("  cwd:        /repo\n");
    expect(out).toContain("  token:      /Users/x/.linear/token  [stored]\n");
    expect(out).toContain("  memory:     /Users/x/.linear/memory.json\n");
  });

  it("appends `[missing]` to paths whose `_exists` flag is false", () => {
    const out = formatWhere({
      cli_version: "1.0.0",
      platform: { key: "linear" },
      cwd: "/repo",
      paths: basePaths,
      token: { source: "stored", resolved: true },
    });
    // audit_exists=false in basePaths
    expect(out).toContain(
      "  audit:      /Users/x/.linear/interactions.jsonl  [missing]\n",
    );
    // memory_exists=true
    expect(out).not.toContain("memory.json  [missing]");
  });

  it("appends the resolved token source in brackets next to the token path", () => {
    const out = formatWhere({
      cli_version: "1.0.0",
      platform: { key: "linear" },
      cwd: "/repo",
      paths: basePaths,
      token: { source: "env", resolved: true },
    });
    expect(out).toContain("  [env]");
  });

  it("appends a Viewer block when result.viewer is populated", () => {
    const out = formatWhere({
      cli_version: "1.0.0",
      platform: { key: "linear" },
      cwd: "/repo",
      paths: basePaths,
      token: { source: "stored", resolved: true },
      viewer: {
        id: "v",
        name: "Fahad",
        email: "f@example.com",
        organization: { id: "o", name: "HumanInTheLoop", urlKey: "hitl" },
      },
    });
    expect(out).toContain("\nViewer:\n");
    expect(out).toContain("  workspace:  HumanInTheLoop\n");
    expect(out).toContain("  email:      f@example.com\n");
  });

  it("renders viewer_error in its own line when viewer call failed", () => {
    const out = formatWhere({
      cli_version: "1.0.0",
      platform: { key: "linear" },
      cwd: "/repo",
      paths: basePaths,
      token: { source: "stored", resolved: true },
      viewer_error: "401 Unauthorized",
    });
    expect(out).toContain("Viewer error: 401 Unauthorized");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatWhere({
      cli_version: "1.0.0",
      platform: { key: "linear" },
      cwd: "/repo",
      paths: basePaths,
      token: { source: "stored", resolved: true },
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("renders 'no scope' firehose line when scope.source = none", () => {
    const out = formatWhere({
      cli_version: "x",
      platform: { key: "linear" },
      cwd: "/repo",
      paths: basePaths,
      token: { source: "stored", resolved: true },
      scope: { source: "none" },
    });
    expect(out).toContain("Scope:");
    expect(out).toContain("(none — running in firehose mode)");
  });

  it("renders scope label + source tag when active", () => {
    const out = formatWhere({
      cli_version: "x",
      platform: { key: "linear" },
      cwd: "/repo",
      paths: basePaths,
      token: { source: "stored", resolved: true },
      scope: {
        label: "git:linear-cli",
        team: "ENG",
        project: "prj_abc",
        source: "local",
        config_path: "/repo/.linear/config.json",
      },
    });
    expect(out).toContain("label:      git:linear-cli  [local]");
    expect(out).toContain("team:       ENG");
    expect(out).toContain("project:    prj_abc");
    expect(out).toContain("config:     /repo/.linear/config.json");
  });
});

describe("formatContext", () => {
  const baseResult = {
    cli_version: "2026.4.9",
    backend: "linear" as const,
    config_path: "/Users/x/.linear/config.json",
  };

  it("renders three sections: Workspace, Viewer, Default team", () => {
    const out = formatContext({
      ...baseResult,
      workspace: { id: "w", name: "HumanInTheLoop", url_key: "hitl" },
      viewer: { id: "v", name: "Fahad", email: "f@example.com" },
      default_team: {
        configured: "TES",
        resolved: { id: "t", key: "TES", name: "TEST" },
      },
    });
    expect(out).toContain("linear v2026.4.9\n");
    expect(out).toContain("\nWorkspace:\n");
    expect(out).toContain("  name:        HumanInTheLoop\n");
    expect(out).toContain("\nViewer:\n");
    expect(out).toContain("  name:        Fahad\n");
    expect(out).toContain("\nDefault team:\n");
    expect(out).toContain("  configured:  TES\n");
    expect(out).toContain("  resolved:    TES (TEST)\n");
  });

  it("renders the '(none configured)' hint when team.default isn't set", () => {
    const out = formatContext({
      ...baseResult,
      workspace: null,
      viewer: null,
      default_team: { configured: null, resolved: null },
    });
    expect(out).toContain("Default team:\n");
    expect(out).toContain("(none configured");
  });

  it("renders '(unresolved)' when configured key didn't resolve to a team", () => {
    const out = formatContext({
      ...baseResult,
      workspace: null,
      viewer: null,
      default_team: {
        configured: "NOPE",
        resolved: null,
        error: "no team with key 'NOPE'",
      },
    });
    expect(out).toContain("  configured:  NOPE\n");
    expect(out).toContain(
      "  resolved:    (unresolved: no team with key 'NOPE')\n",
    );
  });

  it("appends an Errors block when result.errors is non-empty", () => {
    const out = formatContext({
      ...baseResult,
      workspace: null,
      viewer: null,
      default_team: { configured: null, resolved: null },
      errors: ["viewer query failed: 401", "team lookup failed: 500"],
    });
    expect(out).toContain("\nErrors:\n");
    expect(out).toContain("  - viewer query failed: 401\n");
    expect(out).toContain("  - team lookup failed: 500\n");
  });

  it("omits the Workspace section when workspace is null (e.g. degraded auth)", () => {
    const out = formatContext({
      ...baseResult,
      workspace: null,
      viewer: { id: "v", name: "Fahad", email: "f@example.com" },
      default_team: { configured: null, resolved: null },
    });
    expect(out).not.toContain("Workspace:");
    expect(out).toContain("Viewer:");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatContext({
      ...baseResult,
      workspace: null,
      viewer: null,
      default_team: { configured: null, resolved: null },
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
