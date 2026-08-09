/**
 * Snapshot diff for `linear issues diff <from> <to>`. Emits records
 * shaped as (issue_id, diff_type, old_value, new_value).
 *
 * "Modified" entries are emitted when ANY of {title, status,
 * priority, description} differ between the two snapshots. Issues
 * present only in the older snapshot are "removed"; issues present
 * only in the newer one are "added".
 */

import type { SnapshotIssue } from "./snapshot-service.js";

export type DiffType = "added" | "modified" | "removed";

export interface DiffEntry {
  issue_id: string;
  diff_type: DiffType;
  old_value: SnapshotIssue | null;
  new_value: SnapshotIssue | null;
}

function indexById(issues: SnapshotIssue[]): Map<string, SnapshotIssue> {
  const map = new Map<string, SnapshotIssue>();
  for (const issue of issues) {
    map.set(issue.id, issue);
  }
  return map;
}

function hasChanged(a: SnapshotIssue, b: SnapshotIssue): boolean {
  return (
    a.title !== b.title ||
    a.status !== b.status ||
    a.priority !== b.priority ||
    a.description !== b.description
  );
}

export function computeDiff(
  from: SnapshotIssue[],
  to: SnapshotIssue[],
): DiffEntry[] {
  const fromMap = indexById(from);
  const toMap = indexById(to);
  const entries: DiffEntry[] = [];

  for (const [id, newValue] of toMap) {
    const oldValue = fromMap.get(id);
    if (!oldValue) {
      entries.push({
        issue_id: id,
        diff_type: "added",
        old_value: null,
        new_value: newValue,
      });
    } else if (hasChanged(oldValue, newValue)) {
      entries.push({
        issue_id: id,
        diff_type: "modified",
        old_value: oldValue,
        new_value: newValue,
      });
    }
  }

  for (const [id, oldValue] of fromMap) {
    if (!toMap.has(id)) {
      entries.push({
        issue_id: id,
        diff_type: "removed",
        old_value: oldValue,
        new_value: null,
      });
    }
  }

  // Stable ordering: added → modified → removed, then by issue_id within each.
  const typeOrder: Record<DiffType, number> = {
    added: 0,
    modified: 1,
    removed: 2,
  };
  entries.sort((a, b) => {
    const t = typeOrder[a.diff_type] - typeOrder[b.diff_type];
    if (t !== 0) return t;
    return a.issue_id.localeCompare(b.issue_id);
  });
  return entries;
}
