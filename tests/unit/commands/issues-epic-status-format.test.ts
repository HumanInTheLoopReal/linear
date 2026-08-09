//
// Format tests for `linear issues epic-status`. Each epic gets a
// two-line block:
//   <icon> <id> <title>
//      Progress: M/N children closed (P%)
//
// Separated by a blank line. The Linear formatter uses statusIcon based
// on the epic's state.type (categorical mapping shared across formatters).

import { describe, expect, it } from "vitest";
import {
  formatCloseEligibleEpicsClosed,
  formatCloseEligibleEpicsDryRun,
  formatIssueEpicStatus,
} from "../../../src/commands/_epic-status.js";

function epic(o: {
  identifier: string;
  title: string;
  state?: { name: string; type: string };
  total_children: number;
  closed_children: number;
}) {
  return {
    epic: {
      identifier: o.identifier,
      title: o.title,
      state: o.state ?? { name: "Backlog", type: "backlog" },
    },
    total_children: o.total_children,
    closed_children: o.closed_children,
  };
}

describe("formatIssueEpicStatus", () => {
  it("renders the empty case with a leading + trailing blank line", () => {
    expect(formatIssueEpicStatus([])).toBe(
      "\nNo open issues with children found.\n\n",
    );
  });

  it("renders each epic as two lines: header row + Progress row", () => {
    const out = formatIssueEpicStatus([
      epic({
        identifier: "TES-10",
        title: "Q2 Release",
        total_children: 3,
        closed_children: 1,
      }),
    ]);
    expect(out).toContain("○ TES-10 Q2 Release");
    expect(out).toContain("   Progress: 1/3 children closed (33%)");
  });

  it("uses statusIcon based on state.type (started → ◐)", () => {
    const out = formatIssueEpicStatus([
      epic({
        identifier: "TES-11",
        title: "Work",
        state: { name: "In Progress", type: "started" },
        total_children: 2,
        closed_children: 0,
      }),
    ]);
    expect(out).toContain("◐ TES-11 Work");
  });

  it("rounds the percentage to the nearest integer", () => {
    const out = formatIssueEpicStatus([
      epic({
        identifier: "TES-12",
        title: "X",
        total_children: 3,
        closed_children: 2,
      }),
    ]);
    // 2/3 = 66.666... → 67
    expect(out).toContain("(67%)");
  });

  it("reports 100% when every child is closed", () => {
    const out = formatIssueEpicStatus([
      epic({
        identifier: "TES-13",
        title: "Done",
        total_children: 2,
        closed_children: 2,
      }),
    ]);
    expect(out).toContain("Progress: 2/2 children closed (100%)");
  });

  it("separates multiple epics with a blank line", () => {
    const out = formatIssueEpicStatus([
      epic({
        identifier: "TES-A",
        title: "A",
        total_children: 1,
        closed_children: 0,
      }),
      epic({
        identifier: "TES-B",
        title: "B",
        total_children: 2,
        closed_children: 1,
      }),
    ]);
    const lines = out.split("\n");
    const aIdx = lines.findIndex((l) => l.includes("TES-A"));
    const bIdx = lines.findIndex((l) => l.includes("TES-B"));
    // Two lines for A (header + progress), one blank, then header of B
    expect(bIdx - aIdx).toBeGreaterThanOrEqual(3);
    // The blank-separator line between A's progress row and B's header is empty
    expect(lines[bIdx - 1]).toBe("");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueEpicStatus([
      epic({
        identifier: "TES-Z",
        title: "Z",
        total_children: 1,
        closed_children: 1,
      }),
    ]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatCloseEligibleEpicsDryRun", () => {
  it("reports the empty case", () => {
    expect(
      formatCloseEligibleEpicsDryRun({
        dry_run: true,
        eligible: [],
        count: 0,
      }),
    ).toBe("DRY-RUN: no eligible epics found.\n");
  });

  it("shows the header line and reuses the per-epic progress rows", () => {
    const out = formatCloseEligibleEpicsDryRun({
      dry_run: true,
      eligible: [
        epic({
          identifier: "TES-100",
          title: "Q2 release",
          total_children: 3,
          closed_children: 3,
        }),
      ],
      count: 1,
    });
    expect(out).toContain("DRY-RUN: would close 1 eligible epic\n");
    expect(out).toContain("○ TES-100 Q2 release");
    expect(out).toContain("Progress: 3/3 children closed (100%)");
  });

  it("uses plural 'epics' when count > 1", () => {
    const out = formatCloseEligibleEpicsDryRun({
      dry_run: true,
      eligible: [
        epic({
          identifier: "TES-100",
          title: "A",
          total_children: 1,
          closed_children: 1,
        }),
        epic({
          identifier: "TES-200",
          title: "B",
          total_children: 1,
          closed_children: 1,
        }),
      ],
      count: 2,
    });
    expect(out).toContain("would close 2 eligible epics");
  });
});

describe("formatCloseEligibleEpicsClosed", () => {
  it("reports the empty case", () => {
    expect(formatCloseEligibleEpicsClosed({ closed: [], count: 0 })).toBe(
      "No eligible epics to close.\n",
    );
  });

  it("lists one ✓ <identifier> row per closed epic", () => {
    const out = formatCloseEligibleEpicsClosed({
      closed: [
        { id: "u-1", identifier: "TES-100" },
        { id: "u-2", identifier: "TES-200" },
      ],
      count: 2,
    });
    expect(out).toBe(
      ["Closed 2 epics:", "", "  ✓ TES-100", "  ✓ TES-200", ""].join("\n"),
    );
  });

  it("uses singular 'epic' when count === 1", () => {
    const out = formatCloseEligibleEpicsClosed({
      closed: [{ id: "u-1", identifier: "TES-100" }],
      count: 1,
    });
    expect(out).toContain("Closed 1 epic:");
  });
});
