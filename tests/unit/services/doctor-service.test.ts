import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  isCheckName,
  runDoctor,
} from "../../../src/services/doctor-service.js";

// lin-i79e: doctor now also runs four integration-health checks
// (claude_plugin, claude_settings, claude_hooks, cli_in_path) that probe
// the filesystem + PATH. To keep the workspace-check assertions below
// deterministic, every full-run (no `only`) test injects an isolated,
// empty `.claude`-free home/cwd and a PATH containing a stub `linear`
// binary. Result: all four agent checks resolve to status "ok" — they add
// exactly 4 ok-checks and never warn/error, so existing count math just
// adds 4. Tests that pass `only:` a workspace check never trigger the
// agent family (resolveAgentChecks returns [] for non-agent names).
const agentTmp = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-svc-agent-"));
const agentHome = path.join(agentTmp, "home");
const agentCwd = path.join(agentTmp, "project");
const agentBin = path.join(agentTmp, "bin");
fs.mkdirSync(agentHome, { recursive: true });
fs.mkdirSync(agentCwd, { recursive: true });
fs.mkdirSync(agentBin, { recursive: true });
{
  const exe = path.join(agentBin, "linear");
  fs.writeFileSync(exe, "#!/bin/sh\n");
  fs.chmodSync(exe, 0o755);
}
// Spread into runDoctor for full-run tests to neutralize the agent checks.
const agentIso = { home: agentHome, cwd: agentCwd, pathEnv: agentBin } as const;
// Number of integration-health checks doctor always appends on a full run.
const AGENT_CHECK_COUNT = 4;

afterAll(() => {
  fs.rmSync(agentTmp, { recursive: true, force: true });
});

function isQueryNamed(doc: unknown, name: string): boolean {
  const defs =
    (doc as { definitions?: Array<{ name?: { value?: string } }> })
      .definitions ?? [];
  return defs.some((d) => d.name?.value === name);
}

function makeClient(handler: (doc: unknown) => unknown): GraphQLClient {
  const request = vi.fn(async (doc: unknown) => handler(doc));
  return { request } as unknown as GraphQLClient;
}

function viewer(name = "Alex") {
  return { viewer: { id: "u-1", name, email: `${name}@example.com` } };
}
function staleResp(n: number) {
  return {
    issues: {
      nodes: Array.from({ length: n }, (_, i) => ({ id: `s-${i}` })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}
function orphanResp(n: number) {
  return {
    issues: {
      nodes: Array.from({ length: n }, (_, i) => ({ id: `o-${i}` })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}
function closedNotArchivedResp(n: number) {
  return {
    issues: {
      nodes: Array.from({ length: n }, (_, i) => ({ id: `cna-${i}` })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}
function brokenParentResp(n: number) {
  return {
    issues: {
      nodes: Array.from({ length: n }, (_, i) => ({ id: `bp-${i}` })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}
function labelsResp(names: string[]) {
  return {
    issueLabels: {
      nodes: names.map((n, i) => ({
        id: `l-${i}`,
        name: n,
        color: "#000",
        description: null,
      })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

describe("isCheckName", () => {
  it("accepts the documented names", () => {
    for (const n of [
      "auth",
      "stale",
      "unassigned",
      "labels",
      "closed_not_archived",
      "broken_parent_edges",
      "stale_by_team_default",
      // lin-i79e: integration-health check names.
      "claude_plugin",
      "claude_settings",
      "claude_hooks",
      "cli_in_path",
    ]) {
      expect(isCheckName(n)).toBe(true);
    }
  });
  it("rejects anything else", () => {
    expect(isCheckName("bogus")).toBe(false);
  });
});

describe("runDoctor — integration-health checks (lin-i79e)", () => {
  it("runs only the named agent check with `only` and makes no GraphQL calls", async () => {
    const request = vi.fn(async () => {
      throw new Error("no GraphQL expected for an agent-only check");
    });
    const client = { request } as unknown as GraphQLClient;
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "claude_hooks",
      verbose: true,
      ...agentIso,
    });
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.name).toBe("claude_hooks");
    expect(request).not.toHaveBeenCalled();
  });

  it("cli_in_path warns and flips nothing fatal when the CLI is off PATH", async () => {
    const request = vi.fn(async () => {
      throw new Error("no GraphQL expected for an agent-only check");
    });
    const client = { request } as unknown as GraphQLClient;
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "cli_in_path",
      verbose: true,
      home: agentHome,
      cwd: agentCwd,
      pathEnv: "",
    });
    const c = result.checks.find((c) => c.name === "cli_in_path");
    expect(c?.status).toBe("warning");
    // A warning does not fail the overall report.
    expect(result.overall_ok).toBe(true);
  });
});

describe("runDoctor — envelope shape", () => {
  it("emits {path, checks, overall_ok, cli_version, timestamp, platform, suppressed_count}", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewer();
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResp(0);
      if (isQueryNamed(doc, "CountOrphanIssues")) return orphanResp(0);
      if (isQueryNamed(doc, "GetLabels")) return labelsResp([]);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResp(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResp(0);
      throw new Error("unexpected query");
    });
    const result = await runDoctor({
      client,
      cliVersion: "test-1.2.3",
      cwd: "/tmp/test",
      home: agentHome,
      pathEnv: agentBin,
    });
    expect(result.path).toBe("/tmp/test");
    expect(result.cli_version).toBe("test-1.2.3");
    expect(result.platform).toEqual({ key: "linear" });
    expect(typeof result.timestamp).toBe("string");
    expect(result.overall_ok).toBe(true);
  });
});

describe("runDoctor — suppression of OK checks", () => {
  it("hides ok-checks by default and increments suppressed_count", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewer();
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResp(0);
      if (isQueryNamed(doc, "CountOrphanIssues")) return orphanResp(0);
      if (isQueryNamed(doc, "GetLabels")) return labelsResp([]);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResp(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResp(0);
      throw new Error("unexpected query");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      scope: {},
      ...agentIso,
    });
    expect(result.checks).toEqual([]);
    expect(result.suppressed_count).toBe(6 + AGENT_CHECK_COUNT);
    expect(result.overall_ok).toBe(true);
  });

  it("keeps all checks when verbose: true", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewer();
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResp(0);
      if (isQueryNamed(doc, "CountOrphanIssues")) return orphanResp(0);
      if (isQueryNamed(doc, "GetLabels")) return labelsResp([]);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResp(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResp(0);
      throw new Error("unexpected query");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      verbose: true,
      scope: {},
      ...agentIso,
    });
    expect(result.checks).toHaveLength(6 + AGENT_CHECK_COUNT);
    expect(result.suppressed_count).toBe(0);
    // The four integration-health checks are all present and ok.
    for (const n of [
      "claude_plugin",
      "claude_settings",
      "claude_hooks",
      "cli_in_path",
    ]) {
      const c = result.checks.find((c) => c.name === n);
      expect(c?.status).toBe("ok");
      expect(c?.category).toBe("integration");
    }
  });
});

describe("runDoctor — auth failure escalates to error", () => {
  it("marks overall_ok=false when the viewer query throws", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) throw new Error("401");
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResp(0);
      if (isQueryNamed(doc, "CountOrphanIssues")) return orphanResp(0);
      if (isQueryNamed(doc, "GetLabels")) return labelsResp([]);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResp(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResp(0);
      throw new Error("unexpected query");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      ...agentIso,
    });
    expect(result.overall_ok).toBe(false);
    const auth = result.checks.find((c) => c.name === "auth");
    expect(auth?.status).toBe("error");
    expect(auth?.fix).toMatch(/linear auth/);
  });
});

describe("runDoctor — stale / unassigned warn but do not fail overall", () => {
  it("non-zero stale yields a warning + overall_ok remains true", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewer();
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResp(5);
      if (isQueryNamed(doc, "CountOrphanIssues")) return orphanResp(2);
      if (isQueryNamed(doc, "GetLabels")) return labelsResp([]);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResp(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResp(0);
      throw new Error("unexpected query");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      ...agentIso,
    });
    expect(result.overall_ok).toBe(true);
    const stale = result.checks.find((c) => c.name === "stale");
    const unassigned = result.checks.find((c) => c.name === "unassigned");
    expect(stale?.status).toBe("warning");
    expect(unassigned?.status).toBe("warning");
  });
});

describe("runDoctor — labels check", () => {
  it("trivially passes when no required labels are configured", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewer();
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResp(0);
      if (isQueryNamed(doc, "CountOrphanIssues")) return orphanResp(0);
      if (isQueryNamed(doc, "GetLabels")) return labelsResp([]);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResp(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResp(0);
      throw new Error("unexpected query");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      requiredLabels: [],
      verbose: true,
      ...agentIso,
    });
    const labels = result.checks.find((c) => c.name === "labels");
    expect(labels?.status).toBe("ok");
  });

  it("warns when a required label is missing", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewer();
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResp(0);
      if (isQueryNamed(doc, "CountOrphanIssues")) return orphanResp(0);
      if (isQueryNamed(doc, "GetLabels"))
        return labelsResp(["convention:foo", "tier:linear-direct"]);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResp(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResp(0);
      throw new Error("unexpected query");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      requiredLabels: ["convention:foo", "convention:missing"],
      verbose: true,
      ...agentIso,
    });
    const labels = result.checks.find((c) => c.name === "labels");
    expect(labels?.status).toBe("warning");
    expect(labels?.message).toContain("convention:missing");
  });
});

describe("runDoctor — only filter restricts to one check", () => {
  it("runs only the named check", async () => {
    const request = vi.fn(async (doc: unknown) => {
      if (isQueryNamed(doc, "GetViewer")) return viewer();
      throw new Error("only auth should run");
    });
    const client = { request } as unknown as GraphQLClient;
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "auth",
      verbose: true,
    });
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.name).toBe("auth");
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("runDoctor — scope checks", () => {
  it("scope checks are omitted when no scope is configured", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewer();
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResp(0);
      if (isQueryNamed(doc, "CountOrphanIssues")) return orphanResp(0);
      if (isQueryNamed(doc, "GetLabels")) return labelsResp([]);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResp(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResp(0);
      throw new Error("unexpected query");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      scope: {},
      verbose: true,
      ...agentIso,
    });
    const scopeChecks = result.checks.filter((c) =>
      c.name.startsWith("scope_"),
    );
    expect(scopeChecks).toEqual([]);
  });

  it("warns when scope.label does not exist as a Linear label", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetLabels")) return labelsResp([]);
      throw new Error("unexpected query");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "scope_label_exists",
      scope: { label: "git:linear-cli" },
      verbose: true,
    });
    const c = result.checks.find((c) => c.name === "scope_label_exists");
    expect(c?.status).toBe("warning");
    expect(c?.fix).toMatch(/linear adopt|linear create/);
  });

  it("ok when scope.label exists as a Linear label", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetLabels")) return labelsResp(["git:linear-cli"]);
      throw new Error("unexpected query");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "scope_label_exists",
      scope: { label: "git:linear-cli" },
      verbose: true,
    });
    const c = result.checks.find((c) => c.name === "scope_label_exists");
    expect(c?.status).toBe("ok");
  });

  it("scope_coverage is skipped without scope.project even with scope.label", async () => {
    const client = makeClient(() => {
      throw new Error("no requests expected");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "scope_coverage",
      scope: { label: "git:x" },
      verbose: true,
    });
    expect(result.checks).toEqual([]);
  });

  it("scope_coverage reports a project-resolution error without querying", async () => {
    const request = vi.fn(async () => {
      throw new Error("no GraphQL request expected");
    });
    const result = await runDoctor({
      client: { request } as unknown as GraphQLClient,
      cliVersion: "x",
      only: "scope_coverage",
      scope: { label: "git:x", project: "Missing Roadmap" },
      scopeProject: {
        name: "Missing Roadmap",
        resolutionError: "Project not found",
      },
      verbose: true,
    });

    expect(result.checks).toEqual([
      expect.objectContaining({
        name: "scope_coverage",
        status: "error",
        detail: "Project not found",
      }),
    ]);
    expect(result.overall_ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("scope_drift returns ok or warning based on git derivation", async () => {
    const client = makeClient(() => {
      throw new Error("scope_drift is pure-CPU");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "scope_drift",
      scope: { label: "git:something-unlikely-to-match" },
      verbose: true,
    });
    const c = result.checks.find((c) => c.name === "scope_drift");
    expect(c?.status).toBeDefined();
    expect(["ok", "warning"]).toContain(c?.status);
  });
});

describe("runDoctor — hygiene checks (lin-hqiz)", () => {
  it("closed_not_archived is ok below threshold", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResp(10);
      throw new Error("only closed_not_archived should run");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "closed_not_archived",
      verbose: true,
    });
    const c = result.checks.find((c) => c.name === "closed_not_archived");
    expect(c?.status).toBe("ok");
    expect(c?.observed_state).toBe("closed_not_archived_count=10");
  });

  it("closed_not_archived warns at threshold", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResp(60);
      throw new Error("only closed_not_archived should run");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "closed_not_archived",
      verbose: true,
    });
    const c = result.checks.find((c) => c.name === "closed_not_archived");
    expect(c?.status).toBe("warning");
    expect(c?.message).toContain("60 closed");
  });

  it("broken_parent_edges is ok when count is 0", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResp(0);
      throw new Error("only broken_parent_edges should run");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "broken_parent_edges",
      verbose: true,
    });
    const c = result.checks.find((c) => c.name === "broken_parent_edges");
    expect(c?.status).toBe("ok");
  });

  it("broken_parent_edges warns when any open issue has an archived parent", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResp(3);
      throw new Error("only broken_parent_edges should run");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "broken_parent_edges",
      verbose: true,
    });
    const c = result.checks.find((c) => c.name === "broken_parent_edges");
    expect(c?.status).toBe("warning");
    expect(c?.message).toContain("3 open issue(s)");
  });

  it("stale_by_team_default is omitted when no default team was resolved", async () => {
    const client = makeClient(() => {
      throw new Error("no requests expected when team.default is null");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "stale_by_team_default",
      verbose: true,
    });
    expect(result.checks).toEqual([]);
  });

  it("queries stale work with the pre-resolved default team UUID", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "CountStaleIssuesInTeam")) return staleResp(2);
      throw new Error("only CountStaleIssuesInTeam should run");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "stale_by_team_default",
      defaultTeam: { name: "Engineering", id: "team-uuid" },
      verbose: true,
    });

    expect(result.checks[0]).toMatchObject({
      name: "stale_by_team_default",
      status: "warning",
      message: expect.stringContaining("2 stale"),
    });
  });

  it("reports a stale default-team reference without querying GraphQL", async () => {
    const client = makeClient(() => {
      throw new Error("no requests expected for an unresolved default team");
    });
    const result = await runDoctor({
      client,
      cliVersion: "x",
      only: "stale_by_team_default",
      defaultTeam: {
        name: "Deleted Team",
        resolutionError: "team not found",
      },
      verbose: true,
    });

    expect(result.checks[0]).toMatchObject({
      name: "stale_by_team_default",
      status: "warning",
      detail: "team not found",
    });
  });
});
