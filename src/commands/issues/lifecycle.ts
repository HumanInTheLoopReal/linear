import type { Command } from "commander";
import { resolveReasonInput } from "../../common/body-input.js";
import type { CommandContext } from "../../common/context.js";
import { createContext, getRootOpts } from "../../common/context.js";
import { invalidParameterError } from "../../common/errors.js";
import { handleCommand, outputResult } from "../../common/output.js";
import { resolveIssueId } from "../../resolvers/issue-resolver.js";
import { resolveStateIdByType } from "../../resolvers/status-resolver.js";
import { createComment } from "../../services/comment-service.js";
import {
  findNewlyUnblockedByClose,
  type NewlyUnblockedIssue,
} from "../../services/issue-relation-service.js";
import { getIssue, updateIssue } from "../../services/issue-service.js";
import {
  claimReadyIssue,
  listNextIssues,
} from "../../services/next-service.js";

/** The issue fields shared by lifecycle confirmation formatters. */
export interface TransitionRowShape {
  identifier: string;
  title: string;
}

/** A dependent freed by a close. */
export type NewlyUnblockedRow = NewlyUnblockedIssue;

/** The next issue auto-claimed by `close --claim-next`. */
export interface ClaimedNextRow {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  assignee_id: string;
  state_id: string;
}

export function formatIssueClose(
  rows: TransitionRowShape[],
  reason?: string,
): string {
  if (rows.length === 0) return "\nNo issues closed.\n\n";
  const suffix = reason ?? "Closed";
  const lines = rows.map(
    (row) => `✓ Closed ${row.identifier} — ${row.title}: ${suffix}`,
  );
  return `${lines.join("\n")}\n`;
}

export function formatNewlyUnblocked(rows: NewlyUnblockedRow[]): string {
  if (rows.length === 0) return "";
  const lines = ["", "Newly unblocked:"];
  for (const row of rows) {
    lines.push(`  • ${row.identifier} — ${row.title} (P${row.priority})`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatClaimedNext(claimed: ClaimedNextRow | null): string {
  if (claimed === null) {
    return "\n✨ No ready issues available to claim.\n";
  }
  return `✓ Auto-claimed next ready issue: ${claimed.identifier} — ${claimed.title} (P${claimed.priority})\n`;
}

export function formatIssueReopen(rows: TransitionRowShape[]): string {
  if (rows.length === 0) return "\nNo issues reopened.\n\n";
  const lines = rows.map((row) => `↻ Reopened ${row.identifier}`);
  return `${lines.join("\n")}\n`;
}

async function transitionIssues(
  ctx: CommandContext,
  issueIds: string[],
  stateType: "completed" | "unstarted",
  reason?: string,
): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const id of issueIds) {
    const issueId = await resolveIssueId(ctx.sdk, id);
    const issue = await getIssue(ctx.gql, issueId);
    const teamId = "team" in issue && issue.team ? issue.team.id : undefined;
    if (!teamId) {
      throw new Error(`Unable to determine team for issue ${id}`);
    }
    const stateId = await resolveStateIdByType(ctx.sdk, teamId, stateType);
    if (reason) {
      await createComment(ctx.gql, { issueId, body: reason });
    }
    results.push(await updateIssue(ctx.gql, issueId, { stateId }));
  }
  return results;
}

async function claimNextReadyIssue(
  ctx: CommandContext,
): Promise<ClaimedNextRow | null> {
  const candidates = await listNextIssues(ctx.gql, { limit: 1 });
  if (candidates.length === 0) return null;
  const target = candidates[0];
  const startedStateId = await resolveStateIdByType(
    ctx.sdk,
    target.team.id,
    "started",
  );
  const result = await claimReadyIssue(ctx.gql, target, startedStateId);
  return {
    id: result.id,
    identifier: result.identifier,
    title: target.title,
    priority: target.priority,
    assignee_id: result.assignee_id,
    state_id: result.state_id,
  };
}

export function registerIssueLifecycleCommands(issues: Command): void {
  issues
    .command("close [issues...]")
    .alias("done")
    .description("close one or more issues (sets state to completed)")
    .option(
      "-r, --reason <text>",
      "reason for closing (added as a comment on each issue)",
    )
    .option(
      "--reason-file <path>",
      "read close reason from a file (use - for stdin)",
    )
    .option("--reason-stdin", "read close reason from stdin", false)
    .option(
      "--suggest-next",
      "after closing, report the dependents this close newly unblocked (id/title/priority); single issue only",
    )
    .option(
      "--claim-next",
      "after closing, claim the next highest-priority ready issue workspace-wide (started + assignee = viewer); one controller must own queue-drain",
    )
    .addHelpText(
      "after",
      `\n--suggest-next (single issue only) prints the issues this close just freed — those whose only remaining open blocker was the issue you closed. JSON augments the envelope to { closed, unblocked } when any were freed, else stays the plain closed array.\n\n--claim-next drains the queue: after closing it picks the single highest-priority ready issue (no active blockers, any team) and claims it (started + assignee = viewer). Linear has no compare-and-swap claim, so one controller must own concurrent queue selection. JSON augments the envelope to { closed, claimed } when one is claimed, else stays the plain closed array; text appends "✓ Auto-claimed next ready issue: …" or "✨ No ready issues available to claim.". May be combined with --suggest-next — the JSON envelope then carries both { closed, unblocked?, claimed? } keys.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issueIds, options, command] = args as [
          string[],
          {
            reason?: string;
            reasonFile?: string;
            reasonStdin?: boolean;
            suggestNext?: boolean;
            claimNext?: boolean;
          },
          Command,
        ];
        if (issueIds.length === 0) {
          throw invalidParameterError(
            "<issues>",
            "at least one issue ID is required",
          );
        }
        if (options.suggestNext && issueIds.length > 1) {
          throw invalidParameterError(
            "--suggest-next",
            "only works when closing a single issue",
          );
        }

        const reason = resolveReasonInput(options);
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const results = await transitionIssues(
          ctx,
          issueIds,
          "completed",
          reason,
        );

        if (results.length > 0 && (options.suggestNext || options.claimNext)) {
          const unblocked = options.suggestNext
            ? await findNewlyUnblockedByClose(
                ctx.gql,
                (results[0] as { id: string }).id,
              )
            : [];
          const claimed = options.claimNext
            ? await claimNextReadyIssue(ctx)
            : null;

          const hasUnblocked = unblocked.length > 0;
          if (hasUnblocked || claimed !== null) {
            const envelope: {
              closed: typeof results;
              unblocked?: NewlyUnblockedRow[];
              claimed?: ClaimedNextRow;
            } = { closed: results };
            if (hasUnblocked) envelope.unblocked = unblocked;
            if (claimed !== null) envelope.claimed = claimed;
            outputResult(
              envelope,
              (value) =>
                formatIssueClose(value.closed as TransitionRowShape[], reason) +
                formatNewlyUnblocked(value.unblocked ?? []) +
                (options.claimNext
                  ? formatClaimedNext(value.claimed ?? null)
                  : ""),
              rootOpts,
            );
            return;
          }

          if (options.claimNext) {
            outputResult(
              results,
              (rows) =>
                formatIssueClose(rows as TransitionRowShape[], reason) +
                formatClaimedNext(null),
              rootOpts,
            );
            return;
          }
        }

        outputResult(
          results,
          (rows) => formatIssueClose(rows as TransitionRowShape[], reason),
          rootOpts,
        );
      }),
    );

  issues
    .command("reopen <issues...>")
    .description("reopen one or more closed issues (sets state to unstarted)")
    .option(
      "-r, --reason <text>",
      "reason for reopening (added as a comment on each issue)",
    )
    .option(
      "--reason-file <path>",
      "read reopen reason from a file (use - for stdin)",
    )
    .option("--reason-stdin", "read reopen reason from stdin", false)
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issueIds, options, command] = args as [
          string[],
          {
            reason?: string;
            reasonFile?: string;
            reasonStdin?: boolean;
          },
          Command,
        ];
        const reason = resolveReasonInput(options);
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const results = await transitionIssues(
          ctx,
          issueIds,
          "unstarted",
          reason,
        );
        outputResult(
          results,
          (rows) => formatIssueReopen(rows as TransitionRowShape[]),
          rootOpts,
        );
      }),
    );
}
