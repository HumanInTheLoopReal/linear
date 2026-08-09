import type { Command } from "commander";
import { resolveBodyInput } from "../common/body-input.js";
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult, parseLimit } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import type { ProjectMilestoneUpdateInput } from "../gql/graphql.js";
import { resolveMilestoneId } from "../resolvers/milestone-resolver.js";
import { resolveProjectId } from "../resolvers/project-resolver.js";
import {
  createMilestone,
  getMilestone,
  listMilestones,
  updateMilestone,
} from "../services/milestone-service.js";

/**
 * The format mirrors `formatProjectList` / `formatProjectDetail` for
 * consistency: header row + optional info row + sectioned blocks.
 *
 * Linear treats project milestones as YYYY-MM-DD "TimelessDate" values;
 * `formatYmd` slices the leading 10 chars and returns "" when missing.
 */
function formatYmd(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

interface MilestoneListRowShape {
  id: string;
  name: string;
  targetDate?: string | null;
}

export function formatMilestoneList(result: {
  nodes: MilestoneListRowShape[];
}): string {
  if (result.nodes.length === 0) {
    return "No milestones found.\n";
  }
  const lines: string[] = [];
  for (const m of result.nodes) {
    const tgt = formatYmd(m.targetDate);
    lines.push(tgt ? `  · ${m.name}  → ${tgt}` : `  · ${m.name}`);
  }
  lines.push("");
  lines.push(`Total: ${result.nodes.length} milestones`);
  return `${lines.join("\n")}\n`;
}

interface MilestoneDetailShape extends MilestoneListRowShape {
  description?: string | null;
  sortOrder?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  project?: { id: string; name: string } | null;
  issues?: {
    nodes: { identifier: string; title: string }[];
  } | null;
}

export function formatMilestoneDetail(m: MilestoneDetailShape): string {
  const tgt = formatYmd(m.targetDate);
  const header = tgt ? `${m.name}   [Target: ${tgt}]` : `${m.name}`;
  const lines: string[] = [header];

  const projectName = m.project?.name ?? "(none)";
  lines.push(`Project: ${projectName}`);

  const createdYmd = formatYmd(m.createdAt);
  const updatedYmd = formatYmd(m.updatedAt);
  if (createdYmd || updatedYmd) {
    lines.push(
      `Created: ${createdYmd || "(unknown)"} · Updated: ${updatedYmd || "(unknown)"}`,
    );
  }

  const desc = (m.description ?? "").trim();
  if (desc) {
    lines.push("");
    lines.push("DESCRIPTION");
    lines.push(desc);
  }

  const issues = m.issues?.nodes ?? [];
  if (issues.length > 0) {
    lines.push("");
    lines.push(`ISSUES (${issues.length})`);
    for (const i of issues) {
      lines.push(`  · ${i.identifier}  ${i.title}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

interface MilestoneMutationShape {
  id: string;
  name?: string | null;
  project?: { name?: string | null } | null;
}

function milestoneMutationLine(
  verb: "Created" | "Updated",
  result: MilestoneMutationShape,
): string {
  const name = result.name ?? "(no name)";
  const project = result.project?.name;
  const suffix = project ? ` in ${project}` : "";
  return `${verb} milestone ${name}${suffix}\n`;
}

export function formatMilestoneCreate(result: MilestoneMutationShape): string {
  return milestoneMutationLine("Created", result);
}

export function formatMilestoneUpdate(result: MilestoneMutationShape): string {
  return milestoneMutationLine("Updated", result);
}

interface MilestoneListOptions {
  project: string;
  limit?: string;
  after?: string;
}

interface MilestoneReadOptions {
  project?: string;
  limit?: string;
}

interface MilestoneCreateOptions {
  project: string;
  description?: string;
  bodyFile?: string;
  stdin?: boolean;
  targetDate?: string;
}

interface MilestoneUpdateOptions {
  project?: string;
  name?: string;
  description?: string;
  bodyFile?: string;
  stdin?: boolean;
  targetDate?: string;
  sortOrder?: string;
}

export const MILESTONES_META: DomainMeta = {
  name: "milestones",
  summary: "progress checkpoints within projects",
  context: [
    "a milestone marks a phase or deadline within a project. milestones",
    "can have target dates and contain issues assigned to them.",
  ].join("\n"),
  arguments: {
    milestone: "milestone identifier (UUID or name)",
    name: "string",
  },
  seeAlso: [
    "issues create --project-milestone",
    "issues update --project-milestone",
  ],
};

export function setupMilestonesCommands(program: Command): void {
  const milestones = program
    .command("milestones")
    .description("Project milestone operations");

  milestones.action(() => milestones.help());

  milestones
    .command("list")
    .description("list milestones in a project")
    .requiredOption("--project <project>", "target project (required)")
    .option("-l, --limit <n>", "max results", "50")
    .option("--after <cursor>", "cursor for next page")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [MilestoneListOptions, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const projectId = await resolveProjectId(ctx.sdk, options.project);

        const milestones = await listMilestones(ctx.gql, projectId, {
          limit: parseLimit(options.limit || "50"),
          after: options.after,
        });

        outputResult(milestones, formatMilestoneList, rootOpts);
      }),
    );

  milestones
    .command("read <milestone>")
    .description("get milestone details including issues")
    .option("--project <project>", "scope name lookup to project")
    .option("--limit <n>", "max issues to fetch", "50")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [milestone, options, command] = args as [
          string,
          MilestoneReadOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const milestoneId = await resolveMilestoneId(
          ctx.gql,
          ctx.sdk,
          milestone,
          options.project,
        );

        const milestoneResult = await getMilestone(
          ctx.gql,
          milestoneId,
          parseLimit(options.limit || "50"),
        );

        outputResult(milestoneResult, formatMilestoneDetail, rootOpts);
      }),
    );

  milestones
    .command("create <name>")
    .description("create a new milestone")
    .addHelpText(
      "after",
      "\nDescription input: pass --description <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.",
    )
    .requiredOption("--project <project>", "target project (required)")
    .option("-d, --description <text>", "milestone description")
    .option(
      "--body-file <path>",
      "read description from file (use - for stdin)",
    )
    .option("--stdin", "read description from stdin (alias for --body-file -)")
    .option("--target-date <date>", "target date in ISO format (YYYY-MM-DD)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [name, options, command] = args as [
          string,
          MilestoneCreateOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const projectId = await resolveProjectId(ctx.sdk, options.project);

        const resolvedDescription = resolveBodyInput(options);

        const milestone = await createMilestone(ctx.gql, {
          projectId,
          name,
          description: resolvedDescription,
          targetDate: options.targetDate,
        });

        outputResult(milestone, formatMilestoneCreate, rootOpts);
      }),
    );

  milestones
    .command("update <milestone>")
    .description("update an existing milestone")
    .addHelpText(
      "after",
      "\nDescription input: pass --description <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.",
    )
    .option("--project <project>", "scope name lookup to project")
    .option("-n, --name <name>", "new name")
    .option("--description <text>", "new description")
    .option(
      "--body-file <path>",
      "read new description from file (use - for stdin)",
    )
    .option(
      "--stdin",
      "read new description from stdin (alias for --body-file -)",
    )
    .option(
      "--target-date <date>",
      "new target date in ISO format (YYYY-MM-DD)",
    )
    .option("--sort-order <n>", "display order")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [milestone, options, command] = args as [
          string,
          MilestoneUpdateOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const milestoneId = await resolveMilestoneId(
          ctx.gql,
          ctx.sdk,
          milestone,
          options.project,
        );

        const resolvedDescription = resolveBodyInput(options);

        const updateInput: ProjectMilestoneUpdateInput = {};
        if (options.name !== undefined) updateInput.name = options.name;
        if (resolvedDescription !== undefined) {
          updateInput.description = resolvedDescription;
        }
        if (options.targetDate !== undefined) {
          updateInput.targetDate = options.targetDate;
        }
        if (options.sortOrder !== undefined) {
          updateInput.sortOrder = parseFloat(options.sortOrder);
        }

        const updated = await updateMilestone(
          ctx.gql,
          milestoneId,
          updateInput,
        );

        outputResult(updated, formatMilestoneUpdate, rootOpts);
      }),
    );

  milestones
    .command("usage")
    .description("show detailed usage for milestones")
    .action(() => {
      console.log(formatDomainUsage(milestones, MILESTONES_META));
    });
}
