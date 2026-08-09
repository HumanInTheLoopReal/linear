import type { Command } from "commander";
import { createContext, getRootOpts } from "../../common/context.js";
import { invalidParameterError } from "../../common/errors.js";
import { handleCommand, outputResult } from "../../common/output.js";
import { resolveIssueId } from "../../resolvers/issue-resolver.js";
import { getIssueHistory } from "../../services/history-service.js";

export interface HistoryEventShape {
  id: string;
  createdAt: string;
  actor: { name?: string | null; displayName?: string | null } | null;
  fromState: { name: string } | null;
  toState: { name: string } | null;
  fromPriority: number | null;
  toPriority: number | null;
  fromTitle: string | null;
  toTitle: string | null;
  fromAssignee: { displayName?: string | null; name?: string | null } | null;
  toAssignee: { displayName?: string | null; name?: string | null } | null;
  fromParent: { identifier: string } | null;
  toParent: { identifier: string } | null;
  addedLabels: Array<{ name: string }>;
  removedLabels: Array<{ name: string }>;
  updatedDescription: boolean;
  relationChanges: Array<{ identifier: string; type: string }>;
  archived: boolean | null;
  fromEstimate: number | null;
  toEstimate: number | null;
  fromDueDate: string | null;
  toDueDate: string | null;
  fromCycle: { name: string | null; number: number } | null;
  toCycle: { name: string | null; number: number } | null;
  fromProject: { name: string } | null;
  toProject: { name: string } | null;
}

interface IssueHistoryResultShape {
  issue: { identifier: string };
  events: HistoryEventShape[];
  total: number;
}

export function historyTs(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

export function historyActor(actor: HistoryEventShape["actor"]): string {
  return actor?.displayName ?? actor?.name ?? "(system)";
}

function humanizeRelationChange(change: {
  identifier: string;
  type: string;
}): string {
  const relations: Record<string, string> = { b: "blocks" };
  const action =
    change.type[0] === "a"
      ? "added"
      : change.type[0] === "r"
        ? "removed"
        : null;
  const relation = relations[change.type.slice(1)];
  if (action && relation) {
    return `relation ${action}: ${relation} ${change.identifier}`;
  }
  return `relation changed (${change.type}): ${change.identifier}`;
}

export function describeEventChanges(event: HistoryEventShape): string[] {
  const changes: string[] = [];
  if (event.fromState || event.toState) {
    changes.push(
      `status: ${event.fromState?.name ?? "(none)"} → ${event.toState?.name ?? "(none)"}`,
    );
  }
  if (event.fromPriority !== null || event.toPriority !== null) {
    const from =
      event.fromPriority === null ? "(none)" : `P${event.fromPriority}`;
    const to = event.toPriority === null ? "(none)" : `P${event.toPriority}`;
    changes.push(`priority: ${from} → ${to}`);
  }
  if (event.fromTitle !== null || event.toTitle !== null) {
    changes.push(
      `title: "${event.fromTitle ?? ""}" → "${event.toTitle ?? ""}"`,
    );
  }
  if (event.fromAssignee || event.toAssignee) {
    const from =
      event.fromAssignee?.displayName ?? event.fromAssignee?.name ?? "(none)";
    const to =
      event.toAssignee?.displayName ?? event.toAssignee?.name ?? "(none)";
    changes.push(`assignee: ${from} → ${to}`);
  }
  if (event.fromParent || event.toParent) {
    changes.push(
      `parent: ${event.fromParent?.identifier ?? "(none)"} → ${event.toParent?.identifier ?? "(none)"}`,
    );
  }
  if (event.addedLabels.length > 0) {
    changes.push(
      `added labels: ${event.addedLabels.map((label) => label.name).join(", ")}`,
    );
  }
  if (event.removedLabels.length > 0) {
    changes.push(
      `removed labels: ${event.removedLabels.map((label) => label.name).join(", ")}`,
    );
  }
  if (event.fromEstimate !== null || event.toEstimate !== null) {
    const from =
      event.fromEstimate === null ? "(none)" : `${event.fromEstimate}`;
    const to = event.toEstimate === null ? "(none)" : `${event.toEstimate}`;
    changes.push(`estimate: ${from} → ${to}`);
  }
  if (event.fromDueDate !== null || event.toDueDate !== null) {
    changes.push(
      `due date: ${event.fromDueDate ?? "(none)"} → ${event.toDueDate ?? "(none)"}`,
    );
  }
  if (event.fromCycle || event.toCycle) {
    const cycle = (value: { name: string | null; number: number } | null) =>
      value
        ? `${value.name ?? `Cycle ${value.number}`} (#${value.number})`
        : "(none)";
    changes.push(`cycle: ${cycle(event.fromCycle)} → ${cycle(event.toCycle)}`);
  }
  if (event.fromProject || event.toProject) {
    changes.push(
      `project: ${event.fromProject?.name ?? "(none)"} → ${event.toProject?.name ?? "(none)"}`,
    );
  }
  for (const change of event.relationChanges) {
    changes.push(humanizeRelationChange(change));
  }
  if (event.archived !== null) {
    changes.push(event.archived ? "archived" : "unarchived");
  }
  if (event.updatedDescription) changes.push("description updated");
  return changes;
}

export function formatIssueHistory(result: IssueHistoryResultShape): string {
  if (result.events.length === 0) {
    return `No history found for issue ${result.issue.identifier}\n`;
  }
  const lines: string[] = [
    "",
    `📜 History for ${result.issue.identifier} (${result.events.length} events)`,
    "",
  ];
  for (let index = 0; index < result.events.length; index += 1) {
    const event = result.events[index];
    lines.push(
      `${historyTs(event.createdAt)}  by ${historyActor(event.actor)}`,
    );
    const changes = describeEventChanges(event);
    if (changes.length === 0) lines.push("  · (no field deltas recorded)");
    else for (const change of changes) lines.push(`  · ${change}`);
    if (index < result.events.length - 1) lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function registerIssueHistoryCommand(issues: Command): void {
  issues
    .command("history <issue>")
    .description("show event history for an issue")
    .option(
      "--limit <n>",
      "maximum number of history events to return (0 = all)",
      "0",
    )
    .addHelpText(
      "after",
      `\nLinear's history is event-centric — one record per change to a
field (state, priority, title, assignee, labels, parent, estimate,
due date, cycle, project, dependency edges, archive, ...). Each event
shows from/to deltas rather than the full issue state.

EVENTUAL CONSISTENCY: Linear populates issue history asynchronously.
A change made seconds ago may not appear yet, and a freshly created
issue can report "No history found" for minutes even after several
edits. Re-run later if a recent transition is missing — this is a
Linear platform limitation, not a missed event.

Results are returned in Linear's native order (newest-first).`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          { limit?: string | number },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const limitRaw = options.limit ?? "0";
        const limit =
          typeof limitRaw === "number"
            ? limitRaw
            : Number.parseInt(limitRaw, 10);
        if (Number.isNaN(limit) || limit < 0) {
          throw invalidParameterError(
            "--limit",
            "must be a non-negative integer (0 = all)",
          );
        }
        const issueId = await resolveIssueId(ctx.sdk, issue);
        outputResult(
          await getIssueHistory(ctx.gql, issueId, limit),
          formatIssueHistory,
          rootOpts,
        );
      }),
    );
}
