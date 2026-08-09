import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveStateIdByType } from "../resolvers/status-resolver.js";
import {
  executeSwitch,
  prepareSwitch,
  type SwitchResult,
} from "../services/switch-service.js";

export function formatSwitchResult(result: SwitchResult): string {
  const lines: string[] = [];
  if (result.old) {
    const detector = result.oldSource === "auto" ? " (auto-detected)" : "";
    lines.push(
      `✓ Moved ${result.old.identifier ?? result.old.id} back to Todo${detector}`,
    );
  } else if (result.oldSource === "explicit") {
    lines.push("✓ Old issue already out of In Progress — left alone");
  } else {
    lines.push("○ No in-progress issue detected — old-side skipped");
  }
  lines.push(
    `✓ Started ${result.new.identifier ?? result.new.id} (assigned to you)`,
  );
  return lines.join("\n");
}

export const SWITCH_META: DomainMeta = {
  name: "switch",
  summary: "swap in-progress focus from current issue to <new> in one call",
  context: [
    "Mid-flight task interruption verb (lin-jkzw). Detects your current",
    "in-progress issue automatically, moves it back to its team's Todo",
    "state, and claims+starts <new>.",
    "",
    "When more than one of your issues is in progress, pass `--from <id>`",
    "to disambiguate. When no in-progress is detected and `--from` is",
    "omitted, the old-side step is silently skipped — `switch` still",
    "claims and starts <new>.",
    "",
    "Pairs with `linear start <id>` (lin-nzqu) — `start` is the no-handoff",
    "case (just claim+start, no old issue to revert).",
  ].join("\n"),
  arguments: {
    new: "issue identifier to switch INTO (UUID or ABC-123)",
  },
  seeAlso: ["start", "snooze", "issues update"],
};

interface SwitchOpts {
  from?: string;
}

export function setupSwitchCommands(program: Command): void {
  const swap = program
    .command("switch <new>")
    .description("swap your in-progress focus from the current issue to <new>")
    .option(
      "--from <issue>",
      "explicit 'old' issue identifier (required when multiple in-progress)",
    )
    .addHelpText(
      "after",
      `\nExamples:
  linear switch ENG-456              auto-detect current in-progress and swap
  linear switch ENG-456 --from ENG-1 explicit handoff: revert ENG-1, start ENG-456

Notes:
  - The "old" issue is moved to its team's unstarted (Todo) state, NOT
    snoozed — it remains visible in \`linear next\`. Use \`linear snooze\`
    when you want to hide it instead.
  - When no in-progress issue is detected and --from is omitted, the old
    side is silently skipped; <new> is still claimed and started.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [newId, options, command] = args as [string, SwitchOpts, Command];
        if (!newId) {
          throw invalidParameterError("<new>", "issue identifier is required");
        }
        const ctx = createContext(getRootOpts(command));
        const [newIssueId, fromIssueId] = await Promise.all([
          resolveIssueId(ctx.sdk, newId),
          options.from
            ? resolveIssueId(ctx.sdk, options.from)
            : Promise.resolve(undefined),
        ]);
        const plan = await prepareSwitch(ctx.gql, newIssueId, {
          fromIssueId,
        });
        const [startedStateId, unstartedStateId] = await Promise.all([
          resolveStateIdByType(ctx.sdk, plan.newTeamId, "started"),
          plan.oldNeedsUnstarted && plan.oldTeamId
            ? resolveStateIdByType(ctx.sdk, plan.oldTeamId, "unstarted")
            : Promise.resolve(undefined),
        ]);
        const result = await executeSwitch(ctx.gql, plan, {
          startedStateId,
          unstartedStateId,
        });
        outputResult(result, formatSwitchResult, getRootOpts(command));
      }),
    );

  swap
    .command("usage")
    .description("show detailed usage for switch")
    .action(() => {
      console.log(formatDomainUsage(swap, SWITCH_META));
    });
}
