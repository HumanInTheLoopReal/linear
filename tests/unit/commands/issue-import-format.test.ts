import { describe, expect, it } from "vitest";
import { formatIssueImport } from "../../../src/commands/_issue-import-format.js";

describe("formatIssueImport", () => {
  it("renders import counts, skips, relations, and row errors", () => {
    expect(
      formatIssueImport({
        action: "imported",
        source: "issues.jsonl",
        dry_run: false,
        parsed: 5,
        created: 2,
        dedup_skipped: 1,
        memories_skipped: 1,
        ids: ["ENG-1", "ENG-2"],
        relations_created: 1,
        errors: [
          { line_index: 4, identifier: "OLD-4", message: "team not found" },
        ],
      }),
    ).toBe(
      "Imported 2 issues (1 memory rows skipped) from issues.jsonl (1 duplicates skipped)\nCreated 1 issue relations\n⚠ 1 errors:\n  line 4 OLD-4: team not found\n",
    );
  });

  it("uses preview language for a dry run", () => {
    expect(
      formatIssueImport({
        action: "planned",
        source: "<stdin>",
        dry_run: true,
        parsed: 1,
        created: 1,
        dedup_skipped: 0,
        memories_skipped: 0,
        ids: [],
        relations_created: 0,
        errors: [],
      }),
    ).toBe("Would import 1 issues from <stdin>\n");
  });
});
