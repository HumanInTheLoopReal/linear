// Format tests for `linear issues find-duplicates` (lin-zciy).
//
// Two formatters cover the command's five output sites:
//   - formatDuplicatePairs   : --method mechanical | --method ai
//   - formatDuplicateGroups  : --method exact (default), --auto-merge --dry-run,
//                              --auto-merge live
// JSON envelopes are exercised separately via the global --json dispatcher;
// these tests pin the text shape only.

import { describe, expect, it } from "vitest";
import {
  formatDuplicateGroups,
  formatDuplicatePairs,
} from "../../../src/commands/issues.js";

describe("formatDuplicatePairs (mechanical / ai)", () => {
  it("reports the empty case with method + threshold context", () => {
    expect(
      formatDuplicatePairs({
        pairs: [],
        count: 0,
        method: "mechanical",
        threshold: 0.5,
      }),
    ).toBe("No duplicate pairs found (method: mechanical, threshold: 0.5).\n");
  });

  it("renders one row per pair with rounded similarity %", () => {
    const out = formatDuplicatePairs({
      pairs: [
        {
          issue_a_id: "TES-1",
          issue_b_id: "TES-2",
          issue_a_title: "fix login",
          issue_b_title: "login fix",
          similarity: 0.875,
          method: "mechanical",
        },
      ],
      count: 1,
      method: "mechanical",
      threshold: 0.5,
    });
    expect(out).toContain(
      "Found 1 duplicate pair (method: mechanical, threshold: 0.5):",
    );
    expect(out).toContain(`  88%  TES-1 "fix login"  ←→  TES-2 "login fix"`);
  });

  it("appends ai-only fields (reason, candidates_evaluated, model)", () => {
    const out = formatDuplicatePairs({
      pairs: [
        {
          issue_a_id: "TES-1",
          issue_b_id: "TES-2",
          issue_a_title: "a",
          issue_b_title: "b",
          similarity: 0.9,
          method: "ai",
          reason: "both describe the same login race",
        },
      ],
      count: 1,
      method: "ai",
      threshold: 0.5,
      candidates_evaluated: 47,
      model: "claude-sonnet-4-6",
    });
    expect(out).toContain("reason: both describe the same login race");
    expect(out).toContain("candidates_evaluated: 47");
    expect(out).toContain("model: claude-sonnet-4-6");
  });

  it("uses plural 'pairs' when count > 1", () => {
    const out = formatDuplicatePairs({
      pairs: [
        {
          issue_a_id: "A",
          issue_b_id: "B",
          issue_a_title: "x",
          issue_b_title: "y",
          similarity: 0.6,
          method: "mechanical",
        },
        {
          issue_a_id: "C",
          issue_b_id: "D",
          issue_a_title: "x",
          issue_b_title: "y",
          similarity: 0.7,
          method: "mechanical",
        },
      ],
      count: 2,
      method: "mechanical",
      threshold: 0.5,
    });
    expect(out).toContain("Found 2 duplicate pairs");
  });
});

describe("formatDuplicateGroups (exact / auto-merge / live merge)", () => {
  function group(o: {
    title: string;
    target: string;
    sources: string[];
    note?: string;
  }) {
    return {
      title: o.title,
      issues: [
        { identifier: o.target, weight: 15, is_merge_target: true },
        ...o.sources.map((id) => ({
          identifier: id,
          weight: 1,
          is_merge_target: false,
        })),
      ],
      suggested_target: o.target,
      suggested_sources: o.sources,
      suggested_action: "close + link",
      note: o.note ?? "",
    };
  }

  it("reports the empty case", () => {
    expect(formatDuplicateGroups({ duplicate_groups: 0, groups: [] })).toBe(
      "No duplicate groups found.\n",
    );
  });

  it("renders one block per group with target + source markers", () => {
    const out = formatDuplicateGroups({
      duplicate_groups: 1,
      groups: [
        group({
          title: "fix login",
          target: "TES-10",
          sources: ["TES-20", "TES-30"],
        }),
      ],
    });
    expect(out).toContain('Group 1: "fix login"');
    expect(out).toContain("▶ target: TES-10 (weight 15)");
    expect(out).toContain(
      "◇ source: TES-20 (weight 1) — close + link as duplicate",
    );
    expect(out).toContain(
      "◇ source: TES-30 (weight 1) — close + link as duplicate",
    );
  });

  it("includes the dry-run merge plan when --auto-merge --dry-run", () => {
    const out = formatDuplicateGroups({
      duplicate_groups: 1,
      groups: [
        group({
          title: "x",
          target: "TES-10",
          sources: ["TES-20"],
        }),
      ],
      merge_commands: ["linear issues mark-duplicate TES-20 --of TES-10"],
      merge_results: [],
      dry_run: true,
    });
    expect(out).toContain("Merge plan (dry-run):");
    expect(out).toContain("  linear issues mark-duplicate TES-20 --of TES-10");
  });

  it("renders live merge results with ✓ / ✗ status per target", () => {
    const out = formatDuplicateGroups({
      duplicate_groups: 1,
      groups: [
        group({
          title: "x",
          target: "TES-10",
          sources: ["TES-20", "TES-30"],
        }),
      ],
      merge_commands: ["..."],
      merge_results: [
        {
          target: "TES-10",
          sources: ["TES-20", "TES-30"],
          closed: ["TES-20", "TES-30"],
          linked: ["TES-20", "TES-30"],
          reparented: ["TES-40"],
          errors: [],
        },
      ],
    });
    expect(out).toContain("Merge commands:");
    expect(out).toContain("Merge results:");
    expect(out).toContain(
      "  ✓ TES-10: closed [TES-20, TES-30], linked [TES-20, TES-30], reparented [TES-40]",
    );
  });

  it("uses ✗ + an indented error line when a merge fails", () => {
    const out = formatDuplicateGroups({
      duplicate_groups: 1,
      groups: [group({ title: "x", target: "TES-10", sources: ["TES-20"] })],
      merge_commands: ["..."],
      merge_results: [
        {
          target: "TES-10",
          sources: ["TES-20"],
          closed: [],
          linked: [],
          reparented: [],
          errors: ["Linear refused state transition"],
        },
      ],
    });
    expect(out).toContain("✗ TES-10");
    expect(out).toContain("error: Linear refused state transition");
  });
});

describe("marked_duplicates section (lin-w3w7)", () => {
  const markedPair = {
    issue_a_id: "TES-1",
    issue_b_id: "TES-2",
    issue_a_title: "Login bug",
    issue_b_title: "Login crash",
    method: "marked" as const,
  };

  it("formatDuplicatePairs renders a 'Marked duplicates' section when present", () => {
    const out = formatDuplicatePairs({
      pairs: [],
      count: 0,
      method: "mechanical",
      threshold: 0.5,
      marked_duplicates: [markedPair],
    });
    expect(out).toContain("No duplicate pairs found");
    expect(out).toContain(
      "Marked duplicates (1) — Linear-native Duplicate relations:",
    );
    expect(out).toContain(
      '⚑ marked  TES-1 "Login bug"  ←→  TES-2 "Login crash"',
    );
  });

  it("formatDuplicateGroups renders the marked section on the empty groups path", () => {
    const out = formatDuplicateGroups({
      duplicate_groups: 0,
      groups: [],
      marked_duplicates: [markedPair],
    });
    expect(out).toContain("No duplicate groups found");
    expect(out).toContain(
      "Marked duplicates (1) — Linear-native Duplicate relations:",
    );
  });

  it("emits no marked section when the array is empty / absent", () => {
    const out = formatDuplicatePairs({
      pairs: [],
      count: 0,
      method: "exact",
      threshold: 0,
      marked_duplicates: [],
    });
    expect(out).not.toContain("Marked duplicates");
  });
});
