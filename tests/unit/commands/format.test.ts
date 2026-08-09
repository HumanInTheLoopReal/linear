import { describe, expect, it } from "vitest";
import {
  priorityCol,
  renderFooter,
  renderTree,
  SEPARATOR,
  STATUS_ICONS,
  STATUS_LEGEND,
  statusFromType,
  statusIcon,
  typeLabel,
} from "../../../src/commands/_format.js";

describe("statusFromType", () => {
  it("maps Linear state.type strings to status buckets", () => {
    expect(statusFromType("triage")).toBe("open");
    expect(statusFromType("backlog")).toBe("open");
    expect(statusFromType("unstarted")).toBe("open");
    expect(statusFromType("started")).toBe("in_progress");
    expect(statusFromType("completed")).toBe("closed");
    expect(statusFromType("canceled")).toBe("closed");
    expect(statusFromType("duplicate")).toBe("closed");
  });

  it("treats unknown state types as open (forward-compat)", () => {
    expect(statusFromType("future-linear-state")).toBe("open");
  });

  it("applies blocked override on top of any open state", () => {
    expect(statusFromType("backlog", { blocked: true })).toBe("blocked");
    expect(statusFromType("started", { blocked: true })).toBe("blocked");
  });

  it("applies deferred override and outranks blocked", () => {
    expect(statusFromType("backlog", { deferred: true })).toBe("deferred");
    expect(statusFromType("backlog", { deferred: true, blocked: true })).toBe(
      "deferred",
    );
  });
});

describe("statusIcon", () => {
  it("returns the canonical glyph for each bucket", () => {
    expect(statusIcon("backlog")).toBe("○");
    expect(statusIcon("started")).toBe("◐");
    expect(statusIcon("completed")).toBe("✓");
    expect(statusIcon("backlog", { blocked: true })).toBe("●");
    expect(statusIcon("backlog", { deferred: true })).toBe("❄");
  });

  it("exposes the canonical icon table", () => {
    expect(STATUS_ICONS).toEqual({
      open: "○",
      in_progress: "◐",
      blocked: "●",
      closed: "✓",
      deferred: "❄",
    });
  });
});

describe("priorityCol", () => {
  it("emits P1-P4 for priorities 1-4", () => {
    expect(priorityCol(1)).toBe("P1");
    expect(priorityCol(2)).toBe("P2");
    expect(priorityCol(3)).toBe("P3");
    expect(priorityCol(4)).toBe("P4");
  });

  it("returns empty string for 'no priority' and unknown values", () => {
    expect(priorityCol(0)).toBe("");
    expect(priorityCol(null)).toBe("");
    expect(priorityCol(undefined)).toBe("");
    expect(priorityCol(-1)).toBe("");
    expect(priorityCol(5)).toBe("");
  });
});

describe("typeLabel", () => {
  it("brackets non-task type:* labels", () => {
    expect(typeLabel([{ name: "type:epic" }])).toBe("[epic]");
    expect(typeLabel([{ name: "type:bug" }])).toBe("[bug]");
    expect(typeLabel([{ name: "type:feature" }])).toBe("[feature]");
  });

  it("returns empty for type:task or no type label", () => {
    expect(typeLabel([{ name: "type:task" }])).toBe("");
    expect(typeLabel([{ name: "priority:high" }])).toBe("");
    expect(typeLabel([])).toBe("");
    expect(typeLabel(undefined)).toBe("");
  });

  it("unwraps a GraphQL connection node list", () => {
    expect(typeLabel({ nodes: [{ name: "type:epic" }] })).toBe("[epic]");
    expect(typeLabel({ nodes: [] })).toBe("");
  });

  it("picks the first type:* label and ignores trailing labels", () => {
    expect(
      typeLabel([
        { name: "scope:frontend" },
        { name: "type:bug" },
        { name: "type:epic" },
      ]),
    ).toBe("[bug]");
  });
});

describe("renderTree", () => {
  it("renders direct children with ├── and └── (no indent columns)", () => {
    const out = renderTree([
      { ancestorContinues: [], isLast: false, content: "○ child-1" },
      { ancestorContinues: [], isLast: true, content: "○ child-2" },
    ]);
    expect(out).toBe("├── ○ child-1\n└── ○ child-2");
  });

  it("renders grandchildren with │ continuation under a non-last parent", () => {
    // The formatter emits the root line itself; renderTree handles only
    // descendants.
    const out = renderTree([
      { ancestorContinues: [], isLast: false, content: "○ child-1" },
      {
        ancestorContinues: [true],
        isLast: false,
        content: "○ grandchild-1a",
      },
      {
        ancestorContinues: [true],
        isLast: true,
        content: "○ grandchild-1b",
      },
      { ancestorContinues: [], isLast: true, content: "○ child-2" },
    ]);
    expect(out).toBe(
      [
        "├── ○ child-1",
        "│   ├── ○ grandchild-1a",
        "│   └── ○ grandchild-1b",
        "└── ○ child-2",
      ].join("\n"),
    );
  });

  it("renders blank columns under a last-sibling parent", () => {
    // When a parent IS the last sibling at its depth, the column below it
    // is blank (4 spaces) instead of │.
    const out = renderTree([
      { ancestorContinues: [], isLast: true, content: "○ child-only" },
      {
        ancestorContinues: [false],
        isLast: false,
        content: "○ grand-a",
      },
      {
        ancestorContinues: [false],
        isLast: true,
        content: "○ grand-b",
      },
    ]);
    expect(out).toBe(
      ["└── ○ child-only", "    ├── ○ grand-a", "    └── ○ grand-b"].join("\n"),
    );
  });

  it("returns empty string for an empty row list", () => {
    expect(renderTree([])).toBe("");
  });
});

describe("renderFooter / constants", () => {
  it("SEPARATOR is exactly 80 dashes", () => {
    expect(SEPARATOR).toHaveLength(80);
    expect(SEPARATOR).toMatch(/^-+$/);
  });

  it("STATUS_LEGEND uses workspace-agnostic categorical wording", () => {
    expect(STATUS_LEGEND).toBe(
      "Status: ○ to do  ◐ in progress  ● blocked  ✓ done  ❄ deferred",
    );
  });

  it("renderFooter composes separator + total + blank + legend", () => {
    const out = renderFooter("Total: 14 issues (10 to do, 2 in progress)");
    expect(out).toBe(
      [
        SEPARATOR,
        "Total: 14 issues (10 to do, 2 in progress)",
        "",
        STATUS_LEGEND,
      ].join("\n"),
    );
  });
});
