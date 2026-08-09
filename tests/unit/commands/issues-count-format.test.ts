//
// Format tests for `linear issues count`. Two shapes:
// - Ungrouped:  a single integer + newline ("14\n")
// - Grouped:    "Total: <n>\n\n<key>: <count>\n..." with one line per group
//
// The service envelope (CountResult / GroupedCountResult) is rendered
// byte-faithfully by formatIssueCount / formatIssueCountGrouped.

import { describe, expect, it } from "vitest";
import {
  formatIssueCount,
  formatIssueCountGrouped,
} from "../../../src/commands/issues.js";

describe("formatIssueCount (ungrouped)", () => {
  it("renders a single integer followed by exactly one newline", () => {
    expect(formatIssueCount({ count: 14 })).toBe("14\n");
  });

  it("renders 0 as `0\\n`, not an empty string", () => {
    expect(formatIssueCount({ count: 0 })).toBe("0\n");
  });

  it("does not emit any leading whitespace or banner", () => {
    const out = formatIssueCount({ count: 3 });
    expect(out.startsWith(" ")).toBe(false);
    expect(out.startsWith("\n")).toBe(false);
  });
});

describe("formatIssueCountGrouped", () => {
  it("renders Total + blank line + sorted rows + trailing newline", () => {
    const out = formatIssueCountGrouped({
      total: 14,
      groups: [
        { group: "Done", count: 2 },
        { group: "In Progress", count: 1 },
        { group: "Todo", count: 11 },
      ],
    });
    expect(out).toBe(
      ["Total: 14", "", "Done: 2", "In Progress: 1", "Todo: 11", ""].join("\n"),
    );
  });

  it("preserves caller order (the service does the sorting)", () => {
    const out = formatIssueCountGrouped({
      total: 4,
      groups: [
        { group: "P1", count: 1 },
        { group: "P3", count: 2 },
        { group: "P2", count: 1 },
      ],
    });
    expect(out.split("\n").slice(2, 5)).toEqual(["P1: 1", "P3: 2", "P2: 1"]);
  });

  it("renders an empty group list as just `Total: 0\\n\\n`", () => {
    expect(formatIssueCountGrouped({ total: 0, groups: [] })).toBe(
      "Total: 0\n\n",
    );
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueCountGrouped({
      total: 1,
      groups: [{ group: "Backlog", count: 1 }],
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
