//
// Format tests for `linear issues lint`. Renders a per-issue block with
// a `⚠ Missing:` line for each required section the issue's description
// is lacking. The header summarises (N issues, M warnings).
//
// Exit-code behavior: text mode exits 1 when warnings exist; --json
// always exits 0. The exit-code is enforced in the action, not the
// formatter, so only the bytes are tested here.

import { describe, expect, it } from "vitest";
import { formatIssueLint } from "../../../src/commands/issues.js";

type Result = {
  identifier: string | null;
  title: string;
  type: string;
  missing: string[];
};

function summary(results: Result[]) {
  const total = results.reduce((n, r) => n + r.missing.length, 0);
  return { total, issues: results.length, results };
}

describe("formatIssueLint", () => {
  it("renders the clean-board case as `✓ No template warnings.`", () => {
    expect(formatIssueLint(summary([]))).toBe("\n✓ No template warnings.\n\n");
  });

  it("emits the header counting issues + warnings", () => {
    const out = formatIssueLint(
      summary([
        {
          identifier: "TES-1",
          title: "x",
          type: "task",
          missing: ["## Acceptance Criteria"],
          empty: [],
        },
        {
          identifier: "TES-2",
          title: "y",
          type: "epic",
          missing: ["## Success Criteria", "## Goal"],
          empty: [],
        },
      ]),
    );
    expect(out.startsWith("Template warnings (2 issues, 3 warnings):\n")).toBe(
      true,
    );
  });

  it("renders one block per issue with id, type bracket, title, then ⚠ Missing rows", () => {
    const out = formatIssueLint(
      summary([
        {
          identifier: "TES-1",
          title: "fix the bug",
          type: "bug",
          missing: ["## Steps to Reproduce", "## Acceptance Criteria"],
          empty: [],
        },
      ]),
    );
    expect(out).toContain("TES-1 [bug]: fix the bug");
    expect(out).toContain("  ⚠ Missing: ## Steps to Reproduce");
    expect(out).toContain("  ⚠ Missing: ## Acceptance Criteria");
  });

  it("separates per-issue blocks with one blank line", () => {
    const out = formatIssueLint(
      summary([
        {
          identifier: "TES-1",
          title: "a",
          type: "task",
          missing: ["## Acceptance Criteria"],
          empty: [],
        },
        {
          identifier: "TES-2",
          title: "b",
          type: "task",
          missing: ["## Acceptance Criteria"],
          empty: [],
        },
      ]),
    );
    const lines = out.split("\n");
    const bIdx = lines.findIndex((l) => l.includes("TES-2"));
    // 0: header, 1: blank, 2: TES-1 row, 3: ⚠ row, 4: blank, 5: TES-2 row
    expect(lines[bIdx - 1]).toBe("");
  });

  it("falls back to '(no-id)' when identifier is null (defensive)", () => {
    const out = formatIssueLint(
      summary([
        {
          identifier: null,
          title: "ghost",
          type: "task",
          missing: ["## Acceptance Criteria"],
          empty: [],
        },
      ]),
    );
    expect(out).toContain("(no-id) [task]: ghost");
  });

  it("ends with exactly one trailing newline (no doubled blank)", () => {
    const out = formatIssueLint(
      summary([
        {
          identifier: "TES-1",
          title: "x",
          type: "task",
          missing: ["## Acceptance Criteria"],
          empty: [],
        },
      ]),
    );
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
