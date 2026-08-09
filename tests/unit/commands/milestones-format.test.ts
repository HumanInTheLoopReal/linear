//
// Format tests for the milestones suite (list / read / create / update).
// Format is designed to be consistent with `formatProjectList` /
// `formatProjectDetail`.
//
//   list (empty)     → `No milestones found.`
//   list (populated) → `  · <name>[  → YYYY-MM-DD]` rows + Total footer
//   read             → header (name [Target: YYYY-MM-DD]) + project + dates
//                      + DESCRIPTION + ISSUES sections
//   create / update  → `<Verb> milestone <name>[ in <project>]`

import { describe, expect, it } from "vitest";
import {
  formatMilestoneCreate,
  formatMilestoneDetail,
  formatMilestoneList,
  formatMilestoneUpdate,
} from "../../../src/commands/milestones.js";

describe("formatMilestoneList", () => {
  it("renders the empty-state hint", () => {
    expect(formatMilestoneList({ nodes: [] })).toBe("No milestones found.\n");
  });

  it("renders a row per milestone with target date when set", () => {
    const out = formatMilestoneList({
      nodes: [
        { id: "m-1", name: "M1", targetDate: "2026-04-15" },
        { id: "m-2", name: "M2", targetDate: null },
      ],
    });
    expect(out).toContain("  · M1  → 2026-04-15\n");
    expect(out).toContain("  · M2\n");
    expect(out).not.toContain("M2  →");
  });

  it("appends the `Total: N milestones` footer with a blank-line separator", () => {
    const out = formatMilestoneList({
      nodes: [
        { id: "m-1", name: "A" },
        { id: "m-2", name: "B" },
        { id: "m-3", name: "C" },
      ],
    });
    expect(out).toContain("\nTotal: 3 milestones\n");
  });

  it("slices ISO timestamps to YYYY-MM-DD", () => {
    const out = formatMilestoneList({
      nodes: [
        {
          id: "m-1",
          name: "M",
          targetDate: "2026-04-15T00:00:00.000Z",
        },
      ],
    });
    expect(out).toContain("  · M  → 2026-04-15\n");
    expect(out).not.toContain("T00");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatMilestoneList({
      nodes: [{ id: "m-1", name: "M" }],
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatMilestoneDetail", () => {
  function makeDetail(
    overrides: Partial<Parameters<typeof formatMilestoneDetail>[0]> = {},
  ) {
    return {
      id: "m-uuid-1",
      name: "M1",
      targetDate: "2026-04-15",
      description: "Phase one cutover",
      createdAt: "2026-03-15T10:00:00.000Z",
      updatedAt: "2026-04-01T12:00:00.000Z",
      project: { id: "p-uuid-1", name: "Project Alpha" },
      issues: { nodes: [] },
      ...overrides,
    };
  }

  it("renders the header line with name and target", () => {
    const out = formatMilestoneDetail(makeDetail());
    expect(out.startsWith("M1   [Target: 2026-04-15]\n")).toBe(true);
  });

  it("omits the target bracket when no target date", () => {
    const out = formatMilestoneDetail(makeDetail({ targetDate: null }));
    expect(out.startsWith("M1\n")).toBe(true);
    expect(out).not.toContain("[Target:");
  });

  it("renders the Project: line", () => {
    const out = formatMilestoneDetail(makeDetail());
    expect(out).toContain("Project: Project Alpha\n");
  });

  it("falls back to `(none)` when project is null", () => {
    const out = formatMilestoneDetail(makeDetail({ project: null }));
    expect(out).toContain("Project: (none)\n");
  });

  it("renders Created/Updated as YYYY-MM-DD", () => {
    const out = formatMilestoneDetail(makeDetail());
    expect(out).toContain("Created: 2026-03-15 · Updated: 2026-04-01\n");
  });

  it("renders the DESCRIPTION block when present", () => {
    const out = formatMilestoneDetail(makeDetail());
    expect(out).toContain("DESCRIPTION\nPhase one cutover\n");
  });

  it("omits the DESCRIPTION block when description is empty/null", () => {
    expect(
      formatMilestoneDetail(makeDetail({ description: null })),
    ).not.toContain("DESCRIPTION");
    expect(
      formatMilestoneDetail(makeDetail({ description: "   " })),
    ).not.toContain("DESCRIPTION");
  });

  it("renders the ISSUES block with identifier + title when present", () => {
    const out = formatMilestoneDetail(
      makeDetail({
        issues: {
          nodes: [
            { identifier: "TES-1", title: "First task" },
            { identifier: "TES-2", title: "Second task" },
          ],
        },
      }),
    );
    expect(out).toContain("ISSUES (2)\n");
    expect(out).toContain("  · TES-1  First task\n");
    expect(out).toContain("  · TES-2  Second task\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatMilestoneDetail(makeDetail());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatMilestoneCreate / formatMilestoneUpdate", () => {
  const row = {
    id: "m-uuid-1",
    name: "M1",
    project: { name: "Project Alpha" },
  };

  it("formatMilestoneCreate renders `Created milestone <name> in <project>`", () => {
    expect(formatMilestoneCreate(row)).toBe(
      "Created milestone M1 in Project Alpha\n",
    );
  });

  it("formatMilestoneUpdate renders `Updated milestone <name> in <project>`", () => {
    expect(formatMilestoneUpdate(row)).toBe(
      "Updated milestone M1 in Project Alpha\n",
    );
  });

  it("omits ` in <project>` suffix when project is missing", () => {
    expect(
      formatMilestoneCreate({ id: "m-1", name: "M1", project: null }),
    ).toBe("Created milestone M1\n");
    expect(formatMilestoneUpdate({ id: "m-1", name: "M1" })).toBe(
      "Updated milestone M1\n",
    );
  });

  it("falls back to (no name) when name is missing", () => {
    expect(
      formatMilestoneCreate({
        id: "m-1",
        project: { name: "Project Alpha" },
      }),
    ).toBe("Created milestone (no name) in Project Alpha\n");
  });

  it("both formatters end with exactly one trailing newline", () => {
    for (const out of [
      formatMilestoneCreate(row),
      formatMilestoneUpdate(row),
    ]) {
      expect(out.endsWith("\n")).toBe(true);
      expect(out.endsWith("\n\n")).toBe(false);
    }
  });
});
