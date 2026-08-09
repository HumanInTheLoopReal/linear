//
// Unit tests for the additive list meta layer (lin-hsjq). Covers
// buildListMeta primitives and withListMeta's "spread-then-add" guarantee
// that nodes / pageInfo stay byte-identical.

import { describe, expect, it } from "vitest";
import { buildListMeta, withListMeta } from "../../../src/common/list-meta.js";

describe("buildListMeta", () => {
  it("maps count/limit and reads truncated from pageInfo.hasNextPage", () => {
    expect(
      buildListMeta({
        count: 3,
        pageInfo: { hasNextPage: true } as never,
        limit: 50,
        scope: { team: "ENG", project: "Web" },
      }),
    ).toEqual({
      count: 3,
      truncated: true,
      limit_applied: 50,
      scope: { team: "ENG", project: "Web" },
      agent_mode: false,
    });
  });

  it("defaults truncated to false when pageInfo is absent", () => {
    const meta = buildListMeta({ count: 0 });
    expect(meta.truncated).toBe(false);
    expect(meta.limit_applied).toBeNull();
    expect(meta.scope).toEqual({ team: null, project: null });
    expect(meta.agent_mode).toBe(false);
  });

  it("surfaces agent_mode when the page was trimmed", () => {
    expect(buildListMeta({ count: 2, agentMode: true }).agent_mode).toBe(true);
  });

  it("treats a missing limit as null (uncapped)", () => {
    expect(buildListMeta({ count: 5 }).limit_applied).toBeNull();
  });

  it("normalizes partial scope to explicit nulls", () => {
    expect(buildListMeta({ count: 1, scope: { team: "ENG" } }).scope).toEqual({
      team: "ENG",
      project: null,
    });
  });
});

describe("withListMeta", () => {
  it("preserves nodes and pageInfo, adding only meta", () => {
    const result = {
      nodes: [{ id: "a" }, { id: "b" }],
      pageInfo: { hasNextPage: false, endCursor: "x" } as never,
    };
    const withMeta = withListMeta(result, {
      limit: 10,
      scope: { team: "ENG" },
    });

    // nodes / pageInfo identity preserved.
    expect(withMeta.nodes).toBe(result.nodes);
    expect(withMeta.pageInfo).toBe(result.pageInfo);
    expect(withMeta.meta).toEqual({
      count: 2,
      truncated: false,
      limit_applied: 10,
      scope: { team: "ENG", project: null },
      agent_mode: false,
    });
  });

  it("threads agentMode into meta.agent_mode", () => {
    const withMeta = withListMeta(
      { nodes: [], pageInfo: { hasNextPage: false } as never },
      { agentMode: true },
    );
    expect(withMeta.meta.agent_mode).toBe(true);
  });

  it("derives count from nodes.length and truncated from pageInfo", () => {
    const withMeta = withListMeta({
      nodes: [{ id: "a" }],
      pageInfo: { hasNextPage: true } as never,
    });
    expect(withMeta.meta.count).toBe(1);
    expect(withMeta.meta.truncated).toBe(true);
  });

  it("does not mutate the original result object", () => {
    const result = {
      nodes: [],
      pageInfo: { hasNextPage: false } as never,
    };
    withListMeta(result);
    expect(result).not.toHaveProperty("meta");
  });
});
