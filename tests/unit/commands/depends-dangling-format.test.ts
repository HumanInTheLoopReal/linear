// Format tests for `linear depends dangling` (lin-wb60).
// The verb prints one row per broken IssueRelation; the row should give an
// operator enough context to act (identifier + title + relation type +
// direction + relation_id for surgical removal).

import { describe, expect, it } from "vitest";
import { formatDanglingEdges } from "../../../src/commands/depends.js";

describe("formatDanglingEdges", () => {
  it("renders the clean case with a ✓ banner and trailing blank", () => {
    const out = formatDanglingEdges({ dangling_edges: 0, edges: [] });
    expect(out).toBe("\n✓ No dangling dependency edges found\n\n");
    expect(out.endsWith("\n\n")).toBe(true);
  });

  it("renders one row per dangling edge with type + direction + relation id", () => {
    const out = formatDanglingEdges({
      dangling_edges: 2,
      edges: [
        {
          source_id: "u-1",
          source_identifier: "TES-1",
          source_title: "Login bug",
          relation_id: "rel-aaa",
          relation_type: "blocks",
          direction: "forward",
        },
        {
          source_id: "u-2",
          source_identifier: "TES-2",
          source_title: "Logout bug",
          relation_id: "rel-bbb",
          relation_type: "related",
          direction: "inverse",
        },
      ],
    });
    expect(out).toContain("⚠ Dangling dependency edges (2)");
    expect(out).toContain(
      `  TES-1 "Login bug"  [blocks, forward]  relation=rel-aaa`,
    );
    expect(out).toContain(
      `  TES-2 "Logout bug"  [related, inverse]  relation=rel-bbb`,
    );
  });
});
