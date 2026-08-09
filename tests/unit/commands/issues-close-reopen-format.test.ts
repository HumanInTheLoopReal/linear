//
// Format tests for `linear issues close` and `linear issues reopen`.
// Mutation echo for these verbs:
//
//   close   → `✓ Closed <id> — <title>: <reason-or-Closed>` per issue
//   reopen  → `↻ Reopened <id>` per issue (no title, no reason)
//
// Both formatters take a small `TransitionRowShape[]` (identifier + title)
// and emit one line per issue + a trailing newline.

import { describe, expect, it } from "vitest";
import {
  formatIssueClose,
  formatIssueReopen,
} from "../../../src/commands/issues.js";

describe("formatIssueClose", () => {
  it("renders one ✓ Closed line per row with the default 'Closed' suffix", () => {
    const out = formatIssueClose([{ identifier: "TES-1", title: "Fix auth" }]);
    expect(out).toBe("✓ Closed TES-1 — Fix auth: Closed\n");
  });

  it("uses the supplied --reason as the suffix when present", () => {
    const out = formatIssueClose(
      [{ identifier: "TES-2", title: "Deploy" }],
      "rolled out today",
    );
    expect(out).toBe("✓ Closed TES-2 — Deploy: rolled out today\n");
  });

  it("renders one line per row in caller order (no resort)", () => {
    const out = formatIssueClose([
      { identifier: "TES-9", title: "z" },
      { identifier: "TES-1", title: "a" },
    ]);
    expect(out.split("\n").slice(0, 2)).toEqual([
      "✓ Closed TES-9 — z: Closed",
      "✓ Closed TES-1 — a: Closed",
    ]);
  });

  it("renders the empty case with leading + trailing blank lines", () => {
    expect(formatIssueClose([])).toBe("\nNo issues closed.\n\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueClose([
      { identifier: "TES-1", title: "x" },
      { identifier: "TES-2", title: "y" },
    ]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatIssueReopen", () => {
  it("renders one ↻ Reopened line per row, with no title or reason suffix", () => {
    const out = formatIssueReopen([{ identifier: "TES-3", title: "ignored" }]);
    expect(out).toBe("↻ Reopened TES-3\n");
  });

  it("renders one line per row in caller order", () => {
    const out = formatIssueReopen([
      { identifier: "TES-5", title: "a" },
      { identifier: "TES-6", title: "b" },
    ]);
    expect(out).toBe("↻ Reopened TES-5\n↻ Reopened TES-6\n");
  });

  it("ignores the row's title", () => {
    // Reopen never echoes the title — defensive assertion in case the
    // implementation accidentally grows a suffix.
    const out = formatIssueReopen([
      { identifier: "TES-7", title: "this title must not appear" },
    ]);
    expect(out).not.toContain("this title");
  });

  it("renders the empty case with leading + trailing blank lines", () => {
    expect(formatIssueReopen([])).toBe("\nNo issues reopened.\n\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueReopen([
      { identifier: "TES-1", title: "x" },
      { identifier: "TES-2", title: "y" },
    ]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
