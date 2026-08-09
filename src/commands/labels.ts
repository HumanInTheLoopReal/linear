import type { Command } from "commander";
import { getDefaultTeam } from "../common/config-store.js";
import { confirmGuard, proceedConfirmed } from "../common/confirm.js";
import {
  type CommandOptions,
  createContext,
  getRootOpts,
} from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult, parseLimit } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import type { IssueLabelUpdateInput } from "../gql/graphql.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import {
  resolveLabelId,
  resolveWorkspaceLabelId,
} from "../resolvers/label-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import { getIssue } from "../services/issue-service.js";
import {
  addLabelToIssues,
  type CreateLabelResult,
  createWorkspaceLabel,
  deleteWorkspaceLabel,
  ensureLabelForIssueTeam,
  ensureWorkspaceLabel,
  getLabelsForIssue,
  type LabelOpResult,
  type LabelScope,
  type LabelType,
  listLabels,
  listProjectLabels,
  propagateLabelToChildren,
  removeLabelFromIssues,
  tallyLabelUsage,
  type UpdateLabelResult,
  updateWorkspaceLabel,
} from "../services/label-service.js";

export function formatLabelOps(
  results: LabelOpResult[],
  verb: "Added" | "Removed" | "Propagated",
): string {
  if (!results || results.length === 0) {
    return `✓ No labels ${verb.toLowerCase()}`;
  }
  const preposition = verb === "Removed" ? "from" : "to";
  return results
    .map((r) => {
      const icon = r.changed ? "✓" : "·";
      const noop = r.changed ? "" : " (no change)";
      return `${icon} ${verb} label '${r.label}' ${preposition} ${r.issue_identifier}${noop}`;
    })
    .join("\n");
}

export function formatLabelsForIssue(labelNames: string[]): string {
  if (!labelNames || labelNames.length === 0) {
    return "🏷 No labels assigned";
  }
  const lines: string[] = [`🏷 Labels (${labelNames.length}):`];
  for (const name of labelNames) {
    lines.push(`  ${name}`);
  }
  return lines.join("\n");
}

interface ListLabelsOptions extends CommandOptions {
  team?: string;
  type?: string;
  scope?: string;
  limit: string;
  after?: string;
  withCounts?: boolean;
}

function parseLabelType(value?: string): LabelType {
  if (value === undefined || value === "issue" || value === "project") {
    return value ?? "issue";
  }

  throw invalidParameterError("--type", 'must be one of "issue" or "project"');
}

function parseLabelScope(value?: string): LabelScope | undefined {
  if (value === undefined || value === "workspace" || value === "team") {
    return value;
  }

  throw invalidParameterError(
    "--scope",
    'must be one of "workspace" or "team"',
  );
}

export const LABELS_META: DomainMeta = {
  name: "labels",
  summary: "categorization tags for issues and projects",
  context: [
    "issue labels can exist at workspace level or be scoped to a specific",
    "team. project labels are workspace-level only. use with issues",
    "create/update --labels and projects create/update --labels.",
    "",
    "two ways to bring a new label into existence:",
    "  linear labels create <name>           explicit, idempotent",
    "  linear labels add <issue> <name>      auto-create-on-add",
  ].join("\n"),
  arguments: {},
  seeAlso: [
    "issues create --labels",
    "issues update --labels",
    "projects create --labels",
    "projects update --labels",
  ],
};

export function formatLabelCreate(result: CreateLabelResult): string {
  if (result.created) {
    return `✓ Created label '${result.name}' (id: ${result.id})\n`;
  }
  return `· Label '${result.name}' already exists (id: ${result.id})\n`;
}

export function formatLabelUpdate(result: UpdateLabelResult): string {
  return `✓ Updated label '${result.name}' (id: ${result.id})\n`;
}

export function formatLabelDelete(result: {
  id: string;
  name: string;
}): string {
  return `✓ Deleted label '${result.name}' (id: ${result.id})\n`;
}

export function formatLabelList(result: {
  nodes: Array<{ name: string; description?: string; count?: number }>;
}): string {
  const labels = result.nodes;
  if (labels.length === 0) {
    return "\n🏷 No labels found.\n\n";
  }

  const nameWidth = Math.max(...labels.map((l) => l.name.length));
  const lines: string[] = ["", `🏷 Labels (${labels.length}):`];
  for (const l of labels) {
    // `--with-counts` attaches per-label issue usage (lin-ov30.3); render it
    // as a `(N issues)` column between the name and the description.
    const count =
      l.count !== undefined
        ? `  (${l.count} issue${l.count === 1 ? "" : "s"})`
        : "";
    const desc = l.description ? `  ${l.description}` : "";
    lines.push(`  ${l.name.padEnd(nameWidth)}${count}${desc}`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export function setupLabelsCommands(program: Command): void {
  const labels = program.command("labels").description("Label operations");

  labels.action(() => labels.help());

  labels
    .command("list")
    .description("list available labels")
    .option("--type <type>", "label type: issue (default) or project", "issue")
    .option("--scope <scope>", "issue label scope: workspace or team")
    .option("--team <team>", "filter by team (key, name, or UUID)")
    .option("-l, --limit <n>", "max results", "50")
    .option("--after <cursor>", "cursor for next page")
    .option(
      "--with-counts",
      "annotate each label with the number of issues using it. Sweeps all issues once; issue labels only",
    )
    .addHelpText(
      "after",
      `\n--with-counts attaches a per-label issue count. Linear's API has no per-label aggregate, so this sweeps every issue once and tallies client-side (one pass, independent of label count) — counts span all workflow states, excluding archived issues. Not valid with --type project (project labels are not applied to issues).`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [ListLabelsOptions, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const type = parseLabelType(options.type);
        const scope = parseLabelScope(options.scope);
        const pagination = {
          limit: parseLimit(options.limit),
          after: options.after,
          scope,
        };

        if (type === "project") {
          if (options.team) {
            throw invalidParameterError(
              "--team",
              "cannot be used with --type project because project labels are workspace-scoped",
            );
          }

          if (scope) {
            throw invalidParameterError(
              "--scope",
              "cannot be used with --type project because project labels are always workspace-scoped",
            );
          }

          if (options.withCounts) {
            throw invalidParameterError(
              "--with-counts",
              "counts issue-label usage, which does not apply to project labels (they are attached to projects, not issues)",
            );
          }

          outputResult(
            await listProjectLabels(ctx.gql, pagination),
            formatLabelList,
            rootOpts,
          );
          return;
        }

        const teamKey =
          scope === "workspace"
            ? options.team
            : (options.team ?? getDefaultTeam() ?? undefined);

        if (scope === "team" && !teamKey) {
          throw invalidParameterError("--scope", "team scope requires --team");
        }

        if (scope === "workspace" && options.team) {
          throw invalidParameterError(
            "--team",
            "cannot be used with --scope workspace",
          );
        }

        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;

        const labelList = await listLabels(ctx.gql, teamId, pagination);

        if (options.withCounts) {
          // One issue sweep tallies usage for every label by id; absent ids
          // (labels with no issues) default to 0.
          const usage = await tallyLabelUsage(ctx.gql);
          outputResult(
            {
              ...labelList,
              nodes: labelList.nodes.map((label) => ({
                ...label,
                count: usage.get(label.id) ?? 0,
              })),
            },
            formatLabelList,
            rootOpts,
          );
          return;
        }

        outputResult(labelList, formatLabelList, rootOpts);
      }),
    );

  labels
    .command("create <name>")
    .description("create a workspace-wide label by name (idempotent)")
    .option(
      "--description <text>",
      "human-readable description (defaults to `Label '<name>'.`)",
    )
    .addHelpText(
      "after",
      `\nIdempotent: if a label with this name already exists, returns its id
without erroring. The label is created at workspace scope (visible to all
teams), matching the auto-create-on-add path used by 'labels add'.

'provides:*' labels are reserved — use 'issues ship <capability>' to
publish a capability instead.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [rawName, options, command] = args as [
          string,
          { description?: string },
          Command,
        ];
        const name = rawName.trim();
        if (name.length === 0) {
          throw invalidParameterError("<name>", "label name cannot be empty");
        }
        if (name.startsWith("provides:")) {
          throw invalidParameterError(
            "<name>",
            `'provides:' labels are reserved for cross-project capabilities. Hint: use 'issues ship ${name.slice("provides:".length)}' instead`,
          );
        }
        const ctx = createContext(getRootOpts(command));
        const result = await createWorkspaceLabel(
          ctx.gql,
          name,
          options.description ?? `Label '${name}'.`,
        );
        outputResult(result, formatLabelCreate, getRootOpts(command));
      }),
    );

  labels
    .command("update <label>")
    .description("rename or re-describe an existing label")
    .option("--name <name>", "new label name")
    .option("--description <text>", "new description")
    .addHelpText(
      "after",
      `\nOnly the fields you pass change; the label keeps every issue it is
already applied to, so a rename propagates everywhere at once.

Pass at least one of --name / --description. <label> accepts a label name
or UUID.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [label, options, command] = args as [
          string,
          { name?: string; description?: string },
          Command,
        ];
        const input: IssueLabelUpdateInput = {};
        if (options.name !== undefined) {
          const name = options.name.trim();
          if (name.length === 0) {
            throw invalidParameterError("--name", "label name cannot be empty");
          }
          if (name.startsWith("provides:")) {
            throw invalidParameterError(
              "--name",
              `'provides:' labels are reserved for cross-project capabilities. Hint: use 'issues ship ${name.slice("provides:".length)}' instead`,
            );
          }
          input.name = name;
        }
        if (options.description !== undefined) {
          input.description = options.description;
        }
        if (Object.keys(input).length === 0) {
          throw invalidParameterError(
            "--name/--description",
            "pass at least one field to update",
          );
        }
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const labelId = await resolveWorkspaceLabelId(ctx.sdk, label);
        outputResult(
          await updateWorkspaceLabel(ctx.gql, labelId, input),
          formatLabelUpdate,
          rootOpts,
        );
      }),
    );

  labels
    .command("delete <label>")
    .description("permanently delete a label from the workspace")
    .option("-f, --force", "skip the confirmation prompt")
    .addHelpText(
      "after",
      `\nDeletes the label itself, removing it from every issue that carries
it. This cannot be undone — to take a label off a single issue use
'labels remove <issue> <label>' instead.

A TTY session is asked to confirm; --force and non-interactive (agent)
runs proceed without prompting.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [label, options, command] = args as [
          string,
          { force?: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const labelId = await resolveWorkspaceLabelId(ctx.sdk, label);

        const decision = await confirmGuard(
          `Permanently delete label '${label}' from every issue that carries it?`,
          { force: Boolean(options.force) },
        );
        if (!proceedConfirmed(decision)) {
          outputResult(
            { id: labelId, name: label, deleted: false },
            () => `· Left label '${label}' in place\n`,
            rootOpts,
          );
          return;
        }

        // deleteWorkspaceLabel swallows failures for the best-effort snooze GC
        // path; an explicit user verb has to report them instead.
        if (!(await deleteWorkspaceLabel(ctx.gql, labelId))) {
          throw new Error(`Failed to delete label '${label}'`);
        }
        outputResult(
          { id: labelId, name: label, deleted: true },
          formatLabelDelete,
          rootOpts,
        );
      }),
    );

  labels
    .command("add [args...]")
    .description(
      "add a label to one or more issues (last positional arg is the label; auto-creates the label if missing)",
    )
    .addHelpText(
      "after",
      `\nUsage: 'labels add <issue> [issue...] <label>'. The label is the
LAST positional arg; everything before is parsed as issue identifiers.
Idempotent: each result reports 'changed: false' when the issue already
had the label.

Label resolution: for a SINGLE target issue, a label already scoped to
that issue's team is preferred; otherwise an existing workspace label is
reused, and only if neither exists is <label> created workspace-wide
(same as 'labels create <label>'). Multi-issue adds may span teams, so
they always use the workspace label.

'provides:*' labels are reserved — use 'issues ship <capability>' to
publish a capability instead.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [allArgs, , command] = args as [string[], unknown, Command];
        if (!allArgs || allArgs.length < 2) {
          throw invalidParameterError(
            "<args>",
            "expected at least one issue ID and a label",
          );
        }
        const label = allArgs[allArgs.length - 1].trim();
        const rawIssueIds = allArgs.slice(0, -1);
        if (label.length === 0) {
          throw invalidParameterError("<label>", "label cannot be empty");
        }
        if (label.startsWith("provides:")) {
          throw invalidParameterError(
            "<label>",
            `'provides:' labels are reserved for cross-project capabilities. Hint: use 'issues ship ${label.slice("provides:".length)}' instead`,
          );
        }

        const ctx = createContext(getRootOpts(command));
        const issueIds = await Promise.all(
          rawIssueIds.map((id) => resolveIssueId(ctx.sdk, id)),
        );
        // Team-scope inference (lin-ay7q): for a single target issue, prefer a
        // label already scoped to that issue's team before the workspace
        // find-or-create. Multi-issue adds may span teams, so a single shared
        // label id has to apply to all — those keep the workspace path.
        let labelId: string;
        if (issueIds.length === 1) {
          const issue = await getIssue(ctx.gql, issueIds[0]);
          labelId = await ensureLabelForIssueTeam(
            ctx.gql,
            label,
            issue.team.id,
            `Label '${label}'.`,
          );
        } else {
          labelId = await ensureWorkspaceLabel(
            ctx.gql,
            label,
            `Label '${label}'.`,
          );
        }
        const results = await addLabelToIssues(
          ctx.gql,
          issueIds,
          labelId,
          label,
        );
        outputResult(
          results,
          (data) => formatLabelOps(data, "Added"),
          getRootOpts(command),
        );
      }),
    );

  labels
    .command("remove [args...]")
    .description(
      "remove a label from one or more issues (last positional arg is the label)",
    )
    .addHelpText(
      "after",
      `\nUsage: 'labels remove <issue> [issue...] <label>'. The label is the
LAST positional arg; everything before is parsed as issue identifiers.
Idempotent: each result reports 'changed: false' when the issue did
not have the label.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [allArgs, , command] = args as [string[], unknown, Command];
        if (!allArgs || allArgs.length < 2) {
          throw invalidParameterError(
            "<args>",
            "expected at least one issue ID and a label",
          );
        }
        const label = allArgs[allArgs.length - 1].trim();
        const rawIssueIds = allArgs.slice(0, -1);
        if (label.length === 0) {
          throw invalidParameterError("<label>", "label cannot be empty");
        }

        const ctx = createContext(getRootOpts(command));
        const [labelId, ...issueIds] = await Promise.all([
          resolveLabelId(ctx.sdk, label),
          ...rawIssueIds.map((id) => resolveIssueId(ctx.sdk, id)),
        ]);
        const results = await removeLabelFromIssues(
          ctx.gql,
          issueIds,
          labelId,
          label,
        );
        outputResult(
          results,
          (data) => formatLabelOps(data, "Removed"),
          getRootOpts(command),
        );
      }),
    );

  labels
    .command("show <issue>")
    .description("list the labels currently assigned to a single issue")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const labelNames = await getLabelsForIssue(ctx.gql, issueId);
        outputResult(labelNames, formatLabelsForIssue, getRootOpts(command));
      }),
    );

  labels
    .command("propagate <parent> <label>")
    .description("apply a label to every direct child of a parent issue")
    .addHelpText(
      "after",
      `\nAuto-creates the label workspace-wide on first use. Idempotent per
child: a child already carrying the label reports 'changed: false'.
'provides:*' labels are reserved.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [parent, label, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const trimmed = label.trim();
        if (trimmed.length === 0) {
          throw invalidParameterError("<label>", "label cannot be empty");
        }
        if (trimmed.startsWith("provides:")) {
          throw invalidParameterError(
            "<label>",
            `'provides:' labels are reserved for cross-project capabilities. Hint: use 'issues ship ${trimmed.slice("provides:".length)}' instead`,
          );
        }
        const ctx = createContext(getRootOpts(command));
        const parentId = await resolveIssueId(ctx.sdk, parent);
        const labelId = await ensureWorkspaceLabel(
          ctx.gql,
          trimmed,
          `Label '${trimmed}'.`,
        );
        const results = await propagateLabelToChildren(
          ctx.gql,
          parentId,
          labelId,
          trimmed,
        );
        outputResult(
          results,
          (data) => formatLabelOps(data, "Propagated"),
          getRootOpts(command),
        );
      }),
    );

  labels
    .command("usage")
    .description("show detailed usage for labels")
    .action(() => {
      console.log(formatDomainUsage(labels, LABELS_META));
    });
}
