//
// Format tests for `linear depends cycles`. The fixture mirrors the
// `GraphIssue[][]` shape `detectCyclesWithIssues` returns: an array
// of cycles, where each cycle is an ordered list of issues.

import { describe, expect, it } from "vitest";
import { formatDepCycles } from "../../../src/commands/depends.js";
import type { GraphIssue } from "../../../src/services/dependency-graph-service.js";

function issue(overrides: Partial<GraphIssue> = {}): GraphIssue {
  return {
    id: "u-1",
    identifier: "TES-1",
    title: "issue",
    priority: 2,
    status: "backlog",
    state_name: "Backlog",
    team: { id: "team-1", key: "TES", name: "TEST" },
    ...overrides,
  };
}

describe("formatDepCycles", () => {
  it("renders the clean-board case with a leading blank line and ✓ banner", () => {
    expect(formatDepCycles([])).toBe("\n✓ No dependency cycles detected\n\n");
  });

  it("ends with `\\n\\n` in the empty case (one terminating newline + blank)", () => {
    const out = formatDepCycles([]);
    expect(out.endsWith("\n\n")).toBe(true);
    expect(out.endsWith("\n\n\n")).toBe(false);
  });

  it("renders a single cycle as `<n> ids in a loop`, repeating the first id at the end", () => {
    const out = formatDepCycles([
      [
        issue({ identifier: "TES-1" }),
        issue({ identifier: "TES-2" }),
        issue({ identifier: "TES-3" }),
      ],
    ]);
    expect(out).toBe(
      [
        "",
        "🔁 Dependency cycles detected (1):",
        "",
        "  [3] TES-1 → TES-2 → TES-3 → TES-1",
        "",
        "",
      ].join("\n"),
    );
  });

  it("brackets the cycle size matching the input length (not including the closing repeat)", () => {
    const out = formatDepCycles([
      [issue({ identifier: "TES-1" }), issue({ identifier: "TES-2" })],
    ]);
    expect(out).toContain("[2] TES-1 → TES-2 → TES-1");
  });

  it("renders multiple cycles as separate rows after one header", () => {
    const out = formatDepCycles([
      [issue({ identifier: "TES-1" }), issue({ identifier: "TES-2" })],
      [issue({ identifier: "TES-9" }), issue({ identifier: "TES-7" })],
    ]);
    expect(out).toContain("🔁 Dependency cycles detected (2):");
    expect(out).toContain("  [2] TES-1 → TES-2 → TES-1");
    expect(out).toContain("  [2] TES-9 → TES-7 → TES-9");
  });

  it("skips empty cycle entries defensively (should never happen but is harmless)", () => {
    const out = formatDepCycles([
      [],
      [issue({ identifier: "TES-1" }), issue({ identifier: "TES-2" })],
    ]);
    expect(out).toContain("(2):");
    expect(out).toContain("[2] TES-1 → TES-2 → TES-1");
  });
});
