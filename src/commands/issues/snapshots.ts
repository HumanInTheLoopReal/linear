import type { Command } from "commander";
import { createContext, getRootOpts } from "../../common/context.js";
import { handleCommand, outputResult } from "../../common/output.js";
import { computeDiff } from "../../services/diff-service.js";
import {
  listSnapshots,
  loadSnapshotByRef,
  writeSnapshot,
} from "../../services/snapshot-service.js";

interface SnapshotMetaShape {
  label: string;
  created_at: string;
  issue_count: number;
}

export function formatSnapshotList(result: {
  snapshots: SnapshotMetaShape[];
}): string {
  if (result.snapshots.length === 0) {
    return "No snapshots found in ~/.linear/snapshots/\n";
  }
  const lines: string[] = [`📸 Snapshots (${result.snapshots.length}):`];
  for (const snapshot of result.snapshots) {
    lines.push(
      `  · ${snapshot.label}  (${snapshot.issue_count} issues, ${snapshot.created_at.slice(0, 10)})`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatSnapshotWritten(result: {
  label: string;
  path: string;
  meta: SnapshotMetaShape;
}): string {
  return `✓ Wrote snapshot '${result.label}' (${result.meta.issue_count} issues) → ${result.path}\n`;
}

interface DiffSnapshotIssueShape {
  identifier?: string | null;
  title: string;
  status: string;
  priority: number;
  description: string;
}

interface DiffEntryShape {
  issue_id: string;
  diff_type: "added" | "modified" | "removed";
  old_value: DiffSnapshotIssueShape | null;
  new_value: DiffSnapshotIssueShape | null;
}

export function formatDiff(
  entries: DiffEntryShape[],
  fromRef: string,
  toRef: string,
): string {
  if (entries.length === 0)
    return `No changes between ${fromRef} and ${toRef}\n`;
  const added: DiffEntryShape[] = [];
  const modified: DiffEntryShape[] = [];
  const removed: DiffEntryShape[] = [];
  for (const entry of entries) {
    if (entry.diff_type === "added") added.push(entry);
    else if (entry.diff_type === "modified") modified.push(entry);
    else removed.push(entry);
  }

  const output: string[] = [
    "",
    `📊 Changes from ${fromRef} to ${toRef} (${entries.length} issues affected)`,
    "",
  ];
  if (added.length > 0) {
    output.push(`+ Added (${added.length}):`);
    for (const entry of added) {
      const identifier = entry.new_value?.identifier ?? entry.issue_id;
      output.push(
        entry.new_value
          ? `  + ${identifier}: ${entry.new_value.title}`
          : `  + ${identifier}`,
      );
    }
    output.push("");
  }
  if (modified.length > 0) {
    output.push(`~ Modified (${modified.length}):`);
    for (const entry of modified) {
      const identifier = entry.new_value?.identifier ?? entry.issue_id;
      const changes: string[] = [];
      if (entry.old_value && entry.new_value) {
        if (entry.old_value.title !== entry.new_value.title)
          changes.push("title");
        if (entry.old_value.status !== entry.new_value.status) {
          changes.push(
            `status: ${entry.old_value.status} -> ${entry.new_value.status}`,
          );
        }
        if (entry.old_value.priority !== entry.new_value.priority) {
          changes.push(
            `priority: P${entry.old_value.priority} -> P${entry.new_value.priority}`,
          );
        }
        if (entry.old_value.description !== entry.new_value.description) {
          changes.push("description");
        }
      }
      const suffix = changes.length > 0 ? ` (${changes.join(", ")})` : "";
      output.push(`  ~ ${identifier}${suffix}`);
    }
    output.push("");
  }
  if (removed.length > 0) {
    output.push(`- Removed (${removed.length}):`);
    for (const entry of removed) {
      const identifier = entry.old_value?.identifier ?? entry.issue_id;
      output.push(
        entry.old_value
          ? `  - ${identifier}: ${entry.old_value.title}`
          : `  - ${identifier}`,
      );
    }
    output.push("");
  }
  return `${output.join("\n")}\n`;
}

export function registerIssueSnapshotCommands(issues: Command): void {
  issues
    .command("snapshot [label]")
    .description(
      "capture the current issue set into ~/.linear/snapshots/<label>.jsonl for later diffing",
    )
    .option(
      "--list",
      "list existing snapshots instead of writing a new one",
      false,
    )
    .addHelpText(
      "after",
      `\nLinear has no native point-in-time issue store, so we write a local
JSONL file under ~/.linear/snapshots/. Default label is the current
ISO timestamp (colons replaced with hyphens for filesystem safety).

Use 'issues diff <from> <to>' to compare two snapshots. The ref
'HEAD' resolves to the most-recently-modified snapshot; 'live'
(for the to-ref of diff only) fetches the current state fresh.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [label, options, command] = args as [
          string | undefined,
          { list: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        if (options.list) {
          outputResult(
            { snapshots: listSnapshots() },
            formatSnapshotList,
            rootOpts,
          );
          return;
        }
        outputResult(
          await writeSnapshot(ctx.gql, label),
          formatSnapshotWritten,
          rootOpts,
        );
      }),
    );

  issues
    .command("diff <from-ref> <to-ref>")
    .description(
      "show added/modified/removed issues between two snapshots (or against 'live')",
    )
    .addHelpText(
      "after",
      `\nRefs:
  <label>  read ~/.linear/snapshots/<label>.jsonl
  HEAD     most-recently-modified snapshot
  live     fetch current state from Linear (valid for <to-ref> only)

Output shape: [{issue_id, diff_type, old_value, new_value}].
'diff_type' is one of 'added', 'modified', 'removed'.
'old_value' is null for added entries; 'new_value' is null for
removed entries. Modified entries are emitted when title, status,
priority, or description differ.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [fromRef, toRef, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const [from, to] = await Promise.all([
          loadSnapshotByRef(ctx.gql, fromRef),
          loadSnapshotByRef(ctx.gql, toRef),
        ]);
        const entries = computeDiff(from.issues, to.issues);
        outputResult(
          entries,
          (data) => formatDiff(data, fromRef, toRef),
          rootOpts,
        );
      }),
    );
}
