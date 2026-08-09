//
// Format tests for the human suite (list / respond / dismiss / stats).
// Human is a Linear-Hack: any issue carrying the `human` label is in the
// human-decision queue. Format is a per-entry block.
//
//   list (empty)     → `No human-flagged issues found.`
//   list (populated) → `! <id>  <title>` + indented Status/Updated line per entry
//                     + `Total: N (P pending, R responded, D dismissed)`
//   respond          → `✓ Responded to <id>[ → <state>][ (commented)]`
//   dismiss          → `· Dismissed <id>[ → <state>][ (commented)]`
//   stats            → aligned 4-row summary block

import { describe, expect, it } from "vitest";
import {
  formatHumanDismiss,
  formatHumanList,
  formatHumanRespond,
  formatHumanStats,
} from "../../../src/commands/human.js";

describe("formatHumanList", () => {
  it("renders the empty-state hint", () => {
    expect(formatHumanList([])).toBe("No human-flagged issues found.\n");
  });

  it("renders the per-issue 2-line block", () => {
    const out = formatHumanList([
      {
        identifier: "ENG-42",
        title: "Should we ship the migration on Friday?",
        status: "Backlog",
        status_type: "backlog",
        updated_at: "2026-05-16T12:00:00.000Z",
      },
    ]);
    expect(out).toContain(
      "! ENG-42  Should we ship the migration on Friday?\n",
    );
    expect(out).toContain(
      "    Status: pending  [Backlog]  · Updated: 2026-05-16\n",
    );
  });

  it("maps completed to responded and canceled/duplicate to dismissed", () => {
    const out = formatHumanList([
      {
        identifier: "ENG-1",
        title: "Done",
        status: "Done",
        status_type: "completed",
        updated_at: "2026-05-01",
      },
      {
        identifier: "ENG-2",
        title: "Cancelled",
        status: "Cancelled",
        status_type: "canceled",
        updated_at: "2026-05-02",
      },
      {
        identifier: "ENG-3",
        title: "Duplicate",
        status: "Duplicate",
        status_type: "duplicate",
        updated_at: "2026-05-03",
      },
      {
        identifier: "ENG-4",
        title: "Open",
        status: "Backlog",
        status_type: "backlog",
        updated_at: "2026-05-04",
      },
    ]);
    expect(out).toContain("Status: responded  [Done]");
    expect(out).toContain("Status: dismissed  [Cancelled]");
    expect(out).toContain("Status: dismissed  [Duplicate]");
    expect(out).toContain("Status: pending  [Backlog]");
  });

  it("appends the `Total: N (...)` footer with per-bucket counts", () => {
    const out = formatHumanList([
      {
        identifier: "ENG-1",
        title: "x",
        status: "Done",
        status_type: "completed",
        updated_at: "2026-05-01",
      },
      {
        identifier: "ENG-2",
        title: "y",
        status: "Cancelled",
        status_type: "canceled",
        updated_at: "2026-05-02",
      },
      {
        identifier: "ENG-3",
        title: "z",
        status: "Backlog",
        status_type: "backlog",
        updated_at: "2026-05-03",
      },
    ]);
    expect(out).toContain("\nTotal: 3 (1 pending, 1 responded, 1 dismissed)\n");
  });

  it("falls back to (unknown) for missing updated_at", () => {
    const out = formatHumanList([
      {
        identifier: "ENG-1",
        title: "x",
        status: "Backlog",
        status_type: "backlog",
        updated_at: "",
      },
    ]);
    expect(out).toContain("Updated: (unknown)");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatHumanList([
      {
        identifier: "ENG-1",
        title: "x",
        status: "Backlog",
        status_type: "backlog",
        updated_at: "2026-05-01",
      },
    ]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatHumanRespond", () => {
  it("renders `✓ Responded to <id>` when no state_name/comment", () => {
    expect(
      formatHumanRespond({
        issue: { identifier: "ENG-1" },
        action: "responded",
        had_human_label: true,
        comment_id: null,
      }),
    ).toBe("✓ Responded to ENG-1\n");
  });

  it("appends ` → <state>` when state_name is present", () => {
    expect(
      formatHumanRespond({
        issue: { identifier: "ENG-1" },
        action: "responded",
        had_human_label: true,
        comment_id: null,
        state_name: "Done",
      }),
    ).toBe("✓ Responded to ENG-1 → Done\n");
  });

  it("appends ` (commented)` when comment_id is present", () => {
    expect(
      formatHumanRespond({
        issue: { identifier: "ENG-1" },
        action: "responded",
        had_human_label: true,
        comment_id: "c-1",
        state_name: "Done",
      }),
    ).toBe("✓ Responded to ENG-1 → Done (commented)\n");
  });

  it("appends the missing-label warning line when had_human_label is false", () => {
    const out = formatHumanRespond({
      issue: { identifier: "ENG-1" },
      action: "responded",
      had_human_label: false,
      comment_id: "c-1",
      state_name: "Done",
    });
    expect(out).toContain("  ⚠ ENG-1 did not carry the 'human' label\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatHumanRespond({
      issue: { identifier: "ENG-1" },
      action: "responded",
      had_human_label: true,
      comment_id: null,
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatHumanDismiss", () => {
  it("renders `· Dismissed <id>` (no state, no comment)", () => {
    expect(
      formatHumanDismiss({
        issue: { identifier: "ENG-1" },
        action: "dismissed",
        had_human_label: true,
        comment_id: null,
      }),
    ).toBe("· Dismissed ENG-1\n");
  });

  it("renders `· Dismissed <id> → <state>` when state_name is present", () => {
    expect(
      formatHumanDismiss({
        issue: { identifier: "ENG-1" },
        action: "dismissed",
        had_human_label: true,
        comment_id: null,
        state_name: "Cancelled",
      }),
    ).toBe("· Dismissed ENG-1 → Cancelled\n");
  });

  it("renders ` (commented)` when a reason comment was posted", () => {
    expect(
      formatHumanDismiss({
        issue: { identifier: "ENG-1" },
        action: "dismissed",
        had_human_label: true,
        comment_id: "c-1",
        state_name: "Cancelled",
      }),
    ).toBe("· Dismissed ENG-1 → Cancelled (commented)\n");
  });

  it("appends the missing-label warning when had_human_label is false", () => {
    const out = formatHumanDismiss({
      issue: { identifier: "ENG-1" },
      action: "dismissed",
      had_human_label: false,
      comment_id: null,
    });
    expect(out).toContain("  ⚠ ENG-1 did not carry the 'human' label\n");
  });
});

describe("formatHumanStats", () => {
  it("renders the aligned 4-row summary block", () => {
    const out = formatHumanStats({
      total: 5,
      pending: 2,
      responded: 2,
      dismissed: 1,
    });
    expect(out).toBe(
      "Human queue:\n  Total:      5\n  Pending:    2\n  Responded:  2\n  Dismissed:  1\n",
    );
  });

  it("handles all-zero queue", () => {
    const out = formatHumanStats({
      total: 0,
      pending: 0,
      responded: 0,
      dismissed: 0,
    });
    expect(out).toContain("Human queue:\n");
    expect(out).toContain("  Total:      0\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatHumanStats({
      total: 1,
      pending: 1,
      responded: 0,
      dismissed: 0,
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
