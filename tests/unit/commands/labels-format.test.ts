//
// Format tests for `linear labels list`. By default the formatter shows the
// label name (+ optional description). With `--with-counts` (lin-ov30.3) each
// node carries a `count` of issues using it, rendered as a `(N issues)` column
// between the name and the description. The header includes a count of labels
// returned, prefixed with a 🏷 glyph.

import { describe, expect, it } from "vitest";
import { formatLabelList } from "../../../src/commands/labels.js";

describe("formatLabelList", () => {
  it("renders the empty case with a 🏷 banner and trailing blank line", () => {
    expect(formatLabelList({ nodes: [] })).toBe("\n🏷 No labels found.\n\n");
  });

  it("emits the 🏷 header with the label count in parens", () => {
    const out = formatLabelList({
      nodes: [{ name: "bug" }, { name: "type:chore" }],
    });
    expect(out).toContain("🏷 Labels (2):");
  });

  it("starts with a leading blank line so the 🏷 row separates from previous output", () => {
    const out = formatLabelList({ nodes: [{ name: "bug" }] });
    expect(out.startsWith("\n🏷")).toBe(true);
  });

  it("pads the label-name column so descriptions align across rows", () => {
    const out = formatLabelList({
      nodes: [
        { name: "a", description: "first" },
        { name: "type:milestone", description: "second" },
        { name: "bug", description: "third" },
      ],
    });
    const rows = out.split("\n").filter((l) => l.startsWith("  "));
    const firstIdx = rows[0].indexOf("first");
    const secondIdx = rows[1].indexOf("second");
    const thirdIdx = rows[2].indexOf("third");
    expect(secondIdx).toBe(firstIdx);
    expect(thirdIdx).toBe(firstIdx);
  });

  it("omits the description column for labels without one (no trailing whitespace)", () => {
    const out = formatLabelList({
      nodes: [{ name: "alpha" }, { name: "beta", description: "with desc" }],
    });
    const lines = out.split("\n");
    const alphaLine = lines.find((l) => l.includes("alpha"));
    expect(alphaLine?.trimEnd()).toBe(alphaLine);
  });

  it("preserves caller order (service handles sort/cursor pagination)", () => {
    const out = formatLabelList({
      nodes: [{ name: "zebra" }, { name: "alpha" }, { name: "mango" }],
    });
    const lines = out.split("\n").filter((l) => l.startsWith("  "));
    expect(lines[0]).toContain("zebra");
    expect(lines[1]).toContain("alpha");
    expect(lines[2]).toContain("mango");
  });

  it("ends with exactly one trailing newline (blank padding handled by the joiner)", () => {
    const out = formatLabelList({ nodes: [{ name: "bug" }] });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n\n")).toBe(false);
  });

  it("renders a `(N issues)` column when counts are attached (lin-ov30.3)", () => {
    const out = formatLabelList({
      nodes: [
        { name: "bug", count: 12 },
        { name: "type:chore", count: 0 },
      ],
    });
    expect(out).toContain("(12 issues)");
    expect(out).toContain("(0 issues)");
  });

  it("uses the singular 'issue' for a count of exactly 1", () => {
    const out = formatLabelList({ nodes: [{ name: "bug", count: 1 }] });
    expect(out).toContain("(1 issue)");
    expect(out).not.toContain("(1 issues)");
  });

  it("places the count between the name and the description", () => {
    const out = formatLabelList({
      nodes: [{ name: "bug", count: 3, description: "a defect" }],
    });
    const row = out.split("\n").find((l) => l.includes("bug")) ?? "";
    expect(row.indexOf("(3 issues)")).toBeLessThan(row.indexOf("a defect"));
  });

  it("omits the count column entirely when no counts are attached (default)", () => {
    const out = formatLabelList({ nodes: [{ name: "bug" }] });
    expect(out).not.toContain("issue)");
    expect(out).not.toContain("issues)");
  });
});
