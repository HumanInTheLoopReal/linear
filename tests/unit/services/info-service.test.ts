import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { runInfo } from "../../../src/services/info-service.js";

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
    organization: {
      id: "org-1",
      name: "Acme",
      urlKey: "acme",
    },
  },
};

function openIssuesResp(n: number, hasNext = false) {
  return {
    issues: {
      nodes: Array.from({ length: n }, (_, i) => ({ id: `o-${i}` })),
      pageInfo: { hasNextPage: hasNext, endCursor: hasNext ? "c" : null },
    },
  };
}

describe("runInfo — happy path", () => {
  it("returns workspace, viewer, and open count", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewerWithOrg")) return viewerOrgResp;
      if (isQueryNamed(doc, "CountOpenIssues")) return openIssuesResp(7);
      throw new Error("unexpected query");
    });
    const result = await runInfo({ client, cliVersion: "1.2.3" });
    expect(result.cli_version).toBe("1.2.3");
    expect(result.platform).toEqual({ key: "linear" });
    expect(result.workspace).toEqual({
      id: "org-1",
      name: "Acme",
      url_key: "acme",
    });
    expect(result.viewer).toEqual({
      id: "u-1",
      name: "Alex",
      email: "alex@example.com",
    });
    expect(result.counts).toEqual({ open: 7, open_saturated: false });
    expect(result.errors).toBeUndefined();
    expect(result.whats_new).toBeUndefined();
  });

  it("includes whats_new when requested", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewerWithOrg")) return viewerOrgResp;
      if (isQueryNamed(doc, "CountOpenIssues")) return openIssuesResp(0);
      throw new Error("unexpected query");
    });
    const result = await runInfo({ client, cliVersion: "x", whatsNew: true });
    expect(result.whats_new).toMatch(/linear is a CLI for Linear\.app/);
  });
});

describe("runInfo — counts pagination", () => {
  it("walks multiple pages and totals nodes across them", async () => {
    let page = 0;
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewerWithOrg")) return viewerOrgResp;
      if (isQueryNamed(doc, "CountOpenIssues")) {
        page += 1;
        if (page < 3) return openIssuesResp(100, true);
        return openIssuesResp(42, false);
      }
      throw new Error("unexpected query");
    });
    const result = await runInfo({ client, cliVersion: "x" });
    expect(result.counts.open).toBe(100 + 100 + 42);
    expect(result.counts.open_saturated).toBe(false);
  });
});

describe("runInfo — partial failure surfacing", () => {
  it("captures viewer failure into errors but still returns counts", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewerWithOrg")) throw new Error("401 boom");
      if (isQueryNamed(doc, "CountOpenIssues")) return openIssuesResp(3);
      throw new Error("unexpected query");
    });
    const result = await runInfo({ client, cliVersion: "x" });
    expect(result.viewer).toBeNull();
    expect(result.workspace).toBeNull();
    expect(result.counts.open).toBe(3);
    expect(result.errors?.[0]).toMatch(/viewer: 401 boom/);
  });

  it("captures counts failure but still returns viewer", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewerWithOrg")) return viewerOrgResp;
      if (isQueryNamed(doc, "CountOpenIssues")) throw new Error("rate limit");
      throw new Error("unexpected query");
    });
    const result = await runInfo({ client, cliVersion: "x" });
    expect(result.viewer?.name).toBe("Alex");
    expect(result.counts).toEqual({ open: 0, open_saturated: false });
    expect(result.errors?.[0]).toMatch(/counts: rate limit/);
  });
});

describe("runInfo — workspace null when organization absent", () => {
  it("treats organization=null as workspace=null without throwing", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewerWithOrg")) {
        return {
          viewer: {
            id: "u-1",
            name: "Alex",
            email: "a@e.com",
            organization: null,
          },
        };
      }
      if (isQueryNamed(doc, "CountOpenIssues")) return openIssuesResp(0);
      throw new Error("unexpected query");
    });
    const result = await runInfo({ client, cliVersion: "x" });
    expect(result.workspace).toBeNull();
    expect(result.viewer?.id).toBe("u-1");
  });
});
