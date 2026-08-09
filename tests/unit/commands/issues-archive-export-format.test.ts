//
// Format tests for the issue lifecycle echoes: archive / unarchive / export.
// Export is JSONL-on-stdout when -o is omitted.
//
//   archive    → `Archived <id>: <title>`
//   unarchive  → `Unarchived <id>: <title>`
//   export -o  → `Exported <N> issues to <file>[ (filter applied; includes archived)]`
//   export     → no echo footer (raw JSONL streamed to stdout; this formatter
//                is never invoked in that path)

import { describe, expect, it } from "vitest";
import {
  formatIssueArchive,
  formatIssueExport,
  formatIssueUnarchive,
} from "../../../src/commands/issues/transfer.js";

describe("formatIssueArchive / formatIssueUnarchive", () => {
  const row = { identifier: "TES-42", title: "Refactor parser" };

  it("formatIssueArchive renders `Archived <id>: <title>`", () => {
    expect(formatIssueArchive(row)).toBe("Archived TES-42: Refactor parser\n");
  });

  it("formatIssueUnarchive renders `Unarchived <id>: <title>`", () => {
    expect(formatIssueUnarchive(row)).toBe(
      "Unarchived TES-42: Refactor parser\n",
    );
  });

  it("both end with exactly one trailing newline", () => {
    for (const out of [formatIssueArchive(row), formatIssueUnarchive(row)]) {
      expect(out.endsWith("\n")).toBe(true);
      expect(out.endsWith("\n\n")).toBe(false);
    }
  });

  it("preserves special characters in title verbatim", () => {
    const r = { identifier: "TES-1", title: 'Quote "test"' };
    expect(formatIssueArchive(r)).toBe('Archived TES-1: Quote "test"\n');
  });

  it("formatIssueArchive renders one line per row when given an array (lin-2d20)", () => {
    const rows = [
      { identifier: "TES-1", title: "First" },
      { identifier: "TES-2", title: "Second" },
      { identifier: "TES-3", title: "Third" },
    ];
    expect(formatIssueArchive(rows)).toBe(
      "Archived TES-1: First\nArchived TES-2: Second\nArchived TES-3: Third\n",
    );
  });

  it("formatIssueUnarchive renders one line per row when given an array (lin-2d20)", () => {
    const rows = [
      { identifier: "TES-1", title: "First" },
      { identifier: "TES-2", title: "Second" },
    ];
    expect(formatIssueUnarchive(rows)).toBe(
      "Unarchived TES-1: First\nUnarchived TES-2: Second\n",
    );
  });

  it("empty array emits just a trailing newline (no rows)", () => {
    expect(formatIssueArchive([])).toBe("\n");
    expect(formatIssueUnarchive([])).toBe("\n");
  });
});

describe("formatIssueExport", () => {
  it("renders the basic line with no tags when no filter/archive flags", () => {
    expect(
      formatIssueExport({
        output: "issues.jsonl",
        issue_count: 25,
        filter_applied: false,
        include_archived: false,
      }),
    ).toBe("Exported 25 issues to issues.jsonl\n");
  });

  it("appends `(filter applied)` when filter_applied is true", () => {
    expect(
      formatIssueExport({
        output: "tes.jsonl",
        issue_count: 14,
        filter_applied: true,
        include_archived: false,
      }),
    ).toBe("Exported 14 issues to tes.jsonl (filter applied)\n");
  });

  it("appends `(includes archived)` when include_archived is true", () => {
    expect(
      formatIssueExport({
        output: "all.jsonl",
        issue_count: 50,
        filter_applied: false,
        include_archived: true,
      }),
    ).toBe("Exported 50 issues to all.jsonl (includes archived)\n");
  });

  it("joins both tags with `; ` when both are true", () => {
    expect(
      formatIssueExport({
        output: "out.jsonl",
        issue_count: 7,
        filter_applied: true,
        include_archived: true,
      }),
    ).toBe(
      "Exported 7 issues to out.jsonl (filter applied; includes archived)\n",
    );
  });

  it("handles zero-count exports", () => {
    expect(
      formatIssueExport({
        output: "empty.jsonl",
        issue_count: 0,
        filter_applied: false,
        include_archived: false,
      }),
    ).toBe("Exported 0 issues to empty.jsonl\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueExport({
      output: "x.jsonl",
      issue_count: 1,
      filter_applied: false,
      include_archived: false,
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
