// tests/unit/commands/next-format.test.ts
//
// Byte-exact format tests for `linear next`. The fixture shape mirrors
// the structural subset `formatNext` reads from a candidate; full
// codegen fields are intentionally omitted so test data is small and
// reviewer-readable.

import { describe, expect, it } from "vitest";
import { formatNext, formatNextClaim } from "../../../src/commands/next.js";

interface NextFixture {
  identifier: string;
  title: string;
  priority: number;
  state: { type: string };
  labels?: { nodes: { name: string }[] } | null;
  parent?: {
    title: string;
    labels?: { nodes: { name: string }[] } | null;
  } | null;
}

const RIGHT_ARROW_PREFIX = " ← ";

describe("formatNext", () => {
  it("emits the empty-case banner with leading + trailing blank lines", () => {
    expect(formatNext([])).toBe(
      "\n✨ No ready work found (all issues have blocking dependencies)\n\n",
    );
  });

  it("renders a flat list (no tree connectors) with footer and legend", () => {
    const out = formatNext([
      {
        identifier: "TES-1",
        title: "first",
        priority: 2,
        state: { type: "backlog" },
      } as NextFixture,
      {
        identifier: "TES-2",
        title: "second",
        priority: 3,
        state: { type: "backlog" },
      } as NextFixture,
    ]);
    expect(out).toBe(
      [
        "○ TES-1 ● P2 first",
        "○ TES-2 ● P3 second",
        "",
        "-".repeat(80),
        "Ready: 2 issues with no active blockers",
        "",
        "Status: ○ to do  ◐ in progress  ● blocked  ✓ done  ❄ deferred",
        "",
      ].join("\n"),
    );
  });

  it("appends `← <parent-title>` when parent has type:epic", () => {
    const out = formatNext([
      {
        identifier: "TES-7",
        title: "child of epic A",
        priority: 2,
        state: { type: "backlog" },
        parent: {
          title: "Q2 Release",
          labels: { nodes: [{ name: "type:epic" }] },
        },
      } as NextFixture,
    ]);
    expect(out.split("\n")[0]).toBe(
      `○ TES-7 ● P2 child of epic A${RIGHT_ARROW_PREFIX}Q2 Release`,
    );
  });

  it("does NOT append parent suffix when parent is a plain task", () => {
    const out = formatNext([
      {
        identifier: "TES-10",
        title: "grandchild",
        priority: 3,
        state: { type: "backlog" },
        parent: {
          title: "child of epic A",
          // no type:epic label → parent is a task; suffix suppressed
          labels: { nodes: [] },
        },
      } as NextFixture,
    ]);
    expect(out.split("\n")[0]).toBe("○ TES-10 ● P3 grandchild");
  });

  it("does NOT append parent suffix when parent is null", () => {
    const out = formatNext([
      {
        identifier: "TES-2",
        title: "no parent",
        priority: 2,
        state: { type: "backlog" },
        parent: null,
      } as NextFixture,
    ]);
    expect(out.split("\n")[0]).toBe("○ TES-2 ● P2 no parent");
  });

  it("brackets non-task type via type:* label, in lowercase like the list view", () => {
    const out = formatNext([
      {
        identifier: "TES-5",
        title: "release",
        priority: 2,
        state: { type: "backlog" },
        labels: { nodes: [{ name: "type:epic" }] },
      } as NextFixture,
    ]);
    expect(out.split("\n")[0]).toBe("○ TES-5 ● P2 [epic] release");
  });

  it("uses the deferred icon when the deferred label is present", () => {
    const out = formatNext([
      {
        identifier: "TES-3",
        title: "snoozed",
        priority: 2,
        state: { type: "backlog" },
        labels: { nodes: [{ name: "deferred-until:2026-09-01" }] },
      } as NextFixture,
    ]);
    expect(out.split("\n")[0]).toBe("❄ TES-3 ● P2 snoozed");
  });

  it("preserves the caller's order (no resort inside the formatter)", () => {
    // listNextIssues sorts before calling formatNext. We must not reshuffle.
    const out = formatNext([
      {
        identifier: "TES-9",
        title: "z",
        priority: 4,
        state: { type: "backlog" },
      } as NextFixture,
      {
        identifier: "TES-1",
        title: "a",
        priority: 4,
        state: { type: "backlog" },
      } as NextFixture,
    ]);
    expect(out.split("\n").slice(0, 2)).toEqual([
      "○ TES-9 ● P4 z",
      "○ TES-1 ● P4 a",
    ]);
  });

  it("omits the P-column when priority is 0", () => {
    const out = formatNext([
      {
        identifier: "TES-4",
        title: "untriaged",
        priority: 0,
        state: { type: "backlog" },
      } as NextFixture,
    ]);
    expect(out.split("\n")[0]).toBe("○ TES-4 ● untriaged");
  });

  it("uses the IN_PROGRESS icon for state.type=started", () => {
    const out = formatNext([
      {
        identifier: "TES-6",
        title: "wip",
        priority: 2,
        state: { type: "started" },
      } as NextFixture,
    ]);
    expect(out.split("\n")[0]).toBe("◐ TES-6 ● P2 wip");
  });

  it("emits exactly one trailing newline", () => {
    const out = formatNext([
      {
        identifier: "TES-1",
        title: "x",
        priority: 2,
        state: { type: "backlog" },
      } as NextFixture,
    ]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatNextClaim", () => {
  it("emits the no-ready banner when the result array is empty", () => {
    expect(formatNextClaim([])).toBe("No issues ready to claim.\n");
  });

  it("renders the claimed line with identifier + title", () => {
    expect(
      formatNextClaim([{ identifier: "TES-42" }], "fix login regression"),
    ).toBe(
      "✓ Claimed TES-42: fix login regression (now in_progress, assigned to you)\n",
    );
  });

  it("tolerates a missing title (renders an empty title slot)", () => {
    // The claim path always has a title in production, but the formatter
    // is defensive — falling back to empty keeps the JSON envelope decoupled
    // from the text-presentation context.
    expect(formatNextClaim([{ identifier: "TES-7" }])).toBe(
      "✓ Claimed TES-7:  (now in_progress, assigned to you)\n",
    );
  });
});
