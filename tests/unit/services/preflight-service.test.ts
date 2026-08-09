import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  formatChecklist,
  resolveSkipName,
  runPreflightChecks,
} from "../../../src/services/preflight-service.js";

function makeClient(handler: (doc: unknown) => unknown): GraphQLClient {
  const request = vi.fn(async (doc: unknown) => handler(doc));
  return { request } as unknown as GraphQLClient;
}

function viewerResponse(): unknown {
  return { viewer: { id: "u-1", name: "Alex", email: "alex@example.com" } };
}

function staleResponse(count: number): unknown {
  return {
    issues: {
      nodes: Array.from({ length: count }, (_, i) => ({ id: `i-stale-${i}` })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function triageResponse(count: number): unknown {
  return {
    issues: {
      nodes: Array.from({ length: count }, (_, i) => ({ id: `i-tri-${i}` })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function closedNotArchivedResponse(count: number): unknown {
  return {
    issues: {
      nodes: Array.from({ length: count }, (_, i) => ({ id: `i-cna-${i}` })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function brokenParentResponse(count: number): unknown {
  return {
    issues: {
      nodes: Array.from({ length: count }, (_, i) => ({ id: `i-bp-${i}` })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function isQueryNamed(doc: unknown, name: string): boolean {
  const defs =
    (doc as { definitions?: Array<{ name?: { value?: string } }> })
      .definitions ?? [];
  return defs.some((d) => d.name?.value === name);
}

describe("formatChecklist", () => {
  it("includes a header, [ ] items, and the --check tip", () => {
    const text = formatChecklist();
    expect(text).toContain("Linear Workspace Readiness Checklist:");
    expect(text).toContain("[ ] Auth valid");
    expect(text).toContain("[ ] No stale issues");
    expect(text).toContain("[ ] Triage queue empty");
    expect(text).toContain("[ ] Closed issues archived");
    expect(text).toContain("[ ] No broken parent edges");
    expect(text).toContain("linear preflight --check");
  });
});

describe("resolveSkipName", () => {
  it("accepts short slugs (case-insensitive)", () => {
    expect(resolveSkipName("auth")).toBe("Auth valid");
    expect(resolveSkipName("STALE")).toBe("No stale issues");
    expect(resolveSkipName("triage")).toBe("Triage queue clear");
  });
  it("accepts canonical names verbatim", () => {
    expect(resolveSkipName("Auth valid")).toBe("Auth valid");
  });
  it("returns null for unknown names", () => {
    expect(resolveSkipName("bogus")).toBeNull();
  });
});

describe("runPreflightChecks", () => {
  it("reports all-passed when auth resolves and counts are zero", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewerResponse();
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResponse(0);
      if (isQueryNamed(doc, "CountTriageIssues")) return triageResponse(0);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResponse(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResponse(0);
      throw new Error("unexpected query");
    });
    const result = await runPreflightChecks({ client });
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.summary).toBe("5/5 checks passed");
  });

  it("flags stale + triage as warnings (not failures) when counts non-zero", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewerResponse();
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResponse(7);
      if (isQueryNamed(doc, "CountTriageIssues")) return triageResponse(3);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResponse(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResponse(0);
      throw new Error("unexpected query");
    });
    const result = await runPreflightChecks({ client });
    expect(result.passed).toBe(true);
    const stale = result.checks.find((c) => c.name === "No stale issues");
    const triage = result.checks.find((c) => c.name === "Triage queue clear");
    expect(stale?.warning).toBe(true);
    expect(stale?.output).toContain("7 non-terminal");
    expect(triage?.warning).toBe(true);
    expect(triage?.output).toContain("3 issue(s)");
    expect(result.summary).toContain("2 warning(s)");
  });

  it("flags closed-not-archived as warning above threshold (lin-hqiz)", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewerResponse();
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResponse(0);
      if (isQueryNamed(doc, "CountTriageIssues")) return triageResponse(0);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResponse(60);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResponse(0);
      throw new Error("unexpected query");
    });
    const result = await runPreflightChecks({ client });
    const cna = result.checks.find((c) => c.name === "Closed issues archived");
    expect(cna?.warning).toBe(true);
    expect(cna?.output).toContain("60 closed");
  });

  it("flags broken-parent-edges as warning when count > 0 (lin-hqiz)", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewerResponse();
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResponse(0);
      if (isQueryNamed(doc, "CountTriageIssues")) return triageResponse(0);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResponse(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResponse(2);
      throw new Error("unexpected query");
    });
    const result = await runPreflightChecks({ client });
    const bp = result.checks.find((c) => c.name === "No broken parent edges");
    expect(bp?.warning).toBe(true);
    expect(bp?.output).toContain("2 open issue(s)");
  });

  it("marks the run failed when auth fails (hard failure, not a warning)", async () => {
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer"))
        throw new Error("401 Unauthorized: token invalid");
      if (isQueryNamed(doc, "CountStaleIssues")) return staleResponse(0);
      if (isQueryNamed(doc, "CountTriageIssues")) return triageResponse(0);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResponse(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResponse(0);
      throw new Error("unexpected query");
    });
    const result = await runPreflightChecks({ client });
    expect(result.passed).toBe(false);
    const auth = result.checks.find((c) => c.name === "Auth valid");
    expect(auth?.passed).toBe(false);
    expect(auth?.warning).toBeUndefined();
    expect(auth?.output).toContain("401");
  });

  it("honors `skip` by recording the check as skipped without firing it", async () => {
    const request = vi.fn(async (doc: unknown) => {
      if (isQueryNamed(doc, "GetViewer")) return viewerResponse();
      throw new Error("unexpected query — non-auth checks should be skipped");
    });
    const client = { request } as unknown as GraphQLClient;
    const result = await runPreflightChecks({
      client,
      skip: new Set([
        "No stale issues",
        "Triage queue clear",
        "Closed issues archived",
        "No broken parent edges",
      ]),
    });
    expect(result.summary).toContain("(4 skipped)");
    const stale = result.checks.find((c) => c.name === "No stale issues");
    expect(stale?.skipped).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("paginates stale-issue counts across multiple pages", async () => {
    const pageResponses = [
      {
        issues: {
          nodes: Array.from({ length: 100 }, (_, i) => ({ id: `s-${i}` })),
          pageInfo: { hasNextPage: true, endCursor: "c1" },
        },
      },
      {
        issues: {
          nodes: Array.from({ length: 50 }, (_, i) => ({ id: `s-${100 + i}` })),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ];
    let stalePageIdx = 0;
    const client = makeClient((doc) => {
      if (isQueryNamed(doc, "GetViewer")) return viewerResponse();
      if (isQueryNamed(doc, "CountStaleIssues")) {
        return pageResponses[stalePageIdx++];
      }
      if (isQueryNamed(doc, "CountTriageIssues")) return triageResponse(0);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResponse(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResponse(0);
      throw new Error("unexpected query");
    });
    const result = await runPreflightChecks({ client });
    const stale = result.checks.find((c) => c.name === "No stale issues");
    expect(stale?.output).toContain("150 non-terminal");
  });

  it("uses --stale-days to compute the cutoff", async () => {
    const calls: { cutoff: string }[] = [];
    const request = vi.fn(async (doc: unknown, vars?: unknown) => {
      if (isQueryNamed(doc, "GetViewer")) return viewerResponse();
      if (isQueryNamed(doc, "CountStaleIssues")) {
        calls.push(vars as { cutoff: string });
        return staleResponse(0);
      }
      if (isQueryNamed(doc, "CountTriageIssues")) return triageResponse(0);
      if (isQueryNamed(doc, "CountClosedNotArchived"))
        return closedNotArchivedResponse(0);
      if (isQueryNamed(doc, "CountBrokenParentEdges"))
        return brokenParentResponse(0);
      throw new Error("unexpected query");
    });
    const client = { request } as unknown as GraphQLClient;
    const before = Date.now();
    await runPreflightChecks({ client, staleDays: 7 });
    expect(calls).toHaveLength(1);
    const cutoff = Date.parse(calls[0]?.cutoff ?? "");
    expect(Number.isFinite(cutoff)).toBe(true);
    // 7 days ≈ 604_800_000 ms; tolerate up to 10s of clock drift.
    expect(before - cutoff).toBeGreaterThanOrEqual(7 * 86_400_000 - 10_000);
    expect(before - cutoff).toBeLessThanOrEqual(7 * 86_400_000 + 10_000);
  });
});
