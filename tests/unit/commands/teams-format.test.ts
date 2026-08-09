//
// Format tests for the teams suite (list / read / rename-prefix).
//
//   list (empty)     → `No teams found.`
//   list (populated) → `  <key-padded>  <name>` rows + `Total: N teams`
//   read             → header + info row + Cycles line + DESCRIPTION
//   rename-prefix    → action echo with linear-immutable-IDs warning

import { describe, expect, it } from "vitest";
import {
  formatTeamDetail,
  formatTeamList,
  formatTeamRenamePrefix,
} from "../../../src/commands/teams.js";

describe("formatTeamList", () => {
  it("renders the empty-state hint", () => {
    expect(formatTeamList({ nodes: [] })).toBe("No teams found.\n");
  });

  it("renders a row per team with key and name", () => {
    const out = formatTeamList({
      nodes: [
        { id: "t-1", key: "ENG", name: "Engineering" },
        { id: "t-2", key: "OPS", name: "Operations" },
      ],
    });
    expect(out).toContain("  ENG  Engineering\n");
    expect(out).toContain("  OPS  Operations\n");
  });

  it("pads keys to a common column width so names align", () => {
    const out = formatTeamList({
      nodes: [
        { id: "t-1", key: "X", name: "Short" },
        { id: "t-2", key: "VERYLONG", name: "Long" },
      ],
    });
    const lines = out.split("\n").filter((l) => l.startsWith("  "));
    // The position of 'Short' and 'Long' in each row should match.
    const shortPos = lines[0].indexOf("Short");
    const longPos = lines[1].indexOf("Long");
    expect(shortPos).toBe(longPos);
  });

  it("appends `Total: N teams` footer", () => {
    const out = formatTeamList({
      nodes: [
        { id: "t-1", key: "A", name: "A" },
        { id: "t-2", key: "B", name: "B" },
      ],
    });
    expect(out).toContain("\nTotal: 2 teams\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatTeamList({
      nodes: [{ id: "t-1", key: "X", name: "X" }],
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatTeamDetail", () => {
  function makeDetail(
    overrides: Partial<Parameters<typeof formatTeamDetail>[0]> = {},
  ) {
    return {
      id: "t-1",
      key: "ENG",
      name: "Engineering",
      description: "Builds the product",
      private: false,
      timezone: "America/Los_Angeles",
      issueCount: 142,
      cyclesEnabled: true,
      cycleDuration: 2,
      cycleStartDay: 1,
      triageEnabled: false,
      issueEstimationType: "exponential",
      parent: null,
      ...overrides,
    };
  }

  it("renders the header line: key + name", () => {
    const out = formatTeamDetail(makeDetail());
    expect(out.startsWith("ENG  Engineering\n")).toBe(true);
  });

  it("appends [private] suffix on private teams", () => {
    const out = formatTeamDetail(makeDetail({ private: true }));
    expect(out.startsWith("ENG  Engineering [private]\n")).toBe(true);
  });

  it("renders the info row with Issues / Timezone / Estimation", () => {
    const out = formatTeamDetail(makeDetail());
    expect(out).toContain(
      "Issues: 142 · Timezone: America/Los_Angeles · Estimation: exponential\n",
    );
  });

  it("renders `Cycles: enabled (<n> weeks)` when cycles are on", () => {
    const out = formatTeamDetail(makeDetail());
    expect(out).toContain("Cycles: enabled (2 weeks)\n");
  });

  it("renders `Cycles: disabled` when cycles are off", () => {
    const out = formatTeamDetail(makeDetail({ cyclesEnabled: false }));
    expect(out).toContain("Cycles: disabled\n");
  });

  it("renders `Triage: enabled` when triage is on", () => {
    const out = formatTeamDetail(makeDetail({ triageEnabled: true }));
    expect(out).toContain("Triage: enabled\n");
  });

  it("omits Triage line when triage is off (default)", () => {
    expect(formatTeamDetail(makeDetail())).not.toContain("Triage:");
  });

  it("renders Parent: line when team has a parent", () => {
    const out = formatTeamDetail(
      makeDetail({ parent: { key: "PARENT", name: "Parent Team" } }),
    );
    expect(out).toContain("Parent: PARENT (Parent Team)\n");
  });

  it("renders DESCRIPTION block when present", () => {
    const out = formatTeamDetail(makeDetail());
    expect(out).toContain("DESCRIPTION\nBuilds the product\n");
  });

  it("omits DESCRIPTION when empty/null", () => {
    expect(formatTeamDetail(makeDetail({ description: null }))).not.toContain(
      "DESCRIPTION",
    );
    expect(formatTeamDetail(makeDetail({ description: "   " }))).not.toContain(
      "DESCRIPTION",
    );
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatTeamDetail(makeDetail());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatTeamRenamePrefix", () => {
  const base = {
    team_id: "t-1",
    old_key: "ENG",
    new_key: "NEW",
    warning:
      "Existing issue identifiers are immutable; only future issues use NEW.",
  };

  it("renders the `[dry-run]` form when dry_run is true", () => {
    const out = formatTeamRenamePrefix({
      ...base,
      changed: true,
      dry_run: true,
    });
    expect(out).toContain("→ [dry-run] Would rename team prefix: ENG → NEW\n");
    expect(out).toContain(
      "  ⚠ Existing issue identifiers are immutable; only future issues use NEW.\n",
    );
  });

  it("renders the `(no change)` form when key already matches", () => {
    const out = formatTeamRenamePrefix({
      ...base,
      changed: false,
      dry_run: false,
    });
    expect(out).toContain("· Team prefix already NEW (no change)\n");
  });

  it("renders the `✏ Renamed` form when the API mutated", () => {
    const out = formatTeamRenamePrefix({
      ...base,
      changed: true,
      dry_run: false,
    });
    expect(out).toContain("✏ Renamed team prefix: ENG → NEW\n");
    expect(out).toContain("  ⚠ ");
  });

  it("omits warning line when warning is missing", () => {
    const out = formatTeamRenamePrefix({
      team_id: "t-1",
      old_key: "ENG",
      new_key: "NEW",
      changed: true,
      dry_run: false,
    });
    expect(out).not.toContain("⚠");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatTeamRenamePrefix({
      ...base,
      changed: true,
      dry_run: false,
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
