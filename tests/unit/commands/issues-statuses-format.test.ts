//
// Format tests for `linear issues statuses`. In Linear, workflow states
// are per-team and fully user-configurable. The formatter groups by
// team, sorts within each team by the service's position-sort, and tags
// each row with its category bracket.

import { describe, expect, it } from "vitest";
import { formatIssueStatuses } from "../../../src/commands/issues.js";

type Status = {
  name: string;
  type: string;
  category: string;
  description?: string;
  team: { key: string; name: string };
};

function s(overrides: Partial<Status>): Status {
  return {
    name: "Backlog",
    type: "backlog",
    category: "active",
    team: { key: "TES", name: "Test" },
    ...overrides,
  };
}

describe("formatIssueStatuses", () => {
  it("renders the empty case with a leading + trailing blank line", () => {
    expect(formatIssueStatuses({ statuses: [] })).toBe(
      "\nNo workflow states found.\n\n",
    );
  });

  it("groups rows under a `<KEY> (<name>):` heading per team", () => {
    const out = formatIssueStatuses({
      statuses: [
        s({ name: "Backlog", type: "backlog", category: "active" }),
        s({ name: "Done", type: "completed", category: "done" }),
      ],
    });
    expect(out).toContain("TES (Test):");
  });

  it("singular vs plural team count in the banner", () => {
    const single = formatIssueStatuses({ statuses: [s({})] });
    expect(single).toContain("(1 across 1 team):");

    const multi = formatIssueStatuses({
      statuses: [
        s({ team: { key: "TES", name: "Test" } }),
        s({ team: { key: "ENG", name: "Engineering" } }),
      ],
    });
    expect(multi).toContain("(2 across 2 teams):");
  });

  it("maps state.type to the canonical categorical icon", () => {
    const out = formatIssueStatuses({
      statuses: [
        s({ name: "Backlog", type: "backlog", category: "active" }),
        s({ name: "Working", type: "started", category: "wip" }),
        s({ name: "Shipped", type: "completed", category: "done" }),
      ],
    });
    expect(out).toContain("○ Backlog");
    expect(out).toContain("◐ Working");
    expect(out).toContain("✓ Shipped");
  });

  it("pads the status name column to the widest row within the team", () => {
    const out = formatIssueStatuses({
      statuses: [
        s({ name: "A", type: "backlog", category: "active" }),
        s({ name: "Much Longer Name", type: "started", category: "wip" }),
      ],
    });
    // Both rows should have a `[`-bracket starting at the same column.
    const rows = out.split("\n").filter((l) => l.includes("["));
    const cols = rows.map((r) => r.indexOf("["));
    expect(cols.every((c) => c === cols[0])).toBe(true);
  });

  it("pads the category to 6 chars so brackets line up regardless of category", () => {
    const out = formatIssueStatuses({
      statuses: [
        s({ name: "X", category: "wip" }),
        s({ name: "Y", category: "active" }),
        s({ name: "Z", category: "done" }),
      ],
    });
    expect(out).toContain("[wip   ]");
    expect(out).toContain("[active]");
    expect(out).toContain("[done  ]");
  });

  it("appends a description after the category when present, omits when empty", () => {
    const out = formatIssueStatuses({
      statuses: [
        s({ name: "X", description: "team default" }),
        s({ name: "Y" }), // no description
      ],
    });
    expect(out).toContain("[active]  team default");
    // Plain (no description) row ends with `]` not `]  `:
    const yLine = out.split("\n").find((l) => l.includes("Y "));
    expect(yLine?.endsWith("]")).toBe(true);
  });

  it("emits the Categories trailer (no 'frozen' since Linear has no equivalent)", () => {
    const out = formatIssueStatuses({ statuses: [s({})] });
    expect(out).toContain("Categories: active, wip, done");
    expect(out).not.toContain("frozen");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueStatuses({ statuses: [s({})] });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
