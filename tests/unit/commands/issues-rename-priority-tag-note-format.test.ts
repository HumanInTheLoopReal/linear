//
// Format tests for the four single-issue mutation echoes:
//
//   rename    → `✏ Renamed <id> — <title>` (Linear identifiers are
//               immutable, so rename targets the title — pencil icon
//               distinguishes this from the standard ✓ confirmation)
//   priority  → `✓ Set priority of <id> — <title> to P<n>`
//   tag       → `✓ Added label "<label>" to <id> — <title>`
//   note      → `✓ Note added to <id> — <title>`
//
// All four formatters take a `TransitionRowShape` ({ identifier, title })
// plus, for priority/tag, an extra scalar. None of them have an empty case
// — these are single-issue verbs in the CLI, so the row always exists.

import { describe, expect, it } from "vitest";
import {
  formatIssueNote,
  formatIssuePriority,
  formatIssueRename,
  formatIssueTag,
} from "../../../src/commands/issues.js";

describe("formatIssueRename", () => {
  it("renders a single ✏ Renamed line with the new title", () => {
    const out = formatIssueRename({ identifier: "TES-1", title: "new title" });
    expect(out).toBe("✏ Renamed TES-1 — new title\n");
  });

  it("uses the pencil icon (not ✓) to distinguish rename from other mutations", () => {
    const out = formatIssueRename({ identifier: "TES-2", title: "x" });
    expect(out.startsWith("✏")).toBe(true);
    expect(out.startsWith("✓")).toBe(false);
  });

  it("preserves whitespace and special characters in the title verbatim", () => {
    const out = formatIssueRename({
      identifier: "TES-3",
      title: "  weird:title — with em-dash  ",
    });
    expect(out).toBe("✏ Renamed TES-3 —   weird:title — with em-dash  \n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueRename({ identifier: "TES-4", title: "y" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatIssuePriority", () => {
  it("renders `Set priority of <id> — <title> to P<n>` for P1", () => {
    const out = formatIssuePriority(
      { identifier: "TES-1", title: "Fix auth" },
      1,
    );
    expect(out).toBe("✓ Set priority of TES-1 — Fix auth to P1\n");
  });

  it("renders the same shape for P2, P3, P4", () => {
    for (const n of [2, 3, 4]) {
      const out = formatIssuePriority(
        { identifier: `TES-${n}`, title: "x" },
        n,
      );
      expect(out).toBe(`✓ Set priority of TES-${n} — x to P${n}\n`);
    }
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssuePriority({ identifier: "TES-7", title: "z" }, 2);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatIssueTag", () => {
  it('renders `Added label "<label>" to <id> — <title>`', () => {
    const out = formatIssueTag(
      { identifier: "TES-1", title: "Deploy" },
      "frontend",
    );
    expect(out).toBe('✓ Added label "frontend" to TES-1 — Deploy\n');
  });

  it("wraps the label in straight ASCII double quotes (not smart quotes)", () => {
    const out = formatIssueTag({ identifier: "TES-2", title: "x" }, "backend");
    expect(out).toContain('"backend"');
    expect(out).not.toContain("“backend”");
  });

  it("preserves label strings with spaces or special characters", () => {
    const out = formatIssueTag({ identifier: "TES-3", title: "y" }, "type:bug");
    expect(out).toBe('✓ Added label "type:bug" to TES-3 — y\n');
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueTag({ identifier: "TES-4", title: "z" }, "x");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatIssueNote", () => {
  it("renders `Note added to <id> — <title>` (no note body in the echo)", () => {
    const out = formatIssueNote({ identifier: "TES-1", title: "Deploy" });
    expect(out).toBe("✓ Note added to TES-1 — Deploy\n");
  });

  it("never includes note text in the echo (only confirms add)", () => {
    // The note body could contain anything — secrets, large text, etc.
    // The confirmation deliberately doesn't echo it back. Defensive
    // assertion in case the formatter signature ever grows a text parameter.
    const out = formatIssueNote({ identifier: "TES-2", title: "x" });
    expect(out.length).toBeLessThan(80);
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueNote({ identifier: "TES-3", title: "y" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
