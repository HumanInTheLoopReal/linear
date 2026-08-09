//
// Format tests for the projects suite (list/read). Linear projects are
// workspace-level. The format is designed to feel consistent with
// `formatIssueList` / `formatIssueDetail`:
//
//   list (empty)    → `No projects found.`
//   list (populated) → per-project row + `Lead/Teams` info row + footer
//   read            → header + Lead/Teams/Members + Health + dates + sections

import { describe, expect, it } from "vitest";
import {
  formatProjectArchive,
  formatProjectCreate,
  formatProjectDelete,
  formatProjectDetail,
  formatProjectList,
  formatProjectUnarchive,
  formatProjectUpdate,
} from "../../../src/commands/projects.js";

function makeRow(
  overrides: Partial<{
    id: string;
    name: string;
    slugId: string | null;
    status: { name: string; type: string } | null;
    progress: number | null;
    lead: { name: string } | null;
    teams: { nodes: { key: string }[] } | null;
  }> = {},
) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Project Alpha",
    slugId: "alpha-1234",
    status: { name: "In Progress", type: "started" },
    progress: 0.42,
    lead: { name: "Alice" },
    teams: { nodes: [{ key: "TES" }, { key: "OPS" }] },
    ...overrides,
  };
}

describe("formatProjectList", () => {
  it("renders the empty-state hint", () => {
    expect(formatProjectList({ nodes: [] })).toBe("No projects found.\n");
  });

  it("renders a row per project with status icon, slug, name, state, progress", () => {
    const out = formatProjectList({ nodes: [makeRow()] });
    expect(out).toContain("◐ alpha-1234  Project Alpha  [In Progress] 42%\n");
  });

  it("renders the indented Lead/Teams info row", () => {
    const out = formatProjectList({ nodes: [makeRow()] });
    expect(out).toContain("  Lead: Alice  ·  Teams: TES, OPS\n");
  });

  it("falls back to (none) when lead is missing and teams are empty", () => {
    const out = formatProjectList({
      nodes: [makeRow({ lead: null, teams: { nodes: [] } })],
    });
    expect(out).toContain("  Lead: (none)  ·  Teams: (none)\n");
  });

  it("drops the progress suffix when progress is null", () => {
    const out = formatProjectList({ nodes: [makeRow({ progress: null })] });
    expect(out).toContain("◐ alpha-1234  Project Alpha  [In Progress]\n");
    expect(out).not.toContain("%");
  });

  it("falls back to the first 8 chars of id when slugId is missing", () => {
    const out = formatProjectList({ nodes: [makeRow({ slugId: null })] });
    expect(out).toContain("◐ 00000000  Project Alpha");
  });

  it("renders the canonical icon for each project status type", () => {
    const cases: Array<[string, string]> = [
      ["backlog", "○"],
      ["planned", "○"],
      ["started", "◐"],
      ["paused", "❄"],
      ["completed", "✓"],
      ["canceled", "✓"],
    ];
    for (const [type, icon] of cases) {
      const out = formatProjectList({
        nodes: [
          makeRow({
            status: { name: "X", type },
            slugId: `slug-${type}`,
          }),
        ],
      });
      expect(out).toContain(`${icon} slug-${type}`);
    }
  });

  it("appends `Total: N projects` footer with a blank line separator", () => {
    const out = formatProjectList({
      nodes: [makeRow({ slugId: "a" }), makeRow({ slugId: "b", name: "Beta" })],
    });
    expect(out).toContain("\nTotal: 2 projects\n");
  });
});

describe("formatProjectDetail", () => {
  function makeDetail(
    overrides: Partial<Parameters<typeof formatProjectDetail>[0]> = {},
  ) {
    return {
      ...makeRow(),
      description: "Short summary",
      content: "Long body content",
      health: "onTrack",
      startDate: "2026-04-01",
      targetDate: "2026-06-30",
      createdAt: "2026-03-15T10:00:00.000Z",
      updatedAt: "2026-05-01T14:30:00.000Z",
      members: { nodes: [{ name: "Alice" }, { name: "Bob" }] },
      projectMilestones: { nodes: [] },
      initiatives: { nodes: [] },
      ...overrides,
    };
  }

  it("renders the header line: icon + slug + name + summary bracket", () => {
    const out = formatProjectDetail(makeDetail());
    expect(
      out.startsWith("◐ alpha-1234 · Project Alpha   [● 42% · In Progress]\n"),
    ).toBe(true);
  });

  it("renders the Lead/Teams/Members info row", () => {
    const out = formatProjectDetail(makeDetail());
    expect(out).toContain("Lead: Alice · Teams: TES, OPS · Members: 2\n");
  });

  it("renders Health when present, omits when null", () => {
    expect(formatProjectDetail(makeDetail())).toContain("Health: onTrack\n");
    expect(formatProjectDetail(makeDetail({ health: null }))).not.toContain(
      "Health:",
    );
  });

  it("renders Start/Target as YYYY-MM-DD when set, (none) for missing", () => {
    const out = formatProjectDetail(makeDetail());
    expect(out).toContain("Start: 2026-04-01 · Target: 2026-06-30\n");
    const out2 = formatProjectDetail(makeDetail({ targetDate: null }));
    expect(out2).toContain("Start: 2026-04-01 · Target: (none)\n");
  });

  it("renders Created/Updated as YYYY-MM-DD (drops time component)", () => {
    const out = formatProjectDetail(makeDetail());
    expect(out).toContain("Created: 2026-03-15 · Updated: 2026-05-01\n");
  });

  it("prefers content over description in the DESCRIPTION block", () => {
    const out = formatProjectDetail(makeDetail());
    expect(out).toContain("DESCRIPTION\nLong body content\n");
    expect(out).not.toContain("Short summary");
  });

  it("falls back to description when content is empty", () => {
    const out = formatProjectDetail(
      makeDetail({ content: null, description: "Just the summary" }),
    );
    expect(out).toContain("DESCRIPTION\nJust the summary\n");
  });

  it("omits DESCRIPTION when both content and description are empty", () => {
    const out = formatProjectDetail(
      makeDetail({ content: null, description: null }),
    );
    expect(out).not.toContain("DESCRIPTION");
  });

  it("renders MILESTONES block with target dates when present", () => {
    const out = formatProjectDetail(
      makeDetail({
        projectMilestones: {
          nodes: [
            { name: "M1", targetDate: "2026-04-15" },
            { name: "M2", targetDate: null },
          ],
        },
      }),
    );
    expect(out).toContain("MILESTONES (2)\n");
    expect(out).toContain("  · M1  → 2026-04-15\n");
    expect(out).toContain("  · M2\n");
  });

  it("renders INITIATIVES block when present", () => {
    const out = formatProjectDetail(
      makeDetail({
        initiatives: { nodes: [{ name: "Q2 Goals" }, { name: "Annual Plan" }] },
      }),
    );
    expect(out).toContain("INITIATIVES (2)\n");
    expect(out).toContain("  · Q2 Goals\n");
    expect(out).toContain("  · Annual Plan\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatProjectDetail(makeDetail());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatProject{Create,Update,Archive,Unarchive,Delete}", () => {
  const fullRow = {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Project Alpha",
    slugId: "alpha-1234",
  };

  it("formatProjectCreate renders `Created project <slug>: <name>`", () => {
    expect(formatProjectCreate(fullRow)).toBe(
      "Created project alpha-1234: Project Alpha\n",
    );
  });

  it("formatProjectUpdate renders `Updated project <slug>: <name>`", () => {
    expect(formatProjectUpdate(fullRow)).toBe(
      "Updated project alpha-1234: Project Alpha\n",
    );
  });

  it("formatProjectArchive renders `Archived project <slug>: <name>`", () => {
    expect(formatProjectArchive(fullRow)).toBe(
      "Archived project alpha-1234: Project Alpha\n",
    );
  });

  it("formatProjectUnarchive renders `Unarchived project <slug>: <name>`", () => {
    expect(formatProjectUnarchive(fullRow)).toBe(
      "Unarchived project alpha-1234: Project Alpha\n",
    );
  });

  it("formatProjectDelete handles the entity-stripped payload (no name)", () => {
    // `projects delete` only returns `{id, success}` after the service
    // strips the entity; the formatter must not crash on missing name/slug.
    expect(formatProjectDelete({ id: fullRow.id })).toBe(
      "Deleted project 00000000: (no name)\n",
    );
  });

  it("falls back to the first 8 chars of id when slugId is missing", () => {
    expect(formatProjectCreate({ id: fullRow.id, name: "X" })).toBe(
      "Created project 00000000: X\n",
    );
  });

  it("all five formatters end with exactly one trailing newline", () => {
    for (const out of [
      formatProjectCreate(fullRow),
      formatProjectUpdate(fullRow),
      formatProjectArchive(fullRow),
      formatProjectUnarchive(fullRow),
      formatProjectDelete(fullRow),
    ]) {
      expect(out.endsWith("\n")).toBe(true);
      expect(out.endsWith("\n\n")).toBe(false);
    }
  });
});
