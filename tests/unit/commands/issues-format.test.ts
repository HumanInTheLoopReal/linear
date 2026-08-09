//
// Byte-exact format tests for `linear issues list`. The fixture shapes
// mirror the structural subset `formatIssueList` reads from `Issue`; full
// codegen fields are intentionally omitted to keep the fixtures inline.

import { describe, expect, it } from "vitest";
import {
  formatIssueDetail,
  formatIssueDetailWithAttachments,
  formatIssueDetailWithComments,
  formatIssueDetailWithCommentThreads,
  formatIssueDetailWithReactions,
  formatIssueList,
} from "../../../src/commands/issues.js";

interface FixtureIssue {
  identifier: string;
  title: string;
  priority: number;
  state: { type: string };
  labels?: { nodes: { name: string }[] } | null;
  parent?: { identifier: string } | null;
}

function listOf(...nodes: FixtureIssue[]): { nodes: FixtureIssue[] } {
  return { nodes };
}

describe("formatIssueList", () => {
  it("renders 'No issues found.' for an empty result", () => {
    expect(formatIssueList(listOf())).toBe("No issues found.\n");
  });

  it("renders a single flat row with priority + footer", () => {
    const out = formatIssueList(
      listOf({
        identifier: "TES-1",
        title: "single",
        priority: 2,
        state: { type: "backlog" },
      }),
    );
    expect(out).toBe(
      [
        "○ TES-1 ● P2 single",
        "",
        "-".repeat(80),
        "Total: 1 issues (1 to do, 0 in progress)",
        "",
        "Status: ○ to do  ◐ in progress  ● blocked  ✓ done  ❄ deferred",
        "",
      ].join("\n"),
    );
  });

  it("hides completed and canceled issues but keeps deferred/blocked-relation", () => {
    const out = formatIssueList(
      listOf(
        {
          identifier: "TES-1",
          title: "open",
          priority: 2,
          state: { type: "backlog" },
        },
        {
          identifier: "TES-2",
          title: "done",
          priority: 2,
          state: { type: "completed" },
        },
        {
          identifier: "TES-3",
          title: "killed",
          priority: 2,
          state: { type: "canceled" },
        },
      ),
    );
    expect(out).toContain("○ TES-1 ● P2 open");
    expect(out).not.toContain("TES-2");
    expect(out).not.toContain("TES-3");
    expect(out).toContain("Total: 1 issues");
  });

  it("omits the P-column for priority 0 (no priority)", () => {
    const out = formatIssueList(
      listOf({
        identifier: "TES-1",
        title: "untriaged",
        priority: 0,
        state: { type: "backlog" },
      }),
    );
    expect(out.split("\n")[0]).toBe("○ TES-1 ● untriaged");
  });

  it("renders deferred icon ❄ when issue carries a deferred label", () => {
    const out = formatIssueList(
      listOf({
        identifier: "TES-1",
        title: "snoozed",
        priority: 2,
        state: { type: "backlog" },
        labels: { nodes: [{ name: "deferred-until:2026-09-01" }] },
      }),
    );
    expect(out.split("\n")[0]).toBe("❄ TES-1 ● P2 snoozed");
    // Deferred doesn't contribute to the to-do or in-progress footer buckets.
    expect(out).toContain("Total: 1 issues (0 to do, 0 in progress)");
  });

  it("brackets non-task types via the type:* Linear-Hack label", () => {
    const out = formatIssueList(
      listOf({
        identifier: "TES-1",
        title: "release",
        priority: 2,
        state: { type: "backlog" },
        labels: { nodes: [{ name: "type:epic" }] },
      }),
    );
    expect(out.split("\n")[0]).toBe("○ TES-1 ● P2 [epic] release");
  });

  it("sorts roots by priority asc, then identifier asc", () => {
    const out = formatIssueList(
      listOf(
        {
          identifier: "TES-9",
          title: "low",
          priority: 4,
          state: { type: "backlog" },
        },
        {
          identifier: "TES-2",
          title: "urgent",
          priority: 1,
          state: { type: "backlog" },
        },
        {
          identifier: "TES-3",
          title: "medium-b",
          priority: 3,
          state: { type: "backlog" },
        },
        {
          identifier: "TES-1",
          title: "medium-a",
          priority: 3,
          state: { type: "backlog" },
        },
      ),
    );
    const rows = out.split("\n").slice(0, 4);
    expect(rows).toEqual([
      "○ TES-2 ● P1 urgent",
      "○ TES-1 ● P3 medium-a",
      "○ TES-3 ● P3 medium-b",
      "○ TES-9 ● P4 low",
    ]);
  });

  it("groups children under their parent with tree connectors", () => {
    const out = formatIssueList(
      listOf(
        {
          identifier: "TES-1",
          title: "Q2 release",
          priority: 2,
          state: { type: "backlog" },
          labels: { nodes: [{ name: "type:epic" }] },
        },
        {
          identifier: "TES-2",
          title: "child A",
          priority: 2,
          state: { type: "backlog" },
          parent: { identifier: "TES-1" },
        },
        {
          identifier: "TES-3",
          title: "child B (high)",
          priority: 1,
          state: { type: "backlog" },
          parent: { identifier: "TES-1" },
        },
      ),
    );
    const lines = out.split("\n").slice(0, 3);
    expect(lines).toEqual([
      "○ TES-1 ● P2 [epic] Q2 release",
      // Children sorted P1-then-P2 by priority within the epic.
      "├── ○ TES-3 ● P1 child B (high)",
      "└── ○ TES-2 ● P2 child A",
    ]);
  });

  it("renders grandchildren with │ continuation columns", () => {
    const out = formatIssueList(
      listOf(
        {
          identifier: "TES-1",
          title: "epic",
          priority: 2,
          state: { type: "backlog" },
          labels: { nodes: [{ name: "type:epic" }] },
        },
        {
          identifier: "TES-2",
          title: "branch A",
          priority: 2,
          state: { type: "backlog" },
          parent: { identifier: "TES-1" },
        },
        {
          identifier: "TES-3",
          title: "leaf A1",
          priority: 3,
          state: { type: "backlog" },
          parent: { identifier: "TES-2" },
        },
        {
          identifier: "TES-4",
          title: "leaf A2",
          priority: 3,
          state: { type: "backlog" },
          parent: { identifier: "TES-2" },
        },
        {
          identifier: "TES-5",
          title: "branch B",
          priority: 2,
          state: { type: "backlog" },
          parent: { identifier: "TES-1" },
        },
      ),
    );
    const lines = out.split("\n").slice(0, 5);
    expect(lines).toEqual([
      "○ TES-1 ● P2 [epic] epic",
      "├── ○ TES-2 ● P2 branch A",
      "│   ├── ○ TES-3 ● P3 leaf A1",
      "│   └── ○ TES-4 ● P3 leaf A2",
      "└── ○ TES-5 ● P2 branch B",
    ]);
  });

  it("promotes a child to root when its parent is not in the visible set", () => {
    // When filtering by priority (e.g. -p 1): only the high-priority child
    // appears, without its epic parent.
    const out = formatIssueList(
      listOf({
        identifier: "TES-3",
        title: "lonely child",
        priority: 1,
        state: { type: "backlog" },
        parent: { identifier: "TES-1" }, // TES-1 not in result set
      }),
    );
    expect(out.split("\n")[0]).toBe("○ TES-3 ● P1 lonely child");
  });

  it("counts started state as in-progress in the footer", () => {
    const out = formatIssueList(
      listOf(
        {
          identifier: "TES-1",
          title: "wip",
          priority: 2,
          state: { type: "started" },
        },
        {
          identifier: "TES-2",
          title: "todo",
          priority: 2,
          state: { type: "unstarted" },
        },
      ),
    );
    expect(out).toContain("Total: 2 issues (1 to do, 1 in progress)");
    expect(out).toContain("◐ TES-1 ● P2 wip");
  });

  it("emits exactly one trailing newline", () => {
    const out = formatIssueList(
      listOf({
        identifier: "TES-1",
        title: "x",
        priority: 2,
        state: { type: "backlog" },
      }),
    );
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("includeClosed=true keeps completed and canceled rows in the output (used by `issues children`)", () => {
    const out = formatIssueList(
      listOf(
        {
          identifier: "TES-1",
          title: "epic",
          priority: 2,
          state: { type: "backlog" },
          labels: { nodes: [{ name: "type:epic" }] },
        },
        {
          identifier: "TES-2",
          title: "done child",
          priority: 2,
          state: { type: "completed" },
          parent: { identifier: "TES-1" },
        },
        {
          identifier: "TES-3",
          title: "open child",
          priority: 2,
          state: { type: "backlog" },
          parent: { identifier: "TES-1" },
        },
      ),
      { includeClosed: true },
    );
    expect(out).toContain("✓ TES-2 ● P2 done child");
    expect(out).toContain("○ TES-3 ● P2 open child");
    expect(out).toContain("Total: 3 issues (2 to do, 0 in progress, 1 closed)");
  });

  it("summarizes an explicit closed-only list", () => {
    const out = formatIssueList(
      listOf(
        {
          identifier: "TES-2",
          title: "done",
          priority: 2,
          state: { type: "completed" },
        },
        {
          identifier: "TES-3",
          title: "duplicate",
          priority: 3,
          state: { type: "duplicate" },
        },
      ),
      { includeClosed: true },
    );

    expect(out).toContain("Total: 2 issues (0 to do, 0 in progress, 2 closed)");
  });
});

// ---------------------------------------------------------------------------
// formatIssueDetail
// ---------------------------------------------------------------------------

interface DetailFixture {
  identifier: string;
  title: string;
  priority: number;
  description?: string | null;
  state: { type: string; name: string };
  assignee?: { name: string } | null;
  labels?: { nodes: { name: string }[] } | null;
  project?: { name: string } | null;
  projectMilestone?: { name: string } | null;
  cycle?: { number?: number | null; name?: string | null } | null;
  estimate?: number | null;
  dueDate?: string | null;
  parent?: {
    identifier: string;
    title: string;
    priority: number;
    state: { type: string };
    labels?: { nodes: { name: string }[] } | null;
  } | null;
  children?: {
    nodes: {
      identifier: string;
      title: string;
      priority: number;
      state: { type: string };
      labels?: { nodes: { name: string }[] } | null;
    }[];
  } | null;
  relations?: {
    nodes: {
      type: string;
      relatedIssue: {
        identifier: string;
        title: string;
        priority: number;
        state: { type: string };
        labels?: { nodes: { name: string }[] } | null;
      };
    }[];
  } | null;
  inverseRelations?: {
    nodes: {
      type: string;
      issue: {
        identifier: string;
        title: string;
        priority: number;
        state: { type: string };
        labels?: { nodes: { name: string }[] } | null;
      };
    }[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

function detail(overrides: Partial<DetailFixture> = {}): DetailFixture {
  return {
    identifier: "TES-1",
    title: "title",
    priority: 2,
    state: { type: "backlog", name: "Backlog" },
    assignee: { name: "Alice" },
    createdAt: "2026-05-16T10:00:00.000Z",
    updatedAt: "2026-05-16T11:00:00.000Z",
    ...overrides,
  };
}

describe("formatIssueDetail", () => {
  it("renders a minimal task with header + owner + dates and a trailing newline", () => {
    const out = formatIssueDetail(detail());
    expect(out).toBe(
      [
        "○ TES-1 · title   [● P2 · BACKLOG]",
        "Owner: Alice · Type: task",
        "Created: 2026-05-16 · Updated: 2026-05-16",
        "",
      ].join("\n"),
    );
  });

  it("omits priority from the [● … · STATE] summary when priority is 0", () => {
    const out = formatIssueDetail(detail({ priority: 0 }));
    expect(out.split("\n")[0]).toBe("○ TES-1 · title   [● · BACKLOG]");
  });

  it("brackets the type when a type:* label is present, and uppercases it", () => {
    const out = formatIssueDetail(
      detail({ labels: { nodes: [{ name: "type:epic" }] } }),
    );
    expect(out.split("\n")[0]).toBe(
      "○ TES-1 [EPIC] · title   [● P2 · BACKLOG]",
    );
    // Owner line surfaces the lowercase type literal.
    expect(out).toContain("Owner: Alice · Type: epic");
  });

  it("falls back to (unassigned) when assignee is null", () => {
    const out = formatIssueDetail(detail({ assignee: null }));
    expect(out).toContain("Owner: (unassigned) · Type: task");
  });

  it("uses DEFERRED in the summary banner when the deferred label is present", () => {
    const out = formatIssueDetail(
      detail({ labels: { nodes: [{ name: "deferred" }] } }),
    );
    expect(out.split("\n")[0]).toBe("❄ TES-1 · title   [● P2 · DEFERRED]");
  });

  it("uses Linear's state.name uppercased for the banner (e.g. IN PROGRESS)", () => {
    const out = formatIssueDetail(
      detail({ state: { type: "started", name: "In Progress" } }),
    );
    expect(out.split("\n")[0]).toBe("◐ TES-1 · title   [● P2 · IN PROGRESS]");
  });

  it("surfaces workspace-specific Linear state names verbatim (e.g. 'In Review')", () => {
    const out = formatIssueDetail(
      detail({ state: { type: "started", name: "In Review" } }),
    );
    expect(out.split("\n")[0]).toBe("◐ TES-1 · title   [● P2 · IN REVIEW]");
  });

  it("appends BLOCKED by <id> when one incoming blocker is open (lin-7ypt)", () => {
    const out = formatIssueDetail(
      detail({
        inverseRelations: {
          nodes: [
            {
              type: "blocks",
              issue: {
                identifier: "TES-99",
                title: "blocker",
                priority: 2,
                state: { type: "started" },
              },
            },
          ],
        },
      }),
    );
    expect(out.split("\n")[0]).toBe(
      "○ TES-1 · title   [● P2 · BACKLOG · BLOCKED by TES-99]",
    );
  });

  it("collapses to BLOCKED by N when there are 2+ open blockers (lin-7ypt)", () => {
    const out = formatIssueDetail(
      detail({
        inverseRelations: {
          nodes: [
            {
              type: "blocks",
              issue: {
                identifier: "TES-101",
                title: "b1",
                priority: 2,
                state: { type: "started" },
              },
            },
            {
              type: "blocks",
              issue: {
                identifier: "TES-102",
                title: "b2",
                priority: 2,
                state: { type: "unstarted" },
              },
            },
          ],
        },
      }),
    );
    expect(out.split("\n")[0]).toBe(
      "○ TES-1 · title   [● P2 · BACKLOG · BLOCKED by 2]",
    );
  });

  it("ignores closed blockers when composing the BLOCKED suffix (lin-7ypt)", () => {
    const out = formatIssueDetail(
      detail({
        inverseRelations: {
          nodes: [
            {
              type: "blocks",
              issue: {
                identifier: "TES-201",
                title: "done blocker",
                priority: 2,
                state: { type: "completed" },
              },
            },
            {
              type: "blocks",
              issue: {
                identifier: "TES-202",
                title: "canceled blocker",
                priority: 2,
                state: { type: "canceled" },
              },
            },
          ],
        },
      }),
    );
    expect(out.split("\n")[0]).toBe("○ TES-1 · title   [● P2 · BACKLOG]");
  });

  it("composes DEFERRED + BLOCKED when both apply (lin-7ypt)", () => {
    const out = formatIssueDetail(
      detail({
        labels: { nodes: [{ name: "deferred" }] },
        inverseRelations: {
          nodes: [
            {
              type: "blocks",
              issue: {
                identifier: "TES-624",
                title: "blocker",
                priority: 2,
                state: { type: "started" },
              },
            },
          ],
        },
      }),
    );
    expect(out.split("\n")[0]).toBe(
      "❄ TES-1 · title   [● P2 · DEFERRED · BLOCKED by TES-624]",
    );
  });

  it("uses each completed/canceled state's own Linear name", () => {
    const completed = formatIssueDetail(
      detail({ state: { type: "completed", name: "Done" } }),
    );
    expect(completed.split("\n")[0]).toBe("✓ TES-1 · title   [● P2 · DONE]");
    const canceled = formatIssueDetail(
      detail({ state: { type: "canceled", name: "Canceled" } }),
    );
    expect(canceled.split("\n")[0]).toBe("✓ TES-1 · title   [● P2 · CANCELED]");
  });

  it("includes a DESCRIPTION section when description is non-empty", () => {
    const out = formatIssueDetail(detail({ description: "Some body text" }));
    expect(out).toContain("\n\nDESCRIPTION\nSome body text");
  });

  it("omits DESCRIPTION when description is null, empty, or whitespace-only", () => {
    expect(formatIssueDetail(detail({ description: null }))).not.toContain(
      "DESCRIPTION",
    );
    expect(formatIssueDetail(detail({ description: "" }))).not.toContain(
      "DESCRIPTION",
    );
    expect(formatIssueDetail(detail({ description: "   \n " }))).not.toContain(
      "DESCRIPTION",
    );
  });

  it("renders CHILDREN sorted by identifier ascending", () => {
    const out = formatIssueDetail(
      detail({
        labels: { nodes: [{ name: "type:epic" }] },
        children: {
          nodes: [
            {
              identifier: "TES-3",
              title: "c",
              priority: 3,
              state: { type: "backlog" },
            },
            {
              identifier: "TES-2",
              title: "b",
              priority: 2,
              state: { type: "backlog" },
            },
          ],
        },
      }),
    );
    expect(out).toContain(
      ["CHILDREN", "  ↳ ○ TES-2: b ● P2", "  ↳ ○ TES-3: c ● P3"].join("\n"),
    );
  });

  it("appends epic-progress line `◐ M/N complete (P%)` when type:epic", () => {
    const out = formatIssueDetail(
      detail({
        labels: { nodes: [{ name: "type:epic" }] },
        children: {
          nodes: [
            {
              identifier: "TES-2",
              title: "a",
              priority: 2,
              state: { type: "completed" },
            },
            {
              identifier: "TES-3",
              title: "b",
              priority: 2,
              state: { type: "backlog" },
            },
            {
              identifier: "TES-4",
              title: "c",
              priority: 2,
              state: { type: "backlog" },
            },
          ],
        },
      }),
    );
    expect(out).toContain("◐ 1/3 complete (33%)");
  });

  it("does NOT append epic-progress when the issue is not type:epic", () => {
    const out = formatIssueDetail(
      detail({
        children: {
          nodes: [
            {
              identifier: "TES-2",
              title: "a",
              priority: 2,
              state: { type: "backlog" },
            },
          ],
        },
      }),
    );
    expect(out).not.toContain("complete (");
  });

  it("renders PARENT with (TYPE) prefix when parent has a type:* label", () => {
    const out = formatIssueDetail(
      detail({
        parent: {
          identifier: "TES-9",
          title: "Q2 Release",
          priority: 2,
          state: { type: "backlog" },
          labels: { nodes: [{ name: "type:epic" }] },
        },
      }),
    );
    expect(out).toContain(
      ["PARENT", "  ↑ ○ TES-9: (EPIC) Q2 Release ● P2"].join("\n"),
    );
  });

  it("renders PARENT without (TYPE) prefix when parent is a plain task", () => {
    const out = formatIssueDetail(
      detail({
        parent: {
          identifier: "TES-9",
          title: "groomed",
          priority: 3,
          state: { type: "backlog" },
        },
      }),
    );
    expect(out).toContain(["PARENT", "  ↑ ○ TES-9: groomed ● P3"].join("\n"));
  });

  it("renders DEPENDS ON for inverseRelations of type 'blocks'", () => {
    const out = formatIssueDetail(
      detail({
        inverseRelations: {
          nodes: [
            {
              type: "blocks",
              issue: {
                identifier: "TES-5",
                title: "upstream",
                priority: 1,
                state: { type: "started" },
              },
            },
          ],
        },
      }),
    );
    expect(out).toContain(
      ["DEPENDS ON", "  → ◐ TES-5: upstream ● P1"].join("\n"),
    );
  });

  it("renders BLOCKS for outgoing relations of type 'blocks' with the related issue's own status icon", () => {
    const out = formatIssueDetail(
      detail({
        relations: {
          nodes: [
            {
              type: "blocks",
              relatedIssue: {
                identifier: "TES-6",
                title: "downstream",
                priority: 3,
                state: { type: "completed" },
              },
            },
          ],
        },
      }),
    );
    expect(out).toContain(
      ["BLOCKS", "  ← ✓ TES-6: downstream ● P3"].join("\n"),
    );
  });

  it("filters out non-'blocks' relation types from DEPENDS ON / BLOCKS sections", () => {
    const out = formatIssueDetail(
      detail({
        relations: {
          nodes: [
            {
              type: "related",
              relatedIssue: {
                identifier: "TES-7",
                title: "sibling",
                priority: 2,
                state: { type: "backlog" },
              },
            },
          ],
          inverseRelations: undefined,
        } as never,
      }),
    );
    expect(out).not.toContain("BLOCKS");
    expect(out).not.toContain("DEPENDS ON");
  });

  it("renders DUPLICATES for inverseRelations of type 'duplicate' (this issue is canonical)", () => {
    const out = formatIssueDetail(
      detail({
        inverseRelations: {
          nodes: [
            {
              type: "duplicate",
              issue: {
                identifier: "TES-10",
                title: "closed dup",
                priority: 3,
                state: { type: "canceled" },
              },
            },
          ],
        },
      }),
    );
    expect(out).toContain(
      ["DUPLICATES", "  ← ✓ TES-10: closed dup ● P3"].join("\n"),
    );
  });

  it("renders DUPLICATE OF for outgoing relations of type 'duplicate' (this issue is the dup)", () => {
    const out = formatIssueDetail(
      detail({
        relations: {
          nodes: [
            {
              type: "duplicate",
              relatedIssue: {
                identifier: "TES-11",
                title: "canonical",
                priority: 2,
                state: { type: "started" },
              },
            },
          ],
        },
      }),
    );
    expect(out).toContain(
      ["DUPLICATE OF", "  → ◐ TES-11: canonical ● P2"].join("\n"),
    );
  });

  // lin-78df: `linear issues supersede` and `linear depends add --type
  // related/supersedes/…` all create Related relations. Without a
  // RELATED section the outcome of these verbs was invisible in
  // `issues read` — agents had to run `depends list` to find what
  // replaced an issue.
  it("renders RELATED for outgoing related relations (this issue points at the related one)", () => {
    const out = formatIssueDetail(
      detail({
        relations: {
          nodes: [
            {
              type: "related",
              relatedIssue: {
                identifier: "TES-20",
                title: "replacement",
                priority: 2,
                state: { type: "started" },
              },
            },
          ],
        },
      }),
    );
    expect(out).toContain(
      ["RELATED", "  → ◐ TES-20: replacement ● P2"].join("\n"),
    );
  });

  it("renders RELATED for inverse related relations (something else points at this issue)", () => {
    const out = formatIssueDetail(
      detail({
        inverseRelations: {
          nodes: [
            {
              type: "related",
              issue: {
                identifier: "TES-21",
                title: "the superseded one",
                priority: 3,
                state: { type: "canceled" },
              },
            },
          ],
        },
      }),
    );
    expect(out).toContain(
      ["RELATED", "  ← ✓ TES-21: the superseded one ● P3"].join("\n"),
    );
  });

  it("renders both directions of related under a single RELATED section (outgoing first, then incoming)", () => {
    const out = formatIssueDetail(
      detail({
        relations: {
          nodes: [
            {
              type: "related",
              relatedIssue: {
                identifier: "TES-22",
                title: "outgoing rel",
                priority: 0,
                state: { type: "backlog" },
              },
            },
          ],
        },
        inverseRelations: {
          nodes: [
            {
              type: "related",
              issue: {
                identifier: "TES-23",
                title: "incoming rel",
                priority: 0,
                state: { type: "canceled" },
              },
            },
          ],
        },
      }),
    );
    expect(out).toContain(
      [
        "RELATED",
        "  → ○ TES-22: outgoing rel",
        "  ← ✓ TES-23: incoming rel",
      ].join("\n"),
    );
  });

  it("omits the RELATED section entirely when there are no related edges", () => {
    const out = formatIssueDetail(detail());
    expect(out).not.toContain("RELATED");
  });

  // lin-n5im: text view must show enough of the issue's classification
  // that an agent can decide to start it without flipping to --json.
  it("renders a Labels line for user-visible labels (lin-n5im)", () => {
    const out = formatIssueDetail(
      detail({
        labels: {
          nodes: [
            { name: "good-first-issue" },
            { name: "area:cli" },
            { name: "git:linear" },
          ],
        },
      }),
    );
    expect(out).toContain("Labels: good-first-issue, area:cli, git:linear");
  });

  it("hides Linear-Hack labels (type:*, deferred, dep-type:*) from the Labels line", () => {
    const out = formatIssueDetail(
      detail({
        labels: {
          nodes: [
            { name: "type:epic" },
            { name: "deferred" },
            { name: "deferred-until:2026-09-01" },
            { name: "dep-type:supersedes" },
            { name: "user-visible-tag" },
          ],
        },
      }),
    );
    expect(out).toContain("Labels: user-visible-tag");
    expect(out).not.toContain("Labels: type:epic");
    expect(out).not.toContain("dep-type:supersedes");
  });

  it("omits the Labels line entirely when there are no user-visible labels", () => {
    const out = formatIssueDetail(
      detail({
        labels: { nodes: [{ name: "type:bug" }, { name: "deferred" }] },
      }),
    );
    expect(out).not.toContain("Labels:");
  });

  it("renders Project / Milestone / Cycle / Estimate / Due in a single metadata line", () => {
    const out = formatIssueDetail(
      detail({
        project: { name: "Q2 Launch" },
        projectMilestone: { name: "beta" },
        cycle: { number: 7, name: null },
        estimate: 3,
        dueDate: "2026-06-30",
      }),
    );
    expect(out).toContain(
      "Project: Q2 Launch · Milestone: beta · Cycle: #7 · Estimate: 3 · Due: 2026-06-30",
    );
  });

  it("prefers cycle name over cycle number when both are present", () => {
    const out = formatIssueDetail(
      detail({ cycle: { number: 7, name: "Sprint 14" } }),
    );
    expect(out).toContain("Cycle: Sprint 14");
    expect(out).not.toContain("#7");
  });

  it("omits the metadata line entirely when nothing applies", () => {
    const out = formatIssueDetail(detail());
    expect(out).not.toContain("Project:");
    expect(out).not.toContain("Cycle:");
    expect(out).not.toContain("Estimate:");
    expect(out).not.toContain("Due:");
  });

  it("renders DUPLICATES and BLOCKS as separate sections when both are present", () => {
    const out = formatIssueDetail(
      detail({
        relations: {
          nodes: [
            {
              type: "blocks",
              relatedIssue: {
                identifier: "TES-12",
                title: "downstream",
                priority: 3,
                state: { type: "backlog" },
              },
            },
          ],
        },
        inverseRelations: {
          nodes: [
            {
              type: "duplicate",
              issue: {
                identifier: "TES-13",
                title: "dup",
                priority: 4,
                state: { type: "canceled" },
              },
            },
          ],
        },
      }),
    );
    expect(out).toContain("BLOCKS");
    expect(out).toContain("DUPLICATES");
    // BLOCKS appears before DUPLICATES in the section order.
    expect(out.indexOf("BLOCKS")).toBeLessThan(out.indexOf("DUPLICATES"));
  });

  it("drops the priority suffix on related rows when priority is 0", () => {
    const out = formatIssueDetail(
      detail({
        inverseRelations: {
          nodes: [
            {
              type: "blocks",
              issue: {
                identifier: "TES-8",
                title: "no-pri",
                priority: 0,
                state: { type: "backlog" },
              },
            },
          ],
        },
      }),
    );
    expect(out).toContain(["DEPENDS ON", "  → ○ TES-8: no-pri"].join("\n"));
    expect(out).not.toContain("TES-8: no-pri ●");
  });

  it("emits exactly one trailing newline regardless of which sections are present", () => {
    const minimal = formatIssueDetail(detail());
    const rich = formatIssueDetail(
      detail({
        description: "body",
        labels: { nodes: [{ name: "type:epic" }] },
        children: {
          nodes: [
            {
              identifier: "TES-2",
              title: "c",
              priority: 2,
              state: { type: "backlog" },
            },
          ],
        },
      }),
    );
    for (const out of [minimal, rich]) {
      expect(out.endsWith("\n")).toBe(true);
      expect(out.endsWith("\n\n")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// formatIssueDetailWithAttachments / WithComments / WithCommentThreads /
// WithReactions — appended-section formatters for `issues read --with-*`.
// ---------------------------------------------------------------------------

describe("formatIssueDetailWithAttachments", () => {
  it("returns plain detail when there are no attachments", () => {
    const out = formatIssueDetailWithAttachments({
      ...detail(),
      attachments: { nodes: [] },
    });
    expect(out).toBe(formatIssueDetail(detail()));
  });

  it("returns plain detail when attachments is null", () => {
    const out = formatIssueDetailWithAttachments({
      ...detail(),
      attachments: null,
    });
    expect(out).toBe(formatIssueDetail(detail()));
  });

  it("appends an ATTACHMENTS section with URL + title rows", () => {
    const out = formatIssueDetailWithAttachments({
      ...detail(),
      attachments: {
        nodes: [
          { url: "https://example.com/a", title: "Design doc" },
          { url: "https://example.com/b", title: "Spec" },
        ],
      },
    });
    expect(out).toContain("\nATTACHMENTS (2)\n");
    expect(out).toContain("  → https://example.com/a · Design doc");
    expect(out).toContain("  → https://example.com/b · Spec");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("drops the ' · <title>' suffix when title is missing or blank", () => {
    const out = formatIssueDetailWithAttachments({
      ...detail(),
      attachments: {
        nodes: [
          { url: "https://example.com/a", title: null },
          { url: "https://example.com/b", title: "  " },
        ],
      },
    });
    expect(out).toContain("  → https://example.com/a\n");
    expect(out).toContain("  → https://example.com/b\n");
  });

  it("separates the base card from the section with exactly one blank line", () => {
    const out = formatIssueDetailWithAttachments({
      ...detail(),
      attachments: {
        nodes: [{ url: "https://example.com/a", title: "x" }],
      },
    });
    // base ends "\n" then we add "\nATTACHMENTS …" — one blank line.
    expect(out).toContain("Updated: 2026-05-16\n\nATTACHMENTS (1)\n");
  });
});

describe("formatIssueDetailWithComments", () => {
  it("returns plain detail when there are no comments", () => {
    const out = formatIssueDetailWithComments({
      ...detail(),
      comments: { nodes: [] },
    });
    expect(out).toBe(formatIssueDetail(detail()));
  });

  it("appends a COMMENTS section with author + date + body preview", () => {
    const out = formatIssueDetailWithComments({
      ...detail(),
      comments: {
        nodes: [
          {
            id: "c1",
            body: "First line\nsecond line",
            createdAt: "2026-05-10T12:00:00.000Z",
            parentId: null,
            user: { displayName: "Alice" },
          },
          {
            id: "c2",
            body: "Reply",
            createdAt: "2026-05-11T12:00:00.000Z",
            parentId: "c1",
            user: { displayName: "Bob" },
          },
        ],
      },
    });
    expect(out).toContain("\nCOMMENTS (2)\n");
    expect(out).toContain("  - @Alice · 2026-05-10\n");
    expect(out).toContain("    First line\n");
    expect(out).toContain("  - @Bob · 2026-05-11\n");
    expect(out).toContain("    Reply\n");
  });

  it("falls back to (unknown) when comment author has no displayName", () => {
    const out = formatIssueDetailWithComments({
      ...detail(),
      comments: {
        nodes: [
          {
            id: "c1",
            body: "hi",
            createdAt: "2026-05-10T12:00:00.000Z",
            parentId: null,
            user: null,
          },
        ],
      },
    });
    expect(out).toContain("  - @(unknown) · 2026-05-10\n");
  });

  it("omits the body-preview line when the body is empty / blank", () => {
    const out = formatIssueDetailWithComments({
      ...detail(),
      comments: {
        nodes: [
          {
            id: "c1",
            body: "   \n  ",
            createdAt: "2026-05-10T12:00:00.000Z",
            parentId: null,
            user: { displayName: "Alice" },
          },
        ],
      },
    });
    // Author row present, no indented preview row after it.
    expect(out).toContain("  - @Alice · 2026-05-10\n");
    expect(out).not.toMatch(/ {2}- @Alice · 2026-05-10\n {4}/);
  });
});

describe("formatIssueDetailWithCommentThreads", () => {
  it("counts every comment (roots + replies) in the COMMENTS (N) header", () => {
    const out = formatIssueDetailWithCommentThreads({
      ...detail(),
      comments: {
        nodes: [
          {
            id: "c1",
            body: "root",
            createdAt: "2026-05-10T12:00:00.000Z",
            parentId: null,
            user: { displayName: "Alice" },
            replies: [
              {
                id: "c2",
                body: "reply1",
                createdAt: "2026-05-10T13:00:00.000Z",
                parentId: "c1",
                user: { displayName: "Bob" },
                replies: [
                  {
                    id: "c3",
                    body: "reply2",
                    createdAt: "2026-05-10T14:00:00.000Z",
                    parentId: "c2",
                    user: { displayName: "Carol" },
                    replies: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(out).toContain("\nCOMMENTS (3)\n");
  });

  it("indents replies by two spaces per depth level", () => {
    const out = formatIssueDetailWithCommentThreads({
      ...detail(),
      comments: {
        nodes: [
          {
            id: "c1",
            body: "root",
            createdAt: "2026-05-10T12:00:00.000Z",
            parentId: null,
            user: { displayName: "A" },
            replies: [
              {
                id: "c2",
                body: "reply",
                createdAt: "2026-05-10T13:00:00.000Z",
                parentId: "c1",
                user: { displayName: "B" },
                replies: [],
              },
            ],
          },
        ],
      },
    });
    expect(out).toContain("  - @A · 2026-05-10\n");
    expect(out).toContain("    - @B · 2026-05-10\n");
  });
});

describe("formatIssueDetailWithReactions", () => {
  it("returns plain detail when reactions is empty / null / undefined", () => {
    const base = formatIssueDetail(detail());
    expect(formatIssueDetailWithReactions({ ...detail(), reactions: [] })).toBe(
      base,
    );
    expect(
      formatIssueDetailWithReactions({ ...detail(), reactions: null }),
    ).toBe(base);
    expect(formatIssueDetailWithReactions(detail())).toBe(base);
  });

  it("renders one line of `:emoji: count` cells separated by ` · `", () => {
    const out = formatIssueDetailWithReactions({
      ...detail(),
      reactions: [
        { emoji: "thumbs_up", count: 3 },
        { emoji: "eyes", count: 1 },
      ],
    });
    expect(out).toContain("\nREACTIONS\n  :thumbs_up: 3 · :eyes: 1\n");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
