import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import type { UpdatedIssue } from "../common/types.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { wakeIssue } from "../services/deferred-service.js";

export function formatWoke(issues: UpdatedIssue[]): string {
  if (!issues || issues.length === 0) {
    return "✓ No issues to wake";
  }
  return issues.map((i) => `✓ Awoke ${i.identifier ?? i.id}`).join("\n");
}

export const WAKE_META: DomainMeta = {
  name: "wake",
  summary:
    "restore one or more deferred issues to `next` visibility by stripping the `deferred` labels",
  context: [
    "wake removes the Linear-Hack `deferred` label and any",
    "`deferred-until:<YYYY-MM-DD>` label from each issue, restoring it to",
    "`linear next` visibility immediately. it is the inverse of `snooze`.",
    "",
    "issues that carry no deferral labels are skipped with a stderr",
    "warning — they are already awake, so the JSON output only contains",
    "issues that were actually changed.",
  ].join("\n"),
  arguments: {
    issue: "issue identifier (UUID or ABC-123)",
  },
  seeAlso: ["snooze", "next"],
};

export function setupWakeCommands(program: Command): void {
  const wake = program
    .command("wake <issues...>")
    .description("restore one or more deferred issues to `next` visibility")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are
supported. Issues that are not currently deferred are skipped with a
stderr warning (non-fatal).`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issueIds, _options, command] = args as [
          string[],
          Record<string, never>,
          Command,
        ];

        if (!issueIds || issueIds.length === 0) {
          throw invalidParameterError(
            "<issues>",
            "at least one issue ID is required",
          );
        }

        const ctx = createContext(getRootOpts(command));

        const woke: UpdatedIssue[] = [];
        for (const id of issueIds) {
          const issueId = await resolveIssueId(ctx.sdk, id);
          const outcome = await wakeIssue(ctx.gql, issueId);
          if (outcome.status === "woke") {
            woke.push(outcome.issue);
          } else {
            console.error(
              `Warning: ${outcome.issue_identifier} is not deferred; skipping.`,
            );
          }
        }

        outputResult(woke, formatWoke, getRootOpts(command));
      }),
    );

  wake
    .command("usage")
    .description("show detailed usage for wake")
    .action(() => {
      console.log(formatDomainUsage(wake, WAKE_META));
    });
}
