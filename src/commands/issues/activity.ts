import type { Command } from "commander";
import { createContext, getRootOpts } from "../../common/context.js";
import { invalidParameterError } from "../../common/errors.js";
import { handleCommand, outputResult } from "../../common/output.js";
import { resolveIssueId } from "../../resolvers/issue-resolver.js";
import {
  getIssueActivity,
  type IssueActivityResult,
} from "../../services/activity-service.js";
import {
  describeEventChanges,
  type HistoryEventShape,
  historyActor,
  historyTs,
} from "./history.js";

/**
 * Structural shape the formatter needs — deliberately looser than the
 * service's `ActivityEntry` so the two can evolve independently, matching
 * how `formatIssueHistory` is written against `IssueHistoryResultShape`.
 */
interface ActivityEntryShape {
  kind: "comment" | "event";
  id: string;
  createdAt: string;
  actor: { name?: string | null; displayName?: string | null } | null;
  body: string | null;
  parentId: string | null;
  event: HistoryEventShape | null;
}

interface ActivityResultShape {
  issue: { identifier: string };
  entries: ActivityEntryShape[];
  total: number;
}

/** First line of a comment body, clipped so the timeline stays scannable. */
function commentPreview(body: string | null): string {
  const firstLine = (body ?? "").trim().split("\n")[0] ?? "";
  if (firstLine.length <= 100) return firstLine;
  return `${firstLine.slice(0, 99)}…`;
}

export function formatIssueActivity(result: ActivityResultShape): string {
  if (result.entries.length === 0) {
    return `No activity found for issue ${result.issue.identifier}\n`;
  }
  const lines: string[] = [
    "",
    `🕓 Activity for ${result.issue.identifier} (${result.entries.length} entries)`,
    "",
  ];
  for (let index = 0; index < result.entries.length; index += 1) {
    const entry = result.entries[index];
    lines.push(
      `${historyTs(entry.createdAt)}  by ${historyActor(entry.actor)}`,
    );
    if (entry.kind === "comment") {
      lines.push(
        `  💬 ${entry.parentId ? "reply" : "comment"}: ${commentPreview(entry.body)}`,
      );
    } else if (entry.event) {
      const changes = describeEventChanges(entry.event);
      if (changes.length === 0) lines.push("  · (no field deltas recorded)");
      else for (const change of changes) lines.push(`  · ${change}`);
    }
    if (index < result.entries.length - 1) lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function registerIssueActivityCommand(issues: Command): void {
  issues
    .command("activity <issue>")
    .description(
      "chronological timeline merging comments and history events for an issue",
    )
    .option(
      "--limit <n>",
      "maximum number of timeline entries to return (0 = all)",
      "50",
    )
    .option("--after <entry-id>", "resume after this timeline entry id")
    .option("--comments-only", "exclude history events, keeping discussion")
    .addHelpText(
      "after",
      `\nOne call instead of 'issues comments' plus 'issues history': entries
are merged and sorted newest-first, each tagged kind=comment or
kind=event. Replies carry parent_id so a threaded view can be
reconstructed without a second fetch.

--after takes the id of an entry from a previous page (not an opaque
cursor), so paging is stable even though the two halves come from
separate Linear connections.

EVENTUAL CONSISTENCY: Linear populates issue history asynchronously, so
a change made seconds ago may not appear yet. Comments show up
immediately. Re-run later if a recent transition is missing.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          { limit?: string | number; after?: string; commentsOnly?: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const limitRaw = options.limit ?? "50";
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
        const result: IssueActivityResult = await getIssueActivity(
          ctx.gql,
          issueId,
          {
            limit,
            after: options.after,
            commentsOnly: Boolean(options.commentsOnly),
          },
        );
        outputResult(result, formatIssueActivity, rootOpts);
      }),
    );
}
