import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  computeLayout,
  detectCycles,
  detectCyclesWithIssues,
  type GraphSubgraph,
  loadAllOpenSubgraphs,
  loadGraphSubgraph,
  renderDot,
} from "../../../src/services/dependency-graph-service.js";

function nodeFor(opts: {
  id: string;
  identifier: string;
  title?: string;
  priority?: number;
  stateType?: string;
  stateName?: string;
  teamId?: string;
  relations?: Array<{
    type: string;
    relatedIssue: { id: string; identifier: string };
  }>;
  inverseRelations?: Array<{
    type: string;
    issue: { id: string; identifier: string };
  }>;
}) {
  return {
    id: opts.id,
    identifier: opts.identifier,
    title: opts.title ?? "Issue",
    priority: opts.priority ?? 2,
    state: {
      id: `s-${opts.stateType ?? "backlog"}`,
      name: opts.stateName ?? "Backlog",
      type: opts.stateType ?? "backlog",
    },
    team: { id: opts.teamId ?? "team-a", key: "ENG", name: "Eng" },
    relations: {
      nodes: (opts.relations ?? []).map((r, i) => ({
        id: `r-${opts.id}-${i}`,
        type: r.type,
        relatedIssue: r.relatedIssue,
      })),
    },
    inverseRelations: {
      nodes: (opts.inverseRelations ?? []).map((r, i) => ({
        id: `ir-${opts.id}-${i}`,
        type: r.type,
        issue: r.issue,
      })),
    },
  };
}

function makeClient(responses: Record<string, unknown>[]): GraphQLClient {
  const request = vi.fn();
  for (const r of responses) request.mockResolvedValueOnce(r);
  return { request } as unknown as GraphQLClient;
}

function issueOf(
  id: string,
  identifier: string,
  opts: { priority?: number } = {},
) {
  return {
    id,
    identifier,
    title: identifier,
    priority: opts.priority ?? 2,
    status: "backlog",
    state_name: "Backlog",
    team: { id: "team-a", key: "ENG", name: "Eng" },
  };
}

describe("loadGraphSubgraph", () => {
  it("walks both forward and inverse relations and normalizes to (issue_id, depends_on_id)", async () => {
    // A blocks B (forward edge on A); C blocks A (inverse edge on A).
    const client = makeClient([
      {
        issue: nodeFor({
          id: "a",
          identifier: "ENG-A",
          relations: [
            { type: "blocks", relatedIssue: { id: "b", identifier: "ENG-B" } },
          ],
          inverseRelations: [
            { type: "blocks", issue: { id: "c", identifier: "ENG-C" } },
          ],
        }),
      },
      { issue: nodeFor({ id: "b", identifier: "ENG-B" }) },
      { issue: nodeFor({ id: "c", identifier: "ENG-C" }) },
    ]);

    const sg = await loadGraphSubgraph(client, "a");
    expect(sg.root?.identifier).toBe("ENG-A");
    expect(sg.issues.map((i) => i.identifier).sort()).toEqual([
      "ENG-A",
      "ENG-B",
      "ENG-C",
    ]);
    // Forward edge A->B means A blocks B; normalize to (B, depends_on=A).
    expect(sg.dependencies).toContainEqual({
      issue_id: "b",
      depends_on_id: "a",
      type: "blocks",
    });
    // Inverse edge on A from C: C blocks A; normalize to (A, depends_on=C).
    expect(sg.dependencies).toContainEqual({
      issue_id: "a",
      depends_on_id: "c",
      type: "blocks",
    });
  });

  it("respects maxDepth and stops expanding past it", async () => {
    // A -> B -> C; maxDepth=1 should fetch A and B but not C.
    const client = makeClient([
      {
        issue: nodeFor({
          id: "a",
          identifier: "ENG-A",
          relations: [
            { type: "blocks", relatedIssue: { id: "b", identifier: "ENG-B" } },
          ],
        }),
      },
      {
        issue: nodeFor({
          id: "b",
          identifier: "ENG-B",
          relations: [
            { type: "blocks", relatedIssue: { id: "c", identifier: "ENG-C" } },
          ],
        }),
      },
    ]);

    const sg = await loadGraphSubgraph(client, "a", { maxDepth: 1 });
    expect(sg.issues.map((i) => i.identifier).sort()).toEqual([
      "ENG-A",
      "ENG-B",
    ]);
    // Edge B->C is reported but pruned because C isn't in the visited set.
    expect(sg.dependencies.find((e) => e.issue_id === "c")).toBeUndefined();
  });

  it("deduplicates edges discovered from both directions", async () => {
    // A.forward says A blocks B; B.inverse also says A blocks B.
    const client = makeClient([
      {
        issue: nodeFor({
          id: "a",
          identifier: "ENG-A",
          relations: [
            { type: "blocks", relatedIssue: { id: "b", identifier: "ENG-B" } },
          ],
        }),
      },
      {
        issue: nodeFor({
          id: "b",
          identifier: "ENG-B",
          inverseRelations: [
            { type: "blocks", issue: { id: "a", identifier: "ENG-A" } },
          ],
        }),
      },
    ]);

    const sg = await loadGraphSubgraph(client, "a");
    const blocking = sg.dependencies.filter(
      (e) => e.issue_id === "b" && e.depends_on_id === "a",
    );
    expect(blocking).toHaveLength(1);
  });
});

describe("loadAllOpenSubgraphs", () => {
  it("splits open issues into connected components and sorts by size", async () => {
    // Component 1: a-b-c connected; Component 2: d isolated.
    const client = makeClient([
      {
        issues: {
          nodes: [
            nodeFor({
              id: "a",
              identifier: "ENG-A",
              relations: [
                {
                  type: "blocks",
                  relatedIssue: { id: "b", identifier: "ENG-B" },
                },
              ],
            }),
            nodeFor({
              id: "b",
              identifier: "ENG-B",
              relations: [
                {
                  type: "blocks",
                  relatedIssue: { id: "c", identifier: "ENG-C" },
                },
              ],
            }),
            nodeFor({ id: "c", identifier: "ENG-C" }),
            nodeFor({ id: "d", identifier: "ENG-D" }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const subgraphs = await loadAllOpenSubgraphs(client);
    expect(subgraphs).toHaveLength(2);
    // Largest first.
    expect(subgraphs[0].issues.map((i) => i.identifier).sort()).toEqual([
      "ENG-A",
      "ENG-B",
      "ENG-C",
    ]);
    expect(subgraphs[1].issues[0].identifier).toBe("ENG-D");
  });

  it("paginates and aggregates across pages", async () => {
    const client = makeClient([
      {
        issues: {
          nodes: [nodeFor({ id: "p1", identifier: "ENG-1" })],
          pageInfo: { hasNextPage: true, endCursor: "c1" },
        },
      },
      {
        issues: {
          nodes: [nodeFor({ id: "p2", identifier: "ENG-2" })],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);
    const subgraphs = await loadAllOpenSubgraphs(client);
    expect(
      (client.request as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
    expect(
      subgraphs
        .flatMap((s) => s.issues)
        .map((i) => i.identifier)
        .sort(),
    ).toEqual(["ENG-1", "ENG-2"]);
  });

  it("picks the lowest-priority issue as each component's root", async () => {
    const client = makeClient([
      {
        issues: {
          nodes: [
            nodeFor({
              id: "lo",
              identifier: "ENG-9",
              priority: 0,
              relations: [
                {
                  type: "blocks",
                  relatedIssue: { id: "hi", identifier: "ENG-1" },
                },
              ],
            }),
            nodeFor({ id: "hi", identifier: "ENG-1", priority: 3 }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);
    const subgraphs = await loadAllOpenSubgraphs(client);
    expect(subgraphs[0].root?.identifier).toBe("ENG-9");
  });
});

describe("computeLayout", () => {
  it("assigns layer 0 to nodes with no blocking deps", () => {
    const sg: GraphSubgraph = {
      root: issueOf("a", "ENG-A"),
      issues: [issueOf("a", "ENG-A"), issueOf("b", "ENG-B")],
      dependencies: [],
    };
    const layout = computeLayout(sg);
    expect(layout.nodes["ENG-A"].layer).toBe(0);
    expect(layout.nodes["ENG-B"].layer).toBe(0);
    expect(layout.max_layer).toBe(0);
  });

  it("layers a linear chain by longest path", () => {
    // C depends on B depends on A
    const sg: GraphSubgraph = {
      root: issueOf("a", "ENG-A"),
      issues: [
        issueOf("a", "ENG-A"),
        issueOf("b", "ENG-B"),
        issueOf("c", "ENG-C"),
      ],
      dependencies: [
        { issue_id: "b", depends_on_id: "a", type: "blocks" },
        { issue_id: "c", depends_on_id: "b", type: "blocks" },
      ],
    };
    const layout = computeLayout(sg);
    expect(layout.nodes["ENG-A"].layer).toBe(0);
    expect(layout.nodes["ENG-B"].layer).toBe(1);
    expect(layout.nodes["ENG-C"].layer).toBe(2);
    expect(layout.nodes["ENG-C"].depends_on).toEqual(["ENG-B"]);
    expect(layout.layers).toEqual([["ENG-A"], ["ENG-B"], ["ENG-C"]]);
  });

  it("ignores non-blocks edges in layering", () => {
    const sg: GraphSubgraph = {
      root: issueOf("a", "ENG-A"),
      issues: [issueOf("a", "ENG-A"), issueOf("b", "ENG-B")],
      dependencies: [
        // Related, not blocks — must NOT shift B to layer 1.
        { issue_id: "b", depends_on_id: "a", type: "related" },
      ],
    };
    const layout = computeLayout(sg);
    expect(layout.nodes["ENG-A"].layer).toBe(0);
    expect(layout.nodes["ENG-B"].layer).toBe(0);
  });

  it("falls back to layer 0 for nodes inside a cycle", () => {
    const sg: GraphSubgraph = {
      root: issueOf("a", "ENG-A"),
      issues: [issueOf("a", "ENG-A"), issueOf("b", "ENG-B")],
      dependencies: [
        { issue_id: "b", depends_on_id: "a", type: "blocks" },
        { issue_id: "a", depends_on_id: "b", type: "blocks" },
      ],
    };
    const layout = computeLayout(sg);
    expect(layout.nodes["ENG-A"].layer).toBe(0);
    expect(layout.nodes["ENG-B"].layer).toBe(0);
  });
});

describe("detectCycles", () => {
  it("returns [] for an acyclic graph", () => {
    const sg: GraphSubgraph = {
      root: issueOf("a", "ENG-A"),
      issues: [issueOf("a", "ENG-A"), issueOf("b", "ENG-B")],
      dependencies: [{ issue_id: "b", depends_on_id: "a", type: "blocks" }],
    };
    expect(detectCycles([sg])).toEqual([]);
  });

  it("detects a simple cycle and reports it in identifier form", () => {
    const sg: GraphSubgraph = {
      root: issueOf("a", "ENG-A"),
      issues: [issueOf("a", "ENG-A"), issueOf("b", "ENG-B")],
      dependencies: [
        { issue_id: "a", depends_on_id: "b", type: "blocks" },
        { issue_id: "b", depends_on_id: "a", type: "blocks" },
      ],
    };
    const cycles = detectCycles([sg]);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    expect(cycles[0]).toEqual(expect.arrayContaining(["ENG-A", "ENG-B"]));
  });

  it("ignores non-blocks edges when scanning for cycles", () => {
    const sg: GraphSubgraph = {
      root: issueOf("a", "ENG-A"),
      issues: [issueOf("a", "ENG-A"), issueOf("b", "ENG-B")],
      dependencies: [
        { issue_id: "a", depends_on_id: "b", type: "related" },
        { issue_id: "b", depends_on_id: "a", type: "related" },
      ],
    };
    expect(detectCycles([sg])).toEqual([]);
  });
});

describe("detectCyclesWithIssues", () => {
  it("returns [] for an acyclic graph", () => {
    const sg: GraphSubgraph = {
      root: issueOf("a", "ENG-A"),
      issues: [issueOf("a", "ENG-A"), issueOf("b", "ENG-B")],
      dependencies: [{ issue_id: "b", depends_on_id: "a", type: "blocks" }],
    };
    expect(detectCyclesWithIssues([sg])).toEqual([]);
  });

  it("enriches each cycle entry with the full GraphIssue record", () => {
    const sg: GraphSubgraph = {
      root: issueOf("a", "ENG-A"),
      issues: [issueOf("a", "ENG-A"), issueOf("b", "ENG-B")],
      dependencies: [
        { issue_id: "a", depends_on_id: "b", type: "blocks" },
        { issue_id: "b", depends_on_id: "a", type: "blocks" },
      ],
    };
    const cycles = detectCyclesWithIssues([sg]);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const idents = cycles[0].map((i) => i.identifier).sort();
    expect(idents).toEqual(["ENG-A", "ENG-B"]);
    for (const issue of cycles[0]) {
      expect(issue).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          identifier: expect.any(String),
          title: expect.any(String),
          priority: expect.any(Number),
        }),
      );
    }
  });

  it("looks up issues across all input subgraphs", () => {
    const sg1: GraphSubgraph = {
      root: issueOf("a", "ENG-A"),
      issues: [issueOf("a", "ENG-A")],
      dependencies: [],
    };
    const sg2: GraphSubgraph = {
      root: issueOf("b", "ENG-B"),
      issues: [issueOf("b", "ENG-B"), issueOf("c", "ENG-C")],
      dependencies: [
        { issue_id: "b", depends_on_id: "c", type: "blocks" },
        { issue_id: "c", depends_on_id: "b", type: "blocks" },
      ],
    };
    const cycles = detectCyclesWithIssues([sg1, sg2]);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const idents = new Set(cycles.flat().map((i) => i.identifier));
    expect(idents.has("ENG-B")).toBe(true);
    expect(idents.has("ENG-C")).toBe(true);
  });
});

describe("renderDot", () => {
  it("emits well-formed DOT with rankdir=LR and one edge per blocks dependency", () => {
    const sg: GraphSubgraph = {
      root: issueOf("a", "ENG-A"),
      issues: [issueOf("a", "ENG-A"), issueOf("b", "ENG-B")],
      dependencies: [{ issue_id: "b", depends_on_id: "a", type: "blocks" }],
    };
    const layout = computeLayout(sg);
    const dot = renderDot(layout, sg);
    expect(dot.startsWith("digraph linear {")).toBe(true);
    expect(dot).toContain("rankdir=LR;");
    expect(dot).toContain(`"ENG-A" -> "ENG-B";`);
    expect(dot.endsWith("}")).toBe(true);
  });

  it("returns an empty digraph for empty subgraphs", () => {
    const dot = renderDot(
      { nodes: {}, layers: [], max_layer: 0, root_id: null },
      { root: null, issues: [], dependencies: [] },
    );
    expect(dot).toBe("digraph linear { }");
  });
});
