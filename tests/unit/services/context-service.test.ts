import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";

// Pin git-remote helpers so the project's own `.linear/config.json`
// does not leak into the global-layer-only test fixtures below.
vi.mock("../../../src/common/git-remote.js", () => ({
  getGitTopLevel: vi.fn(() => null),
  getGitRemoteUrl: vi.fn(() => null),
  parseRepoNameFromRemote: vi.fn(() => null),
  deriveScopeLabel: vi.fn(() => null),
}));

import { runContext } from "../../../src/services/context-service.js";

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

const viewerOrgResp = {
  viewer: {
    id: "u-1",
    name: "Alex",
    email: "alex@example.com",
    organization: { id: "org-1", name: "Acme", urlKey: "acme" },
  },
};

const engTeamResp = {
  teams: { nodes: [{ id: "t-eng", key: "ENG", name: "Engineering" }] },
};

const emptyTeamResp = { teams: { nodes: [] } };

let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "context-svc-"));
  fs.mkdirSync(path.join(tmpHome, ".linear"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeConfig(pairs: Record<string, string>): void {
  fs.writeFileSync(
    path.join(tmpHome, ".linear", "config.json"),
    JSON.stringify(pairs),
  );
}

describe("runContext — viewer + workspace", () => {
  it("returns workspace, viewer, backend=linear, config_path", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewerWithOrg")) return viewerOrgResp;
      throw new Error("unexpected query");
    });
    const result = await runContext({
      client,
      cliVersion: "1.0",
      env: {},
    });
    expect(result.cli_version).toBe("1.0");
    expect(result.backend).toBe("linear");
    expect(result.config_path).toContain(".linear/config.json");
    expect(result.workspace).toEqual({
      id: "org-1",
      name: "Acme",
      url_key: "acme",
    });
    expect(result.viewer?.email).toBe("alex@example.com");
    expect(result.default_team).toEqual({ configured: null, resolved: null });
    expect(result.errors).toBeUndefined();
  });

  it("captures viewer failure into errors but keeps a usable shape", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewerWithOrg")) throw new Error("401");
      throw new Error("unexpected query");
    });
    const result = await runContext({
      client,
      cliVersion: "x",
      env: {},
    });
    expect(result.viewer).toBeNull();
    expect(result.workspace).toBeNull();
    expect(result.errors?.[0]).toMatch(/viewer: 401/);
  });
});

describe("runContext — default_team resolution", () => {
  it("resolves a configured team key into {id, key, name}", async () => {
    writeConfig({ "team.default": "ENG" });
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewerWithOrg")) return viewerOrgResp;
      if (isQueryNamed(doc, "GetTeamByKey")) return engTeamResp;
      throw new Error("unexpected query");
    });
    const result = await runContext({
      client,
      cliVersion: "x",
      env: {},
    });
    expect(result.default_team.configured).toBe("ENG");
    expect(result.default_team.resolved).toEqual({
      id: "t-eng",
      key: "ENG",
      name: "Engineering",
    });
    expect(result.default_team.error).toBeUndefined();
  });

  it("reports error when configured team key has no Linear match", async () => {
    writeConfig({ "team.default": "GHOST" });
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewerWithOrg")) return viewerOrgResp;
      if (isQueryNamed(doc, "GetTeamByKey")) return emptyTeamResp;
      throw new Error("unexpected query");
    });
    const result = await runContext({
      client,
      cliVersion: "x",
      env: {},
    });
    expect(result.default_team.configured).toBe("GHOST");
    expect(result.default_team.resolved).toBeNull();
    expect(result.default_team.error).toMatch(/no team with key "GHOST"/);
  });

  it("captures team-lookup network failure as default_team.error", async () => {
    writeConfig({ "team.default": "ENG" });
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewerWithOrg")) return viewerOrgResp;
      if (isQueryNamed(doc, "GetTeamByKey")) throw new Error("network down");
      throw new Error("unexpected query");
    });
    const result = await runContext({
      client,
      cliVersion: "x",
      env: {},
    });
    expect(result.default_team.resolved).toBeNull();
    expect(result.default_team.error).toMatch(/network down/);
  });

  it("skips team lookup when team.default is unset", async () => {
    const teamRequest = vi.fn();
    const client = {
      request: vi.fn(async (doc: unknown) => {
        if (isQueryNamed(doc, "GetViewerWithOrg")) return viewerOrgResp;
        teamRequest();
        throw new Error("should not query teams");
      }),
    } as unknown as GraphQLClient;
    const result = await runContext({
      client,
      cliVersion: "x",
      env: {},
    });
    expect(teamRequest).not.toHaveBeenCalled();
    expect(result.default_team).toEqual({ configured: null, resolved: null });
  });
});
