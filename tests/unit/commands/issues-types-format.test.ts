//
// Format tests for `linear issues types`. Two-block layout: a built-in
// section always, then either a "No custom types configured" trailer
// (with Linear-Hack instructions) or a "Custom types" list discovered
// from workspace 'type:*' labels.

import { describe, expect, it } from "vitest";
import { formatIssueTypes } from "../../../src/commands/issues.js";

describe("formatIssueTypes", () => {
  it("renders the built-in block + the 'no custom types' trailer", () => {
    const out = formatIssueTypes({
      core_types: [
        { name: "task", description: "General work item (default)" },
        { name: "bug", description: "Bug report or defect" },
      ],
      custom_types: [],
    });
    expect(out).toContain("Core work types (built-in):");
    expect(out).toContain("  task  General work item (default)");
    expect(out).toContain("  bug   Bug report or defect");
    expect(out).toContain("No custom types configured.");
    expect(out).toContain('Configure by creating a workspace label "type:');
  });

  it("pads the name column to the widest core type", () => {
    const out = formatIssueTypes({
      core_types: [
        { name: "task", description: "x" },
        { name: "milestone", description: "y" },
        { name: "bug", description: "z" },
      ],
      custom_types: [],
    });
    const lines = out.split("\n").filter((l) => l.startsWith("  "));
    // All core rows should align their description column at the same offset.
    const descCols = lines.slice(0, 3).map((l) => {
      // Description starts after the padded name + two spaces.
      // "  <name(pad-9)>  <desc>" → desc index = 4 + 9 + 2 = 15? Actually
      // just check that descriptions align by searching for known content.
      const xIdx = l.indexOf("x");
      const yIdx = l.indexOf("y");
      const zIdx = l.indexOf("z");
      return xIdx >= 0 ? xIdx : yIdx >= 0 ? yIdx : zIdx;
    });
    expect(descCols.every((c) => c === descCols[0])).toBe(true);
  });

  it("renders the Custom types section when present (sorted by caller)", () => {
    const out = formatIssueTypes({
      core_types: [{ name: "task", description: "default" }],
      custom_types: ["research", "rfc"],
    });
    expect(out).toContain("Custom types (from workspace 'type:*' labels):");
    expect(out).toContain("  research");
    expect(out).toContain("  rfc");
    expect(out).not.toContain("No custom types configured.");
  });

  it("emits a blank line between the built-in block and the trailer", () => {
    const out = formatIssueTypes({
      core_types: [{ name: "task", description: "default" }],
      custom_types: [],
    });
    const lines = out.split("\n");
    const lastCore = lines.findIndex((l) => l.includes("task"));
    expect(lines[lastCore + 1]).toBe("");
    expect(lines[lastCore + 2]).toBe("No custom types configured.");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueTypes({
      core_types: [{ name: "task", description: "x" }],
      custom_types: [],
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
