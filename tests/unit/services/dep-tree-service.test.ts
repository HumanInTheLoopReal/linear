import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  loadDependencyTree,
  renderMermaid,
  type TreeNode,
} from "../../../src/services/dep-tree-service.js";

interface MockIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  stateType: string;
  parent?: { id: string; identifier: string } | null;
  children?: Array<{ id: string; identifier: string }>;
  forwardEdges?: Array<{ id: string; type: string }>;
  inverseEdges?: Array<{ id: string; type: string }>;
}

function mockClient(issues: Record<string, MockIssue>): GraphQLClient {
  const request = vi.fn(async (_doc, vars: { id: string }) => {
    const issue = issues[vars.id];
    if (!issue) return { issue: null };
    return {
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        priority: issue.priority,
        state: {
          id: `s-${issue.stateType}`,
          name: issue.stateType,
          type: issue.stateType,
        },
        team: { id: "t1", key: "TES", name: "Test" },
        parent: issue.parent ?? null,
        children: { nodes: issue.children ?? [] },
        relations: {
          nodes: (issue.forwardEdges ?? []).map((e) => ({
            id: `e-${e.id}`,
            type: e.type,
            relatedIssue: { id: e.id, identifier: e.id },
          })),
        },
        inverseRelations: {
          nodes: (issue.inverseEdges ?? []).map((e) => ({
            id: `e-${e.id}`,
            type: e.type,
            issue: { id: e.id, identifier: e.id },
          })),
        },
      },
    };
  });
  return { request } as unknown as GraphQLClient;
}

describe("loadDependencyTree", () => {
  it("walks down: follows inverseRelations from the root", async () => {
    // C blocks B blocks A. Root = A.
    // A.inverseRelations[blocks] = [B]; B.inverseRelations[blocks] = [C].
    const client = mockClient({
      A: {
        id: "A",
        identifier: "TES-1",
        title: "A",
        priority: 0,
        stateType: "started",
        inverseEdges: [{ id: "B", type: "blocks" }],
      },
      B: {
        id: "B",
        identifier: "TES-2",
        title: "B",
        priority: 0,
        stateType: "started",
        inverseEdges: [{ id: "C", type: "blocks" }],
      },
      C: {
        id: "C",
        identifier: "TES-3",
        title: "C",
        priority: 0,
        stateType: "started",
      },
    });

    const tree = await loadDependencyTree(client, "A", {
      direction: "down",
      maxDepth: 10,
    });
    expect(tree.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(tree[0].parent_id).toBeNull();
    expect(tree[1].parent_id).toBe("A");
    expect(tree[2].parent_id).toBe("B");
    expect(tree[1].edge_from_parent).toBe("blocks");
    expect(tree[2].depth).toBe(2);
  });

  it("walks up: follows forward relations from the root", async () => {
    // A blocks B blocks C. Root = A walking up.
    const client = mockClient({
      A: {
        id: "A",
        identifier: "TES-1",
        title: "A",
        priority: 0,
        stateType: "started",
        forwardEdges: [{ id: "B", type: "blocks" }],
      },
      B: {
        id: "B",
        identifier: "TES-2",
        title: "B",
        priority: 0,
        stateType: "started",
        forwardEdges: [{ id: "C", type: "blocks" }],
      },
      C: {
        id: "C",
        identifier: "TES-3",
        title: "C",
        priority: 0,
        stateType: "started",
      },
    });
    const tree = await loadDependencyTree(client, "A", {
      direction: "up",
      maxDepth: 10,
    });
    expect(tree.map((n) => n.id)).toEqual(["A", "B", "C"]);
  });

  it("marks nodes at max-depth as truncated and stops expansion", async () => {
    const client = mockClient({
      A: {
        id: "A",
        identifier: "TES-1",
        title: "A",
        priority: 0,
        stateType: "started",
        inverseEdges: [{ id: "B", type: "blocks" }],
      },
      B: {
        id: "B",
        identifier: "TES-2",
        title: "B",
        priority: 0,
        stateType: "started",
        inverseEdges: [{ id: "C", type: "blocks" }],
      },
      C: {
        id: "C",
        identifier: "TES-3",
        title: "C",
        priority: 0,
        stateType: "started",
      },
    });
    const tree = await loadDependencyTree(client, "A", {
      direction: "down",
      maxDepth: 1,
    });
    expect(tree.map((n) => n.id)).toEqual(["A", "B"]);
    expect(tree[1].truncated).toBe(true);
  });

  it("deduplicates diamond nodes by default", async () => {
    // A blocked by B and C; both B and C are blocked by D.
    const client = mockClient({
      A: {
        id: "A",
        identifier: "TES-1",
        title: "A",
        priority: 0,
        stateType: "started",
        inverseEdges: [
          { id: "B", type: "blocks" },
          { id: "C", type: "blocks" },
        ],
      },
      B: {
        id: "B",
        identifier: "TES-2",
        title: "B",
        priority: 0,
        stateType: "started",
        inverseEdges: [{ id: "D", type: "blocks" }],
      },
      C: {
        id: "C",
        identifier: "TES-3",
        title: "C",
        priority: 0,
        stateType: "started",
        inverseEdges: [{ id: "D", type: "blocks" }],
      },
      D: {
        id: "D",
        identifier: "TES-4",
        title: "D",
        priority: 0,
        stateType: "started",
      },
    });
    const tree = await loadDependencyTree(client, "A", {
      direction: "down",
      maxDepth: 10,
    });
    expect(tree.filter((n) => n.id === "D").length).toBe(1);
  });

  it("with --show-all-paths records the same node under each parent", async () => {
    const client = mockClient({
      A: {
        id: "A",
        identifier: "TES-1",
        title: "A",
        priority: 0,
        stateType: "started",
        inverseEdges: [
          { id: "B", type: "blocks" },
          { id: "C", type: "blocks" },
        ],
      },
      B: {
        id: "B",
        identifier: "TES-2",
        title: "B",
        priority: 0,
        stateType: "started",
        inverseEdges: [{ id: "D", type: "blocks" }],
      },
      C: {
        id: "C",
        identifier: "TES-3",
        title: "C",
        priority: 0,
        stateType: "started",
        inverseEdges: [{ id: "D", type: "blocks" }],
      },
      D: {
        id: "D",
        identifier: "TES-4",
        title: "D",
        priority: 0,
        stateType: "started",
      },
    });
    const tree = await loadDependencyTree(client, "A", {
      direction: "down",
      maxDepth: 10,
      showAllPaths: true,
    });
    const ds = tree.filter((n) => n.id === "D");
    expect(ds.length).toBe(2);
    expect(new Set(ds.map((d) => d.parent_id))).toEqual(new Set(["B", "C"]));
  });

  it("filters out nodes that do not match --status", async () => {
    const client = mockClient({
      A: {
        id: "A",
        identifier: "TES-1",
        title: "A",
        priority: 0,
        stateType: "started",
        inverseEdges: [{ id: "B", type: "blocks" }],
      },
      B: {
        id: "B",
        identifier: "TES-2",
        title: "B",
        priority: 0,
        stateType: "completed",
      },
    });
    const tree = await loadDependencyTree(client, "A", {
      direction: "down",
      maxDepth: 10,
      status: "open",
    });
    // Root A is "started" (in_progress, not open) — also filtered.
    expect(tree).toEqual([]);
  });

  describe("--edges filter (lin-by4q)", () => {
    // The motivating bug: previously, `tree --direction=down` interleaved
    // `parent` edges with `blocks` edges in the same chain. Now `--edges`
    // controls which edge classes are traversed.

    it("--edges=blocks does NOT follow the parent edge upward (lin-by4q)", async () => {
      // A has a parent P and is blocked by B. With --edges=blocks +
      // direction=up, the tree should only walk what A blocks (none here),
      // not surface its parent. Previously the parent leaked into the tree.
      const client = mockClient({
        A: {
          id: "A",
          identifier: "TES-1",
          title: "A",
          priority: 0,
          stateType: "started",
          parent: { id: "P", identifier: "TES-99" },
          inverseEdges: [{ id: "B", type: "blocks" }],
        },
        P: {
          id: "P",
          identifier: "TES-99",
          title: "P",
          priority: 0,
          stateType: "started",
        },
        B: {
          id: "B",
          identifier: "TES-2",
          title: "B",
          priority: 0,
          stateType: "started",
        },
      });
      const tree = await loadDependencyTree(client, "A", {
        direction: "up",
        maxDepth: 10,
        edges: "blocks",
      });
      expect(tree.map((n) => n.id)).toEqual(["A"]);
    });

    it("--edges=parent walks only parent-child edges (children downward)", async () => {
      // Epic E has children C1, C2. With --edges=parent + direction=down,
      // we walk children but not the children's blockers.
      const client = mockClient({
        E: {
          id: "E",
          identifier: "TES-10",
          title: "Epic",
          priority: 0,
          stateType: "started",
          children: [
            { id: "C1", identifier: "TES-11" },
            { id: "C2", identifier: "TES-12" },
          ],
        },
        C1: {
          id: "C1",
          identifier: "TES-11",
          title: "C1",
          priority: 0,
          stateType: "started",
          inverseEdges: [{ id: "X", type: "blocks" }],
        },
        C2: {
          id: "C2",
          identifier: "TES-12",
          title: "C2",
          priority: 0,
          stateType: "started",
        },
        X: {
          id: "X",
          identifier: "TES-20",
          title: "X",
          priority: 0,
          stateType: "started",
        },
      });
      const tree = await loadDependencyTree(client, "E", {
        direction: "down",
        maxDepth: 10,
        edges: "parent",
      });
      // X (a blocker of C1) is NOT included with --edges=parent.
      expect(tree.map((n) => n.id).sort()).toEqual(["C1", "C2", "E"]);
      const c1 = tree.find((n) => n.id === "C1");
      expect(c1?.edge_from_parent).toBe("parent-child");
    });

    it("--edges=parent walks parent upward, not blocks", async () => {
      // A has a parent P and is blocked by B. With --edges=parent + up,
      // we walk to P but not to anyone A blocks.
      const client = mockClient({
        A: {
          id: "A",
          identifier: "TES-1",
          title: "A",
          priority: 0,
          stateType: "started",
          parent: { id: "P", identifier: "TES-99" },
          forwardEdges: [{ id: "B", type: "blocks" }],
        },
        P: {
          id: "P",
          identifier: "TES-99",
          title: "P",
          priority: 0,
          stateType: "started",
        },
        B: {
          id: "B",
          identifier: "TES-2",
          title: "B",
          priority: 0,
          stateType: "started",
        },
      });
      const tree = await loadDependencyTree(client, "A", {
        direction: "up",
        maxDepth: 10,
        edges: "parent",
      });
      expect(tree.map((n) => n.id).sort()).toEqual(["A", "P"]);
      const p = tree.find((n) => n.id === "P");
      expect(p?.edge_from_parent).toBe("parent-child");
    });

    it("--edges=all walks both blocks and parent-child", async () => {
      // A is blocked by B, has parent P. With --edges=all + up, both
      // P (via parent) and B (via blocks) should appear. Wait — B is an
      // inverse blocker, so it's downstream, not upstream. Use forwardEdges
      // so A blocks B (upstream walk surfaces B).
      const client = mockClient({
        A: {
          id: "A",
          identifier: "TES-1",
          title: "A",
          priority: 0,
          stateType: "started",
          parent: { id: "P", identifier: "TES-99" },
          forwardEdges: [{ id: "B", type: "blocks" }],
        },
        P: {
          id: "P",
          identifier: "TES-99",
          title: "P",
          priority: 0,
          stateType: "started",
        },
        B: {
          id: "B",
          identifier: "TES-2",
          title: "B",
          priority: 0,
          stateType: "started",
        },
      });
      const tree = await loadDependencyTree(client, "A", {
        direction: "up",
        maxDepth: 10,
        edges: "all",
      });
      expect(tree.map((n) => n.id).sort()).toEqual(["A", "B", "P"]);
    });

    it("epic reachability: --edges=blocks on an epic walks children-and-their-blockers (lin-by4q)", async () => {
      // E is an epic with children C1, C2. C1 is blocked by X, C2 has no
      // blockers. The default --edges=blocks tree on the epic should show
      // children + their blocker chains (acceptance criterion b).
      const client = mockClient({
        E: {
          id: "E",
          identifier: "TES-10",
          title: "Epic",
          priority: 0,
          stateType: "started",
          children: [
            { id: "C1", identifier: "TES-11" },
            { id: "C2", identifier: "TES-12" },
          ],
        },
        C1: {
          id: "C1",
          identifier: "TES-11",
          title: "C1",
          priority: 0,
          stateType: "started",
          inverseEdges: [{ id: "X", type: "blocks" }],
        },
        C2: {
          id: "C2",
          identifier: "TES-12",
          title: "C2",
          priority: 0,
          stateType: "started",
        },
        X: {
          id: "X",
          identifier: "TES-20",
          title: "X",
          priority: 0,
          stateType: "started",
        },
      });
      const tree = await loadDependencyTree(client, "E", {
        direction: "down",
        maxDepth: 10,
        edges: "blocks",
      });
      // Epic root, plus both children, plus C1's blocker X.
      expect(tree.map((n) => n.id).sort()).toEqual(["C1", "C2", "E", "X"]);
      // Children are connected via parent-child; X via blocks.
      const c1 = tree.find((n) => n.id === "C1");
      const x = tree.find((n) => n.id === "X");
      expect(c1?.edge_from_parent).toBe("parent-child");
      expect(x?.edge_from_parent).toBe("blocks");
      expect(x?.parent_id).toBe("C1");
    });

    it("epic reachability does NOT cascade past root: child's children are not auto-expanded under --edges=blocks", async () => {
      // The "epic reachability" convenience is root-only — non-root parents
      // do NOT re-trigger the children expansion (that would re-introduce
      // the parent/blocks interleave we just fixed).
      const client = mockClient({
        E: {
          id: "E",
          identifier: "TES-10",
          title: "Epic",
          priority: 0,
          stateType: "started",
          children: [{ id: "SUBE", identifier: "TES-11" }],
        },
        SUBE: {
          id: "SUBE",
          identifier: "TES-11",
          title: "Sub-epic",
          priority: 0,
          stateType: "started",
          // SUBE itself has children, but with --edges=blocks they should
          // NOT be walked (only the root triggers the convenience).
          children: [{ id: "LEAF", identifier: "TES-12" }],
        },
        LEAF: {
          id: "LEAF",
          identifier: "TES-12",
          title: "Leaf",
          priority: 0,
          stateType: "started",
        },
      });
      const tree = await loadDependencyTree(client, "E", {
        direction: "down",
        maxDepth: 10,
        edges: "blocks",
      });
      // Only E and its direct children (SUBE); LEAF is NOT reached because
      // SUBE's children are not expanded under --edges=blocks for non-root.
      expect(tree.map((n) => n.id).sort()).toEqual(["E", "SUBE"]);
    });
  });
});

describe("renderMermaid", () => {
  it("emits a flowchart with edges and identifier labels", () => {
    const tree: TreeNode[] = [
      {
        id: "uuid-a",
        identifier: "TES-1",
        parent_id: null,
        title: "Alpha",
        status: "started",
        state_name: "In Progress",
        priority: 0,
        depth: 0,
        edge_from_parent: null,
        truncated: false,
      },
      {
        id: "uuid-b",
        identifier: "TES-2",
        parent_id: "uuid-a",
        title: "Bravo",
        status: "backlog",
        state_name: "Backlog",
        priority: 0,
        depth: 1,
        edge_from_parent: "blocks",
        truncated: false,
      },
    ];
    const out = renderMermaid(tree);
    expect(out).toContain("flowchart TD");
    expect(out).toContain('uuid_a["TES-1: Alpha"]');
    expect(out).toContain("uuid_a -- blocks --> uuid_b");
  });
});
