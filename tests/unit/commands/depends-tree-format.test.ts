//
// Format tests for `linear depends tree`. The fixture shape mirrors the
// flat `TreeNode[]` `loadDependencyTree` returns: each node carries
// `depth`, `parent_id`, and an `edge_from_parent` token. The text
// renderer walks the array, computes connectors from sibling order at
// each level, and emits the tree view.

import { describe, expect, it } from "vitest";
import { formatDepTree } from "../../../src/commands/depends.js";
import type { TreeNode } from "../../../src/services/dep-tree-service.js";

function node(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id: "u-root",
    identifier: "TES-1",
    parent_id: null,
    title: "Root",
    status: "backlog",
    state_name: "Backlog",
    priority: 2,
    depth: 0,
    edge_from_parent: null,
    truncated: false,
    ...overrides,
  };
}

const BOLD_OPEN = "\x1b[1m";
const BOLD_CLOSE = "\x1b[m";

describe("formatDepTree", () => {
  it("emits the header line with the root identifier", () => {
    const out = formatDepTree([node()]);
    expect(out.startsWith("\n🌲 Dependency tree for TES-1:\n\n")).toBe(true);
  });

  it("marks the root [READY] when it has no descendants (no blockers, no parents)", () => {
    const out = formatDepTree([node()]);
    expect(out).toContain(`${BOLD_OPEN}[READY]${BOLD_CLOSE}`);
    expect(out).not.toContain("[BLOCKED]");
  });

  it("marks the root [BLOCKED] as soon as there is any descendant in the tree", () => {
    const out = formatDepTree([
      node({ id: "u-root", identifier: "TES-1" }),
      node({
        id: "u-blocker",
        identifier: "TES-2",
        parent_id: "u-root",
        title: "blocker",
        priority: 3,
        depth: 1,
        edge_from_parent: "blocks",
      }),
    ]);
    expect(out).toContain(`${BOLD_OPEN}[BLOCKED]${BOLD_CLOSE}`);
    expect(out).not.toContain("[READY]");
  });

  it("uses Linear's state.name in the row text (not status buckets)", () => {
    const out = formatDepTree([
      node({ state_name: "In Review", status: "started" }),
    ]);
    expect(out).toContain("(In Review)");
    expect(out).not.toContain("(started)");
    expect(out).not.toContain("(in_progress)");
  });

  it("falls back to the raw state.type if state_name is empty", () => {
    const out = formatDepTree([node({ state_name: "", status: "started" })]);
    expect(out).toContain("(started)");
  });

  it("renders priority as [P<n>] when present and drops it for priority 0", () => {
    expect(formatDepTree([node({ priority: 2 })])).toContain("[P2]");
    expect(formatDepTree([node({ priority: 0 })])).not.toContain("[P");
  });

  it("renders direct descendants with 4-space leading indent + ├──/└── connectors", () => {
    const out = formatDepTree([
      node({ id: "u-root", identifier: "TES-1", title: "root" }),
      node({
        id: "u-a",
        identifier: "TES-2",
        parent_id: "u-root",
        title: "parent",
        depth: 1,
        edge_from_parent: "parent-child",
      }),
      node({
        id: "u-b",
        identifier: "TES-3",
        parent_id: "u-root",
        title: "blocker",
        priority: 3,
        depth: 1,
        edge_from_parent: "blocks",
      }),
    ]);
    const lines = out.split("\n");
    // Root line is at index 3 (blank, header, blank, root). Then two siblings.
    expect(lines[4]).toBe("    ├── TES-2: parent [P2] (Backlog)");
    expect(lines[5]).toBe("    └── TES-3: blocker [P3] (Backlog)");
  });

  it("walks linear parent chains as descending └── only (single-child levels)", () => {
    // A grandchild's tree: root → parent → grandparent, all single-child.
    const out = formatDepTree([
      node({ id: "u-root", identifier: "TES-1.1", title: "grandchild" }),
      node({
        id: "u-p",
        identifier: "TES-1",
        parent_id: "u-root",
        title: "child",
        priority: 2,
        depth: 1,
        edge_from_parent: "parent-child",
      }),
      node({
        id: "u-gp",
        identifier: "TES-0",
        parent_id: "u-p",
        title: "epic",
        priority: 1,
        depth: 2,
        edge_from_parent: "parent-child",
      }),
    ]);
    const lines = out.split("\n");
    expect(lines[4]).toBe("    └── TES-1: child [P2] (Backlog)");
    // Level-2 descendant: parent's parent column is blank (4 spaces) since
    // parent was the last sibling. So leading indent is "    " (root pad) +
    // "    " (level-1 column) + connector.
    expect(lines[5]).toBe("        └── TES-0: epic [P1] (Backlog)");
  });

  it("draws a │ continuation column when a non-last sibling has descendants of its own", () => {
    // Two siblings at depth 1; the first has a child of its own.
    const out = formatDepTree([
      node({ id: "u-root", identifier: "TES-1", title: "root" }),
      node({
        id: "u-a",
        identifier: "TES-2",
        parent_id: "u-root",
        title: "a",
        priority: 2,
        depth: 1,
        edge_from_parent: "blocks",
      }),
      node({
        id: "u-a-child",
        identifier: "TES-4",
        parent_id: "u-a",
        title: "a child",
        priority: 3,
        depth: 2,
        edge_from_parent: "blocks",
      }),
      node({
        id: "u-b",
        identifier: "TES-3",
        parent_id: "u-root",
        title: "b",
        priority: 2,
        depth: 1,
        edge_from_parent: "blocks",
      }),
    ]);
    const lines = out.split("\n");
    expect(lines[4]).toBe("    ├── TES-2: a [P2] (Backlog)");
    expect(lines[5]).toBe("    │   └── TES-4: a child [P3] (Backlog)");
    expect(lines[6]).toBe("    └── TES-3: b [P2] (Backlog)");
  });

  it("ends with a single trailing newline + one blank line above it", () => {
    const out = formatDepTree([node()]);
    expect(out.endsWith("\n\n")).toBe(true);
    expect(out.endsWith("\n\n\n")).toBe(false);
  });

  it("handles the defensive empty-tree case without throwing", () => {
    expect(() => formatDepTree([])).not.toThrow();
  });
});
