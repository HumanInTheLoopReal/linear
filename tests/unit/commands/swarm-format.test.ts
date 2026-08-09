//
// Format tests for the swarm suite (create / validate / status / list).
// Swarm is a Linear-Hack: a swarm "molecule" is a Linear issue with the
// `swarm` label, linked to its epic via a `related` relation.
//
//   create (ok)        → `✓ Created swarm <id> for epic <epic-id>` + analysis
//   create (existing)  → `✗ Swarm already exists: <id> (<title>)`
//   create (no-swarm)  → `✗ Epic <id> is not swarmable` + per-error/-warning
//   validate (ok)      → `✓ Epic <id> is swarmable: N issues, M waves, max parallelism K`
//   validate (no)      → `✗ Epic <id> is not swarmable` + per-error/-warning
//   status             → header + Progress line + per-category sections
//   list               → `📋 Swarms (N):` + per-swarm rows

import { describe, expect, it } from "vitest";
import {
  formatSwarmCreate,
  formatSwarmList,
  formatSwarmStatus,
  formatSwarmValidate,
} from "../../../src/commands/swarm.js";

function makeAnalysis(
  overrides: Partial<Parameters<typeof formatSwarmValidate>[0]> = {},
) {
  return {
    epic_id: "epic-1",
    epic_identifier: "ENG-1",
    epic_title: "Foo epic",
    total_issues: 6,
    closed_issues: 2,
    max_parallelism: 3,
    estimated_sessions: 2,
    warnings: [],
    errors: [],
    swarmable: true,
    ready_fronts: [
      { wave: 0, issues: ["ENG-2", "ENG-3"] },
      { wave: 1, issues: ["ENG-4"] },
    ],
    ...overrides,
  };
}

describe("formatSwarmCreate", () => {
  it("renders the happy-path 2-line block", () => {
    const out = formatSwarmCreate({
      swarm_id: "swarm-1",
      swarm_identifier: "ENG-50",
      epic_id: "epic-1",
      epic_identifier: "ENG-1",
      coordinator: "",
      analysis: makeAnalysis(),
    });
    expect(out).toContain("✓ Created swarm ENG-50 for epic ENG-1\n");
    expect(out).toContain("  6 issues · 2 waves · max parallelism 3\n");
  });

  it("appends coordinator line when present", () => {
    const out = formatSwarmCreate({
      swarm_id: "swarm-1",
      swarm_identifier: "ENG-50",
      epic_id: "epic-1",
      epic_identifier: "ENG-1",
      coordinator: "agent://alice",
      analysis: makeAnalysis(),
    });
    expect(out).toContain("  coordinator: agent://alice\n");
  });

  it("omits coordinator line when empty", () => {
    const out = formatSwarmCreate({
      swarm_id: "swarm-1",
      swarm_identifier: "ENG-50",
      epic_id: "epic-1",
      epic_identifier: "ENG-1",
      coordinator: "",
      analysis: makeAnalysis(),
    });
    expect(out).not.toContain("coordinator:");
  });

  it("renders the existing-swarm error variant", () => {
    const out = formatSwarmCreate({
      error: "swarm already exists",
      existing_id: "swarm-old",
      existing_identifier: "ENG-40",
      existing_title: "Swarm: prior",
    });
    expect(out).toContain("✗ Swarm already exists: ENG-40 (Swarm: prior)\n");
    expect(out).toContain("  use --force to create another\n");
  });

  it("renders the not-swarmable error variant with errors and warnings", () => {
    const out = formatSwarmCreate({
      error: "epic is not swarmable",
      analysis: makeAnalysis({
        swarmable: false,
        errors: ["Dependency cycle detected"],
        warnings: ["epic has fewer than 2 children"],
      }),
    });
    expect(out).toContain("✗ Epic ENG-1 is not swarmable\n");
    expect(out).toContain("  ⚠ Dependency cycle detected\n");
    expect(out).toContain("  · epic has fewer than 2 children\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatSwarmCreate({
      swarm_id: "swarm-1",
      swarm_identifier: "ENG-50",
      epic_id: "epic-1",
      epic_identifier: "ENG-1",
      coordinator: "",
      analysis: makeAnalysis(),
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatSwarmValidate", () => {
  it("renders the swarmable single-line summary", () => {
    const out = formatSwarmValidate(makeAnalysis());
    expect(out).toContain(
      "✓ Epic ENG-1 is swarmable: 6 issues, 2 waves, max parallelism 3\n",
    );
  });

  it("emits warnings under the swarmable summary", () => {
    const out = formatSwarmValidate(
      makeAnalysis({ warnings: ["epic has no foundation/setup issue"] }),
    );
    expect(out).toContain("  · epic has no foundation/setup issue\n");
  });

  it("renders the not-swarmable variant with errors", () => {
    const out = formatSwarmValidate(
      makeAnalysis({
        swarmable: false,
        errors: ["Dependency cycle detected"],
      }),
    );
    expect(out).toContain("✗ Epic ENG-1 is not swarmable\n");
    expect(out).toContain("  ⚠ Dependency cycle detected\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatSwarmValidate(makeAnalysis());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatSwarmStatus", () => {
  function makeStatus(
    overrides: Partial<Parameters<typeof formatSwarmStatus>[0]> = {},
  ) {
    return {
      epic_identifier: "ENG-1",
      epic_title: "Foo epic",
      total_issues: 6,
      completed: [
        { identifier: "ENG-2", title: "Done thing" },
        { identifier: "ENG-3", title: "Also done" },
      ],
      active: [
        {
          identifier: "ENG-4",
          title: "In progress",
          assignee_name: "alice",
        },
      ],
      ready: [{ identifier: "ENG-5", title: "Ready to go" }],
      blocked: [
        {
          identifier: "ENG-6",
          title: "Blocked one",
          blocked_by: ["ENG-4"],
        },
      ],
      active_count: 1,
      ready_count: 1,
      blocked_count: 1,
      progress_percent: 33,
      ...overrides,
    };
  }

  it("renders the epic header line", () => {
    const out = formatSwarmStatus(makeStatus());
    expect(out.startsWith("Swarm status: ENG-1  Foo epic\n")).toBe(true);
  });

  it("renders the Progress line with all four counts", () => {
    const out = formatSwarmStatus(makeStatus());
    expect(out).toContain(
      "Progress: 2/6 closed (33%) · 1 active · 1 ready · 1 blocked\n",
    );
  });

  it("renders ✓ Completed section with count and rows", () => {
    const out = formatSwarmStatus(makeStatus());
    expect(out).toContain("✓ Completed (2):\n");
    expect(out).toContain("  ENG-2  Done thing\n");
  });

  it("renders ◐ Active section with assignee", () => {
    const out = formatSwarmStatus(makeStatus());
    expect(out).toContain("◐ Active (1):\n");
    expect(out).toContain("  ENG-4  In progress @alice\n");
  });

  it("renders ○ Ready section", () => {
    const out = formatSwarmStatus(makeStatus());
    expect(out).toContain("○ Ready (1):\n");
    expect(out).toContain("  ENG-5  Ready to go\n");
  });

  it("renders ● Blocked section with blocked_by suffix", () => {
    const out = formatSwarmStatus(makeStatus());
    expect(out).toContain("● Blocked (1):\n");
    expect(out).toContain("  ENG-6  Blocked one  ← [ENG-4]\n");
  });

  it("omits empty sections", () => {
    const out = formatSwarmStatus(
      makeStatus({
        completed: [],
        active: [],
        ready: [],
        blocked: [],
        active_count: 0,
        ready_count: 0,
        blocked_count: 0,
      }),
    );
    expect(out).not.toContain("Completed");
    expect(out).not.toContain("Active");
    expect(out).not.toContain("Ready");
    expect(out).not.toContain("Blocked (");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatSwarmStatus(makeStatus());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatSwarmList", () => {
  it("renders the empty-state hint", () => {
    expect(formatSwarmList({ swarms: [], count: 0 })).toBe(
      "\n📋 No swarms found.\n\n",
    );
  });

  it("renders a row per swarm with epic linkage and stats", () => {
    const out = formatSwarmList({
      swarms: [
        {
          swarm_identifier: "ENG-100",
          swarm_title: "Swarm: foo",
          epic_identifier: "ENG-1",
          epic_title: "Foo epic",
          coordinator: "alice",
          total_issues: 6,
          closed_issues: 2,
          wave_depth: 3,
          max_parallelism: 2,
          swarmable: true,
        },
      ],
      count: 1,
    });
    expect(out).toContain("📋 Swarms (1):\n");
    expect(out).toContain("  ENG-100  → ENG-1 (Foo epic)\n");
    expect(out).toContain(
      "    ✓ 2/6 closed · 3 waves · max parallelism 2 · coordinator: alice\n",
    );
  });

  it("renders (no linked epic) when epic linkage is missing", () => {
    const out = formatSwarmList({
      swarms: [
        {
          swarm_identifier: "ENG-100",
          swarm_title: "Swarm: orphan",
          epic_identifier: null,
          epic_title: null,
          coordinator: "",
          total_issues: 0,
          closed_issues: 0,
          wave_depth: 0,
          max_parallelism: 0,
          swarmable: false,
        },
      ],
      count: 1,
    });
    expect(out).toContain("→ (no linked epic)");
  });

  it("renders ✗ when swarmable is false", () => {
    const out = formatSwarmList({
      swarms: [
        {
          swarm_identifier: "ENG-100",
          swarm_title: "Swarm: bad",
          epic_identifier: "ENG-1",
          epic_title: "Bad epic",
          coordinator: "",
          total_issues: 3,
          closed_issues: 0,
          wave_depth: 1,
          max_parallelism: 1,
          swarmable: false,
        },
      ],
      count: 1,
    });
    expect(out).toContain("    ✗ ");
  });

  it("renders analysis_error in place of stats when present", () => {
    const out = formatSwarmList({
      swarms: [
        {
          swarm_identifier: "ENG-100",
          swarm_title: "Swarm: failed",
          epic_identifier: "ENG-1",
          epic_title: "Foo",
          coordinator: "",
          total_issues: 0,
          closed_issues: 0,
          wave_depth: 0,
          max_parallelism: 0,
          swarmable: false,
          analysis_error: "epic 'ENG-1' not found",
        },
      ],
      count: 1,
    });
    expect(out).toContain("    ⚠ epic 'ENG-1' not found\n");
    expect(out).not.toContain("0/0 closed");
  });

  it("omits coordinator suffix when empty string", () => {
    const out = formatSwarmList({
      swarms: [
        {
          swarm_identifier: "ENG-100",
          swarm_title: "Swarm: foo",
          epic_identifier: "ENG-1",
          epic_title: "Foo",
          coordinator: "",
          total_issues: 1,
          closed_issues: 0,
          wave_depth: 1,
          max_parallelism: 1,
          swarmable: true,
        },
      ],
      count: 1,
    });
    expect(out).not.toContain("coordinator:");
  });

  it("ends with trailing blank-line separator (mirrors documents/attachments)", () => {
    const out = formatSwarmList({
      swarms: [
        {
          swarm_identifier: "ENG-100",
          swarm_title: "Swarm: foo",
          epic_identifier: "ENG-1",
          epic_title: "Foo",
          coordinator: "",
          total_issues: 1,
          closed_issues: 0,
          wave_depth: 1,
          max_parallelism: 1,
          swarmable: true,
        },
      ],
      count: 1,
    });
    expect(out.endsWith("\n\n")).toBe(true);
    expect(out.endsWith("\n\n\n")).toBe(false);
  });
});
