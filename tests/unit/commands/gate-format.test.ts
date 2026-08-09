//
// Format tests for the gate suite (list / check / resolve).
// Gate is a Linear-Hack: gate issues are normal Linear issues with the
// gate label (see GATE_LABEL_NAME in src/services/gate-service.ts).
//
//   list (empty)     → `No gates found.`
//   list (populated) → `<icon> <id-padded>  <await-type>[  →  <await-id>]  [state]`
//   check            → header summary + per-gate outcome lines
//   resolve          → `✓ Resolved gate <id> → <state>[ (commented)]`

import { describe, expect, it } from "vitest";
import {
  formatGateCheck,
  formatGateList,
  formatGateResolve,
} from "../../../src/commands/gate.js";

describe("formatGateList", () => {
  it("renders the empty-state hint", () => {
    expect(formatGateList([])).toBe("No gates found.\n");
  });

  it("renders a row per gate with icon, id, await type/id, and state", () => {
    const out = formatGateList([
      {
        id: "g-1",
        identifier: "ENG-1",
        title: "Gate: ci",
        status: "backlog",
        state_name: "Backlog",
        await_type: "gh:run",
        await_id: "12345",
      },
    ]);
    expect(out).toContain("○ ENG-1  gh:run  →  12345  [Backlog]\n");
  });

  it("maps started to ◐ and every terminal type to ✓", () => {
    const out = formatGateList([
      {
        id: "g-1",
        identifier: "ENG-1",
        title: "x",
        status: "started",
        state_name: "In Progress",
        await_type: null,
        await_id: null,
      },
      {
        id: "g-2",
        identifier: "ENG-2",
        title: "y",
        status: "completed",
        state_name: "Done",
        await_type: null,
        await_id: null,
      },
      {
        id: "g-3",
        identifier: "ENG-3",
        title: "z",
        status: "canceled",
        state_name: "Cancelled",
        await_type: null,
        await_id: null,
      },
      {
        id: "g-4",
        identifier: "ENG-4",
        title: "duplicate",
        status: "duplicate",
        state_name: "Duplicate",
        await_type: null,
        await_id: null,
      },
    ]);
    expect(out).toContain("◐ ENG-1");
    expect(out).toContain("✓ ENG-2");
    expect(out).toContain("✓ ENG-3");
    expect(out).toContain("✓ ENG-4");
  });

  it("falls back to (no type) when await_type is missing", () => {
    const out = formatGateList([
      {
        id: "g-1",
        identifier: "ENG-1",
        title: "x",
        status: "backlog",
        state_name: "Backlog",
        await_type: null,
        await_id: null,
      },
    ]);
    expect(out).toContain("(no type)");
    expect(out).not.toContain("  →  ");
  });

  it("falls back to status when state_name is empty", () => {
    const out = formatGateList([
      {
        id: "g-1",
        identifier: "ENG-1",
        title: "x",
        status: "backlog",
        state_name: "",
        await_type: "timer",
        await_id: null,
      },
    ]);
    expect(out).toContain("[backlog]");
  });

  it("pads identifier column so await-types align", () => {
    const out = formatGateList([
      {
        id: "g-1",
        identifier: "X-1",
        title: "x",
        status: "backlog",
        state_name: "Backlog",
        await_type: "gh:run",
        await_id: null,
      },
      {
        id: "g-2",
        identifier: "LONGTEAM-12345",
        title: "y",
        status: "backlog",
        state_name: "Backlog",
        await_type: "gh:run",
        await_id: null,
      },
    ]);
    const lines = out.split("\n").filter((l) => l.includes("gh:run"));
    const pos1 = lines[0].indexOf("gh:run");
    const pos2 = lines[1].indexOf("gh:run");
    expect(pos1).toBe(pos2);
  });

  it("appends `Total: N gates` footer", () => {
    const out = formatGateList([
      {
        id: "g-1",
        identifier: "ENG-1",
        title: "x",
        status: "backlog",
        state_name: "Backlog",
        await_type: "gh:run",
        await_id: null,
      },
      {
        id: "g-2",
        identifier: "ENG-2",
        title: "y",
        status: "backlog",
        state_name: "Backlog",
        await_type: "gh:pr",
        await_id: null,
      },
    ]);
    expect(out).toContain("\nTotal: 2 gates\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatGateList([
      {
        id: "g-1",
        identifier: "ENG-1",
        title: "x",
        status: "backlog",
        state_name: "Backlog",
        await_type: "gh:run",
        await_id: null,
      },
    ]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatGateCheck", () => {
  it("renders the header summary line", () => {
    const out = formatGateCheck({
      checked: 3,
      resolved: 1,
      escalated: 0,
      pending: 2,
      skipped: 0,
      errors: 0,
      dry_run: false,
      results: [],
    });
    expect(out).toContain(
      "Gate check: 3 checked, 1 resolved, 0 escalated, 2 pending, 0 skipped\n",
    );
  });

  it("appends ` (dry-run)` to the header when dry_run is true", () => {
    const out = formatGateCheck({
      checked: 0,
      resolved: 0,
      escalated: 0,
      pending: 0,
      skipped: 0,
      errors: 0,
      dry_run: true,
      results: [],
    });
    expect(out).toContain("0 skipped (dry-run)\n");
  });

  it("emits `(N errors)` line when errors > 0", () => {
    const out = formatGateCheck({
      checked: 1,
      resolved: 0,
      escalated: 0,
      pending: 0,
      skipped: 0,
      errors: 1,
      dry_run: false,
      results: [],
    });
    expect(out).toContain("  (1 errors)\n");
  });

  it("omits the errors line when errors == 0", () => {
    const out = formatGateCheck({
      checked: 1,
      resolved: 1,
      escalated: 0,
      pending: 0,
      skipped: 0,
      errors: 0,
      dry_run: false,
      results: [],
    });
    expect(out).not.toContain("errors)");
  });

  it("renders a per-result line for each outcome with the right icon", () => {
    const out = formatGateCheck({
      checked: 4,
      resolved: 1,
      escalated: 1,
      pending: 1,
      skipped: 1,
      errors: 0,
      dry_run: false,
      results: [
        {
          identifier: "ENG-1",
          await_type: "gh:run",
          outcome: "resolved",
          reason: "workflow ci succeeded",
          closed: true,
        },
        {
          identifier: "ENG-2",
          await_type: "gh:pr",
          outcome: "escalated",
          reason: "pr was closed",
          closed: false,
        },
        {
          identifier: "ENG-3",
          await_type: "timer",
          outcome: "pending",
          reason: "still waiting",
          closed: false,
        },
        {
          identifier: "ENG-4",
          await_type: null,
          outcome: "skipped",
          reason: "no await_type",
          closed: false,
        },
      ],
    });
    expect(out).toContain("✓ ENG-1  [resolved]  workflow ci succeeded\n");
    expect(out).toContain("⚠ ENG-2  [escalated]  pr was closed (not closed)\n");
    expect(out).toContain("◐ ENG-3  [pending]  still waiting (not closed)\n");
    expect(out).toContain("· ENG-4  [skipped]  no await_type (not closed)\n");
  });

  it("renders ` (not closed)` suffix when result.closed is false", () => {
    const out = formatGateCheck({
      checked: 1,
      resolved: 0,
      escalated: 0,
      pending: 1,
      skipped: 0,
      errors: 0,
      dry_run: false,
      results: [
        {
          identifier: "ENG-1",
          await_type: "timer",
          outcome: "pending",
          reason: "still ticking",
          closed: false,
        },
      ],
    });
    expect(out).toContain(" (not closed)");
  });

  it("renders `⚠ <error>` line when a result has an error", () => {
    const out = formatGateCheck({
      checked: 1,
      resolved: 0,
      escalated: 1,
      pending: 0,
      skipped: 0,
      errors: 1,
      dry_run: false,
      results: [
        {
          identifier: "ENG-1",
          await_type: "gh:run",
          outcome: "escalated",
          reason: "gh CLI failed",
          closed: false,
          error: "gh: command not found",
        },
      ],
    });
    expect(out).toContain("  ⚠ gh: command not found\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatGateCheck({
      checked: 0,
      resolved: 0,
      escalated: 0,
      pending: 0,
      skipped: 0,
      errors: 0,
      dry_run: false,
      results: [],
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatGateResolve", () => {
  it("renders `✓ Resolved gate <id> → <state>`", () => {
    expect(
      formatGateResolve({
        identifier: "ENG-1",
        state_name: "Done",
      }),
    ).toBe("✓ Resolved gate ENG-1 → Done\n");
  });

  it("appends ` (commented)` when a comment was posted", () => {
    expect(
      formatGateResolve({
        identifier: "ENG-1",
        state_name: "Done",
        comment_id: "c-123",
      }),
    ).toBe("✓ Resolved gate ENG-1 → Done (commented)\n");
  });

  it("omits the comment suffix when comment_id is null", () => {
    expect(
      formatGateResolve({
        identifier: "ENG-1",
        state_name: "Done",
        comment_id: null,
      }),
    ).toBe("✓ Resolved gate ENG-1 → Done\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatGateResolve({
      identifier: "ENG-1",
      state_name: "Done",
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
