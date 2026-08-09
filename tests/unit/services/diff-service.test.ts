import { describe, expect, it } from "vitest";
import { computeDiff } from "../../../src/services/diff-service.js";
import type { SnapshotIssue } from "../../../src/services/snapshot-service.js";

function makeIssue(overrides: Partial<SnapshotIssue> = {}): SnapshotIssue {
  return {
    id: "uuid-1",
    identifier: "TES-1",
    title: "demo",
    description: "",
    status: "started",
    priority: 0,
    ...overrides,
  };
}

describe("computeDiff", () => {
  it("returns empty array when snapshots are identical", () => {
    const issues = [makeIssue()];
    expect(computeDiff(issues, issues)).toEqual([]);
  });

  it("flags issues only in 'to' as added", () => {
    const from: SnapshotIssue[] = [];
    const to: SnapshotIssue[] = [makeIssue({ id: "a" })];
    const result = computeDiff(from, to);
    expect(result).toEqual([
      {
        issue_id: "a",
        diff_type: "added",
        old_value: null,
        new_value: to[0],
      },
    ]);
  });

  it("flags issues only in 'from' as removed", () => {
    const from = [makeIssue({ id: "x" })];
    const to: SnapshotIssue[] = [];
    expect(computeDiff(from, to)).toEqual([
      {
        issue_id: "x",
        diff_type: "removed",
        old_value: from[0],
        new_value: null,
      },
    ]);
  });

  it("detects title / status / priority / description changes as modified", () => {
    const from = [makeIssue({ id: "m", title: "old", status: "backlog" })];
    const to = [makeIssue({ id: "m", title: "new", status: "started" })];
    const result = computeDiff(from, to);
    expect(result.length).toBe(1);
    expect(result[0].diff_type).toBe("modified");
    expect(result[0].old_value?.title).toBe("old");
    expect(result[0].new_value?.title).toBe("new");
  });

  it("does not emit modified when monitored fields are unchanged", () => {
    const from = [makeIssue({ id: "u", title: "t", status: "started" })];
    const to = [makeIssue({ id: "u", title: "t", status: "started" })];
    expect(computeDiff(from, to)).toEqual([]);
  });

  it("orders entries: added → modified → removed, then by issue_id", () => {
    const from = [
      makeIssue({ id: "m1", title: "old1" }),
      makeIssue({ id: "r1" }),
    ];
    const to = [
      makeIssue({ id: "m1", title: "new1" }),
      makeIssue({ id: "a1" }),
      makeIssue({ id: "a2" }),
    ];
    const result = computeDiff(from, to);
    expect(result.map((e) => `${e.diff_type}:${e.issue_id}`)).toEqual([
      "added:a1",
      "added:a2",
      "modified:m1",
      "removed:r1",
    ]);
  });
});
