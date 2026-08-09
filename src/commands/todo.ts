import type { Command } from "commander";
import { resolveBodyInput, resolveReasonInput } from "../common/body-input.js";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { parsePriorityOption } from "../common/number-options.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveStateIdByType } from "../resolvers/status-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import { createComment } from "../services/comment-service.js";
import {
  createIssue,
  getIssue,
  updateIssue,
} from "../services/issue-service.js";
import { ensureWorkspaceLabel } from "../services/label-service.js";
import {
  listTodos,
  TODO_LABEL_DESCRIPTION,
  TODO_LABEL_NAME,
} from "../services/todo-service.js";
import { priorityCol, statusIcon } from "./_format.js";

export const TODO_META: DomainMeta = {
  name: "todo",
  summary: "lightweight TODO task issues (add, list, done)",
  context: [
    `Linear-Hack/Composite: a 'todo' is a regular issue carrying the workspace`,
    `label '${TODO_LABEL_NAME}'. \`todo add\` ensures the label exists and tags`,
    `the new issue; \`todo list\` filters by the label; \`todo done\` transitions`,
    `issues to the team's 'completed' state with an optional --reason comment.`,
    ``,
    `Default priority for new todos is 2 (high). Promote a todo to a 'real'`,
    `issue by relabeling or repriorinting via \`linear issues update\` — todos`,
    `and issues share the identifier space.`,
  ].join("\n"),
  arguments: {
    title: "string",
    issue: "issue identifier (UUID or ABC-123)",
  },
  seeAlso: ["issues create", "issues close", "issues list"],
};

interface TodoRowShape {
  identifier: string;
  title: string;
  priority: number;
  state: { type: string; name: string };
}

interface TodoAddedShape {
  id?: string;
  identifier?: string | null;
  title?: string | null;
}

export function formatTodoAdded(issue: TodoAddedShape): string {
  const id = issue.identifier ?? issue.id ?? "?";
  const title = issue.title ?? "";
  return `✓ Added ${id} · ${title}`.trimEnd();
}

interface TodoDoneShape {
  closed: Array<{ id: string; identifier: string }>;
  count: number;
  reason?: string;
}

export function formatTodoDone(payload: TodoDoneShape): string {
  if (!payload.closed || payload.closed.length === 0) {
    return "✓ No todos closed";
  }
  const ids = payload.closed.map((c) => c.identifier).join(", ");
  const head = `✓ Closed ${payload.count} todo(s): ${ids}`;
  return payload.reason ? `${head}\n  reason: ${payload.reason}` : head;
}

export function formatTodoList(todos: TodoRowShape[]): string {
  if (todos.length === 0) {
    return "\nNo TODOs found.\n\n";
  }

  const idWidth = Math.max(...todos.map((t) => t.identifier.length));
  const titleWidth = Math.max(...todos.map((t) => t.title.length));

  const lines: string[] = [];
  for (const t of todos) {
    const icon = statusIcon(t.state.type);
    const pri = priorityCol(t.priority);
    const priCol = pri ? `● ${pri}` : "  ";
    const state = t.state.name || t.state.type;
    lines.push(
      `  ${icon} ${t.identifier.padEnd(idWidth)}  ${t.title.padEnd(titleWidth)}  ${priCol}  ${state}`,
    );
  }
  lines.push("");
  lines.push(`Total: ${todos.length} TODOs`);

  return `${lines.join("\n")}\n`;
}

export function setupTodoCommands(program: Command): void {
  const todo = program
    .command("todo")
    .description("manage lightweight TODO task issues");

  // Parent with no subcommand defaults to `list`.
  todo.action(
    handleCommand(async (...args: unknown[]) => {
      const [, command] = args as [unknown, Command];
      const rootOpts = getRootOpts(command);
      const ctx = createContext(rootOpts);
      const issues = await listTodos(ctx.gql, {});
      outputResult(issues, formatTodoList, rootOpts);
    }),
  );

  todo
    .command("add <title>")
    .description("create a new TODO task issue")
    .addHelpText(
      "after",
      "\nDescription input: pass -d/--description <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.",
    )
    .option(
      "--team <team>",
      "target team (defaults to team.default config / LINEAR_TEAM)",
    )
    .option(
      "-p, --priority <1-4>",
      "priority (1=Urgent, 2=High, 3=Medium, 4=Low; P1-P4 accepted)",
      "2",
    )
    .option("-d, --description <text>", "issue description")
    .option(
      "--body-file <path>",
      "read description from file (use - for stdin)",
    )
    .option("--stdin", "read description from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [title, options, command] = args as [
          string,
          {
            team?: string;
            priority: string;
            description?: string;
            bodyFile?: string;
            stdin?: boolean;
          },
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const teamKey = options.team ?? getDefaultTeam();
        if (!teamKey) {
          throw invalidParameterError(
            "--team",
            "no team provided — pass --team <key>, set LINEAR_TEAM, or run `linear config set team.default <key>`",
          );
        }
        const teamId = await resolveTeamId(ctx.sdk, teamKey);
        const labelId = await ensureWorkspaceLabel(
          ctx.gql,
          TODO_LABEL_NAME,
          TODO_LABEL_DESCRIPTION,
        );
        const priority = parsePriorityOption(options.priority);
        const resolvedDescription = resolveBodyInput(options);
        const result = await createIssue(ctx.gql, {
          teamId,
          title,
          priority,
          labelIds: [labelId],
          ...(resolvedDescription !== undefined
            ? { description: resolvedDescription }
            : {}),
        });
        outputResult(result, formatTodoAdded, getRootOpts(command));
      }),
    );

  todo
    .command("list")
    .description(
      "list TODO task issues (open by default; --all to include closed)",
    )
    .option("-a, --all", "include closed todos", false)
    .option("--team <team>", "scope to one team (key, name, or UUID)")
    .option("-n, --limit <n>", "max results", (v) => Number.parseInt(v, 10))
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          { all: boolean; team?: string; limit?: number },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;
        const issues = await listTodos(ctx.gql, {
          all: options.all,
          teamId,
          limit: options.limit ?? 50,
        });
        outputResult(issues, formatTodoList, rootOpts);
      }),
    );

  todo
    .command("done <issues...>")
    .description("close one or more TODO task issues (sets state to completed)")
    .option(
      "-r, --reason <text>",
      "reason for closing (added as a comment on each issue)",
    )
    .option(
      "--reason-file <path>",
      "read close reason from a file (use - for stdin)",
    )
    .option("--reason-stdin", "read close reason from stdin", false)
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
        if (issueIds.length === 0) {
          throw invalidParameterError(
            "<issues>",
            "at least one issue ID is required",
          );
        }
        const reason = resolveReasonInput(options);
        const ctx = createContext(getRootOpts(command));
        const closed: Array<{ id: string; identifier: string }> = [];
        for (const id of issueIds) {
          const issueId = await resolveIssueId(ctx.sdk, id);
          const issue = await getIssue(ctx.gql, issueId);
          const teamId =
            "team" in issue && issue.team ? issue.team.id : undefined;
          if (!teamId) {
            throw new Error(`Unable to determine team for issue ${id}`);
          }
          const stateId = await resolveStateIdByType(
            ctx.sdk,
            teamId,
            "completed",
          );
          if (reason) {
            await createComment(ctx.gql, {
              issueId,
              body: reason,
            });
          }
          await updateIssue(ctx.gql, issueId, { stateId });
          closed.push({ id: issueId, identifier: issue.identifier });
        }
        outputResult(
          { closed, count: closed.length, reason },
          formatTodoDone,
          getRootOpts(command),
        );
      }),
    );

  todo
    .command("usage")
    .description("show detailed usage for todo")
    .action(() => {
      console.log(formatDomainUsage(todo, TODO_META));
    });
}
