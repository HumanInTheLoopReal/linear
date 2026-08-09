//
// Format tests for `linear issues status` (alias `stats`). Renders a
// "📊 Issue Database Status" header + aligned-column summary block
// against our `StatusOutput.summary` envelope.
//
// Notes:
// - The status label is rendered as "To Do" to match the rest of
//   the linear text output (status legend says "to do").
// - The footer points at `linear issues list`.

import { describe, expect, it } from "vitest";
import { formatIssueStatus } from "../../../src/commands/issues.js";

function summary(o: Partial<Record<string, number>> = {}) {
  return {
    summary: {
      total_issues: 14,
      open_issues: 11,
      in_progress_issues: 0,
      blocked_issues: 1,
      deferred_issues: 0,
      closed_issues: 2,
      ready_issues: 10,
      ...o,
    },
  };
}

describe("formatIssueStatus", () => {
  it("emits the 📊 header with leading + trailing blank lines around the section", () => {
    const out = formatIssueStatus(summary());
    expect(out.startsWith("\n📊 Issue Database Status\n\nSummary:")).toBe(true);
  });

  it("renders the 7 summary rows in order with their counts", () => {
    const out = formatIssueStatus(summary());
    expect(out).toContain("Total Issues:");
    expect(out).toContain("To Do:");
    expect(out).toContain("In Progress:");
    expect(out).toContain("Blocked:");
    expect(out).toContain("Deferred:");
    expect(out).toContain("Done:");
    expect(out).toContain("Ready to Work:");
    // Rows appear in the expected order, top-to-bottom.
    const lines = out.split("\n");
    const order = [
      "Total Issues",
      "To Do",
      "In Progress",
      "Blocked",
      "Deferred",
      "Done",
      "Ready to Work",
    ];
    const positions = order.map((label) =>
      lines.findIndex((l) => l.includes(`${label}:`)),
    );
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("pads the label column to the widest label so the number column aligns", () => {
    const out = formatIssueStatus(summary());
    const rows = out.split("\n").filter((l) => /^\s+\w.*:\s+\d+$/.test(l));
    // The number-column should start at the same index in every row.
    const numCols = rows.map((r) => r.search(/\d+$/));
    expect(numCols.length).toBeGreaterThanOrEqual(7);
    expect(numCols.every((c) => c === numCols[0])).toBe(true);
  });

  it("renders the 'To Do' label to match the linear status legend (not 'Open')", () => {
    const out = formatIssueStatus(summary());
    expect(out).toContain("To Do:");
    const openLines = out.split("\n").filter((l) => /^\s*Open:/.test(l));
    expect(openLines).toEqual([]);
  });

  it("points the footer at `linear issues list`", () => {
    const out = formatIssueStatus(summary());
    expect(out).toContain("'linear issues list'");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueStatus(summary());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
