import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../../../src/common/unified-diff.js";

describe("unifiedDiff", () => {
  it("returns empty string for identical texts", () => {
    expect(unifiedDiff("a\nb\nc", "a\nb\nc")).toBe("");
  });

  it("renders a single-line change with context and hunk header", () => {
    const oldText = ["l1", "l2", "l3", "l4", "l5", "l6", "l7"].join("\n");
    const newText = ["l1", "l2", "l3", "CHANGED", "l5", "l6", "l7"].join("\n");
    const diff = unifiedDiff(oldText, newText, {
      oldLabel: "server",
      newLabel: "local",
    });
    expect(diff).toContain("--- server");
    expect(diff).toContain("+++ local");
    expect(diff).toContain("@@ -1,7 +1,7 @@");
    expect(diff).toContain("-l4");
    expect(diff).toContain("+CHANGED");
    // context lines are prefixed with a space
    expect(diff).toContain(" l3");
    expect(diff).toContain(" l5");
  });

  it("separates distant changes into distinct hunks", () => {
    const oldLines = Array.from({ length: 30 }, (_, i) => `line${i + 1}`);
    const newLines = [...oldLines];
    newLines[1] = "top-edit";
    newLines[27] = "bottom-edit";
    const diff = unifiedDiff(oldLines.join("\n"), newLines.join("\n"));
    const hunkCount = (diff.match(/^@@ /gm) ?? []).length;
    expect(hunkCount).toBe(2);
    expect(diff).toContain("-line2");
    expect(diff).toContain("+top-edit");
    expect(diff).toContain("-line28");
    expect(diff).toContain("+bottom-edit");
  });

  it("handles pure additions and pure removals", () => {
    const add = unifiedDiff("a\nb", "a\nx\nb");
    expect(add).toContain("+x");
    expect(add).not.toContain("-a");
    const remove = unifiedDiff("a\nx\nb", "a\nb");
    expect(remove).toContain("-x");
  });

  it("handles empty old text (new document)", () => {
    const diff = unifiedDiff("", "hello\nworld");
    expect(diff).toContain("+hello");
    expect(diff).toContain("+world");
  });
});
