//
// Format tests for `linear depends list`. The fixture shape mirrors
// `DependsListEntry` returned by the service plus the synthetic parent-child
// entry the command prepends in text mode.

import { describe, expect, it } from "vitest";
import {
  formatDepAdded,
  formatDepList,
  formatDepListBatch,
  formatDepRemoved,
} from "../../../src/commands/depends.js";
import type { DependsListEntry } from "../../../src/services/issue-relation-service.js";

function entry(overrides: Partial<DependsListEntry> = {}): DependsListEntry {
  return {
    relation_id: "rel-1",
    type: "blocks",
    direction: "down",
    issue_id: "uuid-1",
    identifier: "TES-7",
    title: "blocker",
    priority: 2,
    status: "backlog",
    state_name: "Backlog",
    ...overrides,
  };
}

describe("formatDepList", () => {
  it("renders an empty case as `<issue-arg> has no dependencies` with blank line above", () => {
    expect(formatDepList([], "TES-1")).toBe("\nTES-1 has no dependencies\n");
  });

  it("echoes back the user-supplied issue argument verbatim (UUID, identifier, whatever)", () => {
    expect(formatDepList([], "abc-uuid-not-an-identifier")).toContain(
      "abc-uuid-not-an-identifier has no dependencies",
    );
  });

  it("renders 2-space-indented dep rows with `[P<n>] (<state-name>) via <type>` shape", () => {
    expect(formatDepList([entry()], "TES-1")).toBe(
      ["  TES-7: blocker [P2] (Backlog) via blocks", "", ""].join("\n"),
    );
  });

  it("uses empty brackets `[]` when priority is 0 (no priority)", () => {
    const out = formatDepList([entry({ priority: 0 })], "TES-1");
    expect(out).toContain("  TES-7: blocker [] (Backlog) via blocks");
  });

  it("renders Linear's actual state name (whatever the workspace named the state)", () => {
    const wip = formatDepList(
      [entry({ status: "started", state_name: "In Progress" })],
      "TES-1",
    );
    expect(wip).toContain("(In Progress)");
    const done = formatDepList(
      [entry({ status: "completed", state_name: "Done" })],
      "TES-1",
    );
    expect(done).toContain("(Done)");
    const custom = formatDepList(
      [entry({ status: "started", state_name: "In Review" })],
      "TES-1",
    );
    expect(custom).toContain("(In Review)");
  });

  it("falls back to raw state.type if state_name is empty (defensive)", () => {
    const out = formatDepList(
      [entry({ status: "started", state_name: "" })],
      "TES-1",
    );
    expect(out).toContain("(started)");
  });

  it("renders multiple entries in the order the caller provided (no sort)", () => {
    const out = formatDepList(
      [
        entry({
          type: "parent-child",
          identifier: "TES-5",
          title: "epic",
          priority: 2,
          status: "backlog",
          state_name: "Backlog",
        }),
        entry({
          identifier: "TES-9",
          title: "blocker",
          priority: 1,
          state_name: "Todo",
        }),
      ],
      "TES-1",
    );
    expect(out).toBe(
      [
        "  TES-5: epic [P2] (Backlog) via parent-child",
        "  TES-9: blocker [P1] (Todo) via blocks",
        "",
        "",
      ].join("\n"),
    );
  });

  it("ends with `\\n\\n` (one terminating newline + one blank line)", () => {
    const out = formatDepList([entry()], "TES-1");
    expect(out.endsWith("\n\n")).toBe(true);
    expect(out.endsWith("\n\n\n")).toBe(false);
  });
});

describe("formatDepListBatch (lin-zoqs)", () => {
  it("groups each issue under a `📋 <id> depends on:` header with rich rows", () => {
    const out = formatDepListBatch(
      [
        { issueArg: "TES-1", entries: [entry()] },
        {
          issueArg: "TES-2",
          entries: [entry({ identifier: "TES-9", title: "other" })],
        },
      ],
      "down",
    );
    expect(out).toBe(
      [
        "",
        "📋 TES-1 depends on:",
        "",
        "  TES-7: blocker [P2] (Backlog) via blocks",
        "",
        "📋 TES-2 depends on:",
        "",
        "  TES-9: other [P2] (Backlog) via blocks",
        "",
        "",
      ].join("\n"),
    );
  });

  it("renders an empty issue with the same `<id> has no dependencies` line", () => {
    const out = formatDepListBatch(
      [
        { issueArg: "TES-1", entries: [] },
        { issueArg: "TES-2", entries: [entry()] },
      ],
      "down",
    );
    expect(out).toContain("\nTES-1 has no dependencies\n");
    expect(out).toContain("📋 TES-2 depends on:");
  });

  it("switches the header phrase to `is depended on by` for --direction up", () => {
    const out = formatDepListBatch(
      [{ issueArg: "TES-1", entries: [entry()] }],
      "up",
    );
    expect(out).toContain("📋 TES-1 is depended on by:");
    expect(out).not.toContain("depends on:");
  });

  it("keeps `depends on` for --direction both", () => {
    const out = formatDepListBatch(
      [{ issueArg: "TES-1", entries: [entry()] }],
      "both",
    );
    expect(out).toContain("📋 TES-1 depends on:");
  });
});

describe("formatDepAdded", () => {
  // Round-1 UX bug (4/4 agents): the old text rendered `A -> B [blocks]`
  // for `linear depends add A B`, but the actual edge means B blocks A.
  // The new format encodes the verb explicitly so the direction can't be
  // misread.

  it("renders `<dependsOn> blocks <issue>` for type=blocks (default)", () => {
    expect(
      formatDepAdded({ status: "added", type: "blocks" }, "TES-1", "TES-2"),
    ).toBe("✓ Added: TES-2 blocks TES-1");
  });

  it("defaults to blocks-direction when type is missing", () => {
    expect(formatDepAdded({ status: "added" }, "TES-1", "TES-2")).toBe(
      "✓ Added: TES-2 blocks TES-1",
    );
  });

  it("renders `<issue> blocks <dependsOn>` for type=blocked-by (inverse direction)", () => {
    expect(
      formatDepAdded({ status: "added", type: "blocked-by" }, "TES-1", "TES-2"),
    ).toBe("✓ Added: TES-1 blocks TES-2");
  });

  it("renders `<a> ↔ <b> [related]` for symmetric types", () => {
    expect(
      formatDepAdded({ status: "added", type: "related" }, "TES-1", "TES-2"),
    ).toBe("✓ Added: TES-1 ↔ TES-2 [related]");
    expect(
      formatDepAdded({ status: "added", type: "relates-to" }, "TES-1", "TES-2"),
    ).toBe("✓ Added: TES-1 ↔ TES-2 [relates-to]");
  });

  it("renders `<issue> -> <dependsOn> [<type>]` for hack types", () => {
    expect(
      formatDepAdded({ status: "added", type: "supersedes" }, "TES-1", "TES-2"),
    ).toBe("✓ Added: TES-1 -> TES-2 [supersedes]");
    expect(
      formatDepAdded({ status: "added", type: "tracks" }, "TES-1", "TES-2"),
    ).toBe("✓ Added: TES-1 -> TES-2 [tracks]");
  });
});

describe("formatDepRemoved", () => {
  it("renders direction-agnostic 'between <a> and <b>' (type isn't known at remove time)", () => {
    expect(formatDepRemoved({ status: "removed" }, "TES-1", "TES-2")).toBe(
      "✓ Removed dependency between TES-1 and TES-2",
    );
  });
});
