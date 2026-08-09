import type { Command } from "commander";
import {
  type CommandOptions,
  createContext,
  getRootOpts,
} from "../common/context.js";
import { handleCommand, outputResult, parseLimit } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { listUsers } from "../services/user-service.js";

interface ListUsersOptions extends CommandOptions {
  active?: boolean;
  limit: string;
  after?: string;
}

interface UserRowShape {
  id: string;
  name?: string | null;
  email?: string | null;
  active?: boolean | null;
}

/**
 * Render `users list`. Format:
 *
 *   <email-padded>  <name>  [active|inactive]
 *
 * Empty state: `No users found.`. Pagination total footer: `Total: N users`.
 * Email is left-aligned in a column wide enough for the longest email so
 * the name/state columns line up. Falls back to `(no email)` for users
 * whose email field is null (rare, but possible for service accounts).
 */
export function formatUserList(result: { nodes: UserRowShape[] }): string {
  if (result.nodes.length === 0) {
    return "No users found.\n";
  }
  const rows = result.nodes.map((u) => ({
    email: u.email ?? "(no email)",
    name: u.name ?? "(no name)",
    state: u.active ? "[active]" : "[inactive]",
  }));
  const emailWidth = Math.max(...rows.map((r) => r.email.length));
  const lines: string[] = [];
  for (const r of rows) {
    lines.push(`  ${r.email.padEnd(emailWidth)}  ${r.name}  ${r.state}`);
  }
  lines.push("");
  lines.push(`Total: ${result.nodes.length} users`);
  return `${lines.join("\n")}\n`;
}

export const USERS_META: DomainMeta = {
  name: "users",
  summary: "workspace members and assignees",
  context: [
    "a user is a member of the Linear workspace. users can be assigned to",
    "issues and belong to teams.",
  ].join("\n"),
  arguments: {},
  seeAlso: [],
};

export function setupUsersCommands(program: Command): void {
  const users = program.command("users").description("User operations");

  users.action(() => users.help());

  users
    .command("list")
    .description("list workspace members")
    .option("--active", "only show active users")
    .option("-l, --limit <n>", "max results", "50")
    .option("--after <cursor>", "cursor for next page")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [ListUsersOptions, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const result = await listUsers(ctx.gql, options.active || false, {
          limit: parseLimit(options.limit),
          after: options.after,
        });
        outputResult(result, formatUserList, rootOpts);
      }),
    );

  users
    .command("usage")
    .description("show detailed usage for users")
    .action(() => {
      console.log(formatDomainUsage(users, USERS_META));
    });
}
