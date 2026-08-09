import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveUserId } from "../resolvers/user-resolver.js";
import { updateIssue } from "../services/issue-service.js";

/**
 * `linear assign <id> <user>` — top-level shortcut for
 * `linear issues update <id> --assignee <user>`.
 *
 * Empty-string second arg unassigns.
 */

export const ASSIGN_META: DomainMeta = {
  name: "assign",
  summary:
    "assign an issue to a user (shorthand for `issues update --assignee`)",
  context: [
    "Resolves the issue + the user, then updates the issue's assignee.",
    "Pass an empty string to unassign: `linear assign ENG-1 ''`.",
    "Use `@me` (or `@self` / `@viewer`) to assign to the currently",
    "authenticated user — handy for agents that don't know their own",
    "email/UUID. The shortcut works anywhere a user is resolved",
    "(e.g. `linear next --assignee @me`).",
    "",
    "Top-level shortcut for `linear issues update <id> --assignee <user>`;",
    "the full long form remains available.",
  ].join("\n"),
  arguments: {
    id: "issue identifier (e.g. ENG-1) or UUID",
    user: "display name, email, UUID, `@me`/`@self`/`@viewer`, or empty string to unassign",
  },
  seeAlso: ["issues update"],
};

export interface AssignResult {
  issue: { id: string; identifier: string; title: string };
  assignee: { id: string; name: string } | null;
  action: "assigned" | "unassigned";
}

export function formatAssign(result: AssignResult): string {
  if (result.action === "unassigned") {
    return `✓ Unassigned ${result.issue.identifier}\n`;
  }
  return `✓ Assigned ${result.issue.identifier} to ${result.assignee?.name ?? "<unknown>"}\n`;
}

export function setupAssignCommands(program: Command): void {
  program
    .command("assign <id> <user>")
    .description(
      "assign an issue to a user (`@me`/`@self`/`@viewer` = current user; empty user-string unassigns)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [id, user, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const issueId = await resolveIssueId(ctx.sdk, id);
        const isUnassign = user.trim() === "";
        const assigneeId = isUnassign
          ? null
          : await resolveUserId(ctx.sdk, user);

        const updated = await updateIssue(ctx.gql, issueId, {
          assigneeId,
        });

        const result: AssignResult = {
          issue: {
            id: updated.id,
            identifier: updated.identifier,
            title: updated.title,
          },
          assignee: isUnassign
            ? null
            : {
                id: assigneeId as string,
                name: updated.assignee?.name ?? user,
              },
          action: isUnassign ? "unassigned" : "assigned",
        };

        outputResult(result, formatAssign, rootOpts);
      }),
    );

  program
    .command("assign-usage")
    .description("show detailed usage for assign")
    .action(() => {
      const cmd = program.commands.find((c) => c.name() === "assign");
      if (cmd) console.log(formatDomainUsage(cmd, ASSIGN_META));
    });
}
