//
// Byte-exact format tests for `linear blocked`. The fixtures match the
// `BlockedIssue` shape returned by `listBlockedIssues`.

import { describe, expect, it } from "vitest";
import { formatBlocked } from "../../../src/commands/blocked.js";
import type { BlockedIssue } from "../../../src/services/blocked-service.js";

function fixture(overrides: Partial<BlockedIssue> = {}): BlockedIssue {
  return {
    id: "uuid-1",
    identifier: "TES-1",
    title: "title",
    priority: 2,
    status: "backlog",
    state_name: "Backlog",
    blocked_by: ["TES-9"],
    blocked_by_details: [
      { identifier: "TES-9", title: "Blocker TES-9", status: "started" },
    ],
    blocked_by_count: 1,
    team: { id: "team-uuid", key: "TES", name: "TEST" },
    ...overrides,
  };
}

describe("formatBlocked", () => {
  it("emits a celebratory empty-state banner with leading + trailing blank lines", () => {
    expect(formatBlocked([])).toBe("\n✨ No blocked issues\n\n");
  });

  it("renders the blocked header + per-issue block + dep list", () => {
    expect(formatBlocked([fixture()])).toBe(
      [
        "",
        "🚫 Blocked issues (1):",
        "",
        "[● P2] TES-1: title",
        "  Blocked by 1 open dependencies: [TES-9]",
        "",
      ].join("\n"),
    );
  });

  it("drops the P-token from the bracket when priority is 0", () => {
    const out = formatBlocked([fixture({ priority: 0 })]);
    expect(out).toContain("[●] TES-1: title");
    expect(out).not.toContain("[● P0]");
  });

  it("joins multiple blocker identifiers comma-separated inside brackets", () => {
    const out = formatBlocked([
      fixture({
        blocked_by: ["TES-9", "TES-10", "TES-11"],
        blocked_by_count: 3,
      }),
    ]);
    expect(out).toContain(
      "  Blocked by 3 open dependencies: [TES-9, TES-10, TES-11]",
    );
  });

  it("emits one block per issue in the order the caller provided", () => {
    const out = formatBlocked([
      fixture({ identifier: "TES-2", title: "first" }),
      fixture({ identifier: "TES-1", title: "second", priority: 1 }),
    ]);
    const lines = out.split("\n");
    expect(lines).toEqual([
      "",
      "🚫 Blocked issues (2):",
      "",
      "[● P2] TES-2: first",
      "  Blocked by 1 open dependencies: [TES-9]",
      "[● P1] TES-1: second",
      "  Blocked by 1 open dependencies: [TES-9]",
      "",
    ]);
  });

  it("emits exactly one trailing newline", () => {
    const out = formatBlocked([fixture()]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
