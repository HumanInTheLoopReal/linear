import type { Command } from "commander";
import { resolveDualBodyInput } from "../common/body-input.js";
import { createContext, getRootOpts } from "../common/context.js";
import { resolveReactionEmojiInput } from "../common/emoji.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult, parseLimit } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import type { ProjectCreateInput, ProjectUpdateInput } from "../gql/graphql.js";
import {
  resolveProjectId,
  resolveProjectLabelIds,
} from "../resolvers/project-resolver.js";
import { resolveProjectStatusId } from "../resolvers/project-status-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import { resolveUserId } from "../resolvers/user-resolver.js";
import {
  createDiscussionCommentReaction,
  deleteDiscussionComment,
  deleteDiscussionCommentReactionByEmoji,
  deleteDiscussionCommentReactionById,
  deleteDiscussionReply,
  editDiscussionComment,
  editDiscussionReply,
  listDiscussionReplies,
  listDiscussionRepliesWithReactions,
  listDiscussionsForProject,
  listDiscussionsForProjectWithReactions,
  replyToDiscussion,
  resolveDiscussion,
  startProjectDiscussion,
  unresolveDiscussion,
} from "../services/discussion-service.js";
import {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  unarchiveProject,
  updateProject,
} from "../services/project-service.js";
import { requireCommentBody } from "./_comment-body.js";
import {
  formatCommentCreated,
  formatCommentDeleted,
  formatCommentEdited,
  formatCommentReplied,
  formatCommentsList,
  formatReactionCreated,
  formatReactionDeleted,
  formatThreadResolved,
  formatThreadUnresolved,
} from "./comments.js";

interface ListOptions {
  limit: string;
  after?: string;
}

interface DiscussionsOptions {
  limit?: string;
  after?: string;
  withReactions?: boolean;
}

interface DiscussionBodyOptions {
  body?: string;
  bodyFile?: string;
  stdin?: boolean;
}

interface ResolveDiscussionOptions {
  withComment?: string;
}

interface ReactionOptions {
  shortcode?: string;
}

function addCommentReactionCommands(
  parent: ReturnType<Command["command"]>,
  noun: "thread" | "reply",
): void {
  parent
    .command(`react <${noun}> [emoji]`)
    .description(`add a reaction to a discussion ${noun}`)
    .option("--shortcode <name>", "emoji shortcode (e.g. thumbs_up)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [commentId, emoji, options, command] = args as [
          string,
          string | undefined,
          ReactionOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const result = await createDiscussionCommentReaction(ctx.gql, {
          commentId,
          target: noun,
          expectedEntityKind: "project",
          emoji: resolveReactionEmojiInput(emoji, options.shortcode),
        });
        outputResult(result, formatReactionCreated, getRootOpts(command));
      }),
    );

  parent
    .command(`unreact <${noun}> [emoji]`)
    .description(`remove your reaction from a discussion ${noun} by emoji`)
    .option("--shortcode <name>", "emoji shortcode (e.g. thumbs_up)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [commentId, emoji, options, command] = args as [
          string,
          string | undefined,
          ReactionOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const result = await deleteDiscussionCommentReactionByEmoji(ctx.gql, {
          commentId,
          target: noun,
          expectedEntityKind: "project",
          emoji: resolveReactionEmojiInput(emoji, options.shortcode),
        });
        outputResult(result, formatReactionDeleted, getRootOpts(command));
      }),
    );

  parent
    .command(`unreact-id <${noun}> <reactionId>`)
    .description(
      `remove your reaction from a discussion ${noun} by reaction ID`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [commentId, reactionId, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const result = await deleteDiscussionCommentReactionById(ctx.gql, {
          commentId,
          target: noun,
          expectedEntityKind: "project",
          reactionId,
        });
        outputResult(result, formatReactionDeleted, getRootOpts(command));
      }),
    );
}

interface CreateOptions {
  teams: string;
  description?: string;
  descriptionFile?: string;
  content?: string;
  contentFile?: string;
  lead?: string;
  members?: string;
  priority?: string;
  status?: string;
  startDate?: string;
  targetDate?: string;
  labels?: string;
}

interface UpdateOptions {
  name?: string;
  description?: string;
  descriptionFile?: string;
  content?: string;
  contentFile?: string;
  lead?: string;
  members?: string;
  priority?: string;
  status?: string;
  startDate?: string;
  targetDate?: string;
  teams?: string;
  labels?: string;
}

export const PROJECTS_META: DomainMeta = {
  name: "projects",
  summary: "groups of issues toward a goal",
  context: [
    "a project collects related issues across teams. projects can have",
    "milestones to track progress toward deadlines or phases. projects",
    "have a status (backlog, planned, started, paused, completed,",
    "canceled), priority (0-4), health (onTrack, atRisk, offTrack),",
    "and can be assigned labels, a lead, and members.",
  ].join("\n"),
  arguments: {
    project: "project identifier (UUID or name)",
    name: "string",
  },
  seeAlso: [
    "milestones list --project",
    "documents list --project",
    "issues create --project",
  ],
};

function parsePriority(value: string): number {
  const priority = Number.parseInt(value, 10);
  if (Number.isNaN(priority) || priority < 0 || priority > 4) {
    throw invalidParameterError("priority", `must be 0-4, got "${value}"`);
  }
  return priority;
}

/**
 * Status icon for a Linear project, mapped from Linear's project status types:
 *   backlog/planned       → ○ (open)
 *   started               → ◐ (in progress)
 *   paused                → ❄ (deferred)
 *   completed/canceled/duplicate → ✓ (closed)
 *
 * Returns `○` for any unknown future status type so the column always renders.
 */
function projectStatusIcon(type: string | null | undefined): string {
  switch (type) {
    case "started":
      return "◐";
    case "paused":
      return "❄";
    case "completed":
    case "canceled":
      return "✓";
    default:
      return "○";
  }
}

/**
 * Format `progress` (0.0-1.0) as a percentage string (`42%`). Empty string
 * when null/undefined so the caller can drop the column cleanly.
 */
function progressPct(progress: number | null | undefined): string {
  if (progress === null || progress === undefined) return "";
  return `${Math.round(progress * 100)}%`;
}

/**
 * Format a date string (ISO or YYYY-MM-DD) as YYYY-MM-DD, dropping any time
 * component. Empty string for null/undefined so callers can skip the row.
 */
function projectFormatYmd(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

/**
 * Minimal structural shape `formatProjectList` reads from a Linear project
 * row. Kept loose so both `ProjectListItem` (list) and `ProjectDetail` (read)
 * payloads satisfy it without forcing codegen-type imports here.
 */
interface ProjectListRowShape {
  id: string;
  name: string;
  slugId?: string | null;
  status?: { name?: string | null; type?: string | null } | null;
  progress?: number | null;
  lead?: { name?: string | null } | null;
  teams?: { nodes: { key: string }[] } | null;
}

/**
 * Render the project-list result. Each row: status icon + slug + name +
 * `[state]` + progress + lead/teams suffix. Footer: `Total: N projects`.
 * Format designed to feel consistent with `issues list`.
 */
export function formatProjectList(result: {
  nodes: ProjectListRowShape[];
}): string {
  if (result.nodes.length === 0) {
    return "No projects found.\n";
  }
  const lines: string[] = [];
  for (const p of result.nodes) {
    const icon = projectStatusIcon(p.status?.type ?? null);
    const slug = p.slugId ?? p.id.slice(0, 8);
    const state = p.status?.name ?? "(no status)";
    const pct = progressPct(p.progress);
    const head = pct
      ? `${icon} ${slug}  ${p.name}  [${state}] ${pct}`
      : `${icon} ${slug}  ${p.name}  [${state}]`;
    lines.push(head);
    const lead = p.lead?.name ?? "(none)";
    const teams =
      (p.teams?.nodes ?? []).map((t) => t.key).join(", ") || "(none)";
    lines.push(`  Lead: ${lead}  ·  Teams: ${teams}`);
  }
  lines.push("");
  lines.push(`Total: ${result.nodes.length} projects`);
  return `${lines.join("\n")}\n`;
}

/**
 * Structural shape `formatProjectDetail` reads from a Linear project. Loose
 * by design: superset of `ProjectListRowShape`, drops any field not rendered.
 */
interface ProjectDetailShape extends ProjectListRowShape {
  description?: string | null;
  content?: string | null;
  health?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  members?: { nodes: { name: string }[] } | null;
  projectMilestones?: {
    nodes: { name: string; targetDate?: string | null }[];
  } | null;
  initiatives?: { nodes: { name: string }[] } | null;
}

/**
 * Render a single-project detail card. Mirrors `formatIssueDetail`'s sectioned
 * layout: header line, then a `Lead/Teams/...` info block, then an optional
 * DESCRIPTION, MILESTONES, INITIATIVES — empty sections are omitted.
 */
export function formatProjectDetail(project: ProjectDetailShape): string {
  const icon = projectStatusIcon(project.status?.type ?? null);
  const slug = project.slugId ?? project.id.slice(0, 8);
  const state = project.status?.name ?? "(no status)";
  const pct = progressPct(project.progress);
  const summaryParts = ["●", pct, "·", state].filter((p) => p !== "");
  const summary = `[${summaryParts.join(" ")}]`;
  const header = `${icon} ${slug} · ${project.name}   ${summary}`;

  const lines: string[] = [header];
  const lead = project.lead?.name ?? "(none)";
  const teams =
    (project.teams?.nodes ?? []).map((t) => t.key).join(", ") || "(none)";
  const memberCount = project.members?.nodes.length ?? 0;
  lines.push(`Lead: ${lead} · Teams: ${teams} · Members: ${memberCount}`);

  if (project.health) {
    lines.push(`Health: ${project.health}`);
  }

  const startYmd = projectFormatYmd(project.startDate);
  const targetYmd = projectFormatYmd(project.targetDate);
  if (startYmd || targetYmd) {
    const start = startYmd || "(none)";
    const target = targetYmd || "(none)";
    lines.push(`Start: ${start} · Target: ${target}`);
  }

  const createdYmd = projectFormatYmd(project.createdAt);
  const updatedYmd = projectFormatYmd(project.updatedAt);
  if (createdYmd || updatedYmd) {
    lines.push(
      `Created: ${createdYmd || "(unknown)"} · Updated: ${updatedYmd || "(unknown)"}`,
    );
  }

  const desc = (project.content ?? project.description ?? "").trim();
  if (desc) {
    lines.push("");
    lines.push("DESCRIPTION");
    lines.push(desc);
  }

  const milestones = project.projectMilestones?.nodes ?? [];
  if (milestones.length > 0) {
    lines.push("");
    lines.push(`MILESTONES (${milestones.length})`);
    for (const m of milestones) {
      const tgt = projectFormatYmd(m.targetDate);
      lines.push(tgt ? `  · ${m.name}  → ${tgt}` : `  · ${m.name}`);
    }
  }

  const initiatives = project.initiatives?.nodes ?? [];
  if (initiatives.length > 0) {
    lines.push("");
    lines.push(`INITIATIVES (${initiatives.length})`);
    for (const i of initiatives) {
      lines.push(`  · ${i.name}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Minimal mutation-row shape the project lifecycle echoes read. All five
 * project mutations (create/update/archive/unarchive) return full project
 * detail fields; `delete` returns only `{id, success}` — so `name`/`slugId`
 * are optional here.
 */
interface ProjectMutationShape {
  id: string;
  name?: string | null;
  slugId?: string | null;
}

/**
 * Mutation-echo line: `<Verb> project <slugId>: <name>`. Falls back to the
 * UUID's first 8 chars when slugId is missing, and to `(no name)` when name
 * is missing (e.g. `projects delete` only returns `{id, success}`).
 */
function projectMutationLine(
  verb: "Created" | "Updated" | "Archived" | "Unarchived" | "Deleted",
  result: ProjectMutationShape,
): string {
  const slug = result.slugId ?? result.id.slice(0, 8);
  const name = result.name ?? "(no name)";
  return `${verb} project ${slug}: ${name}\n`;
}

export function formatProjectCreate(result: ProjectMutationShape): string {
  return projectMutationLine("Created", result);
}

export function formatProjectUpdate(result: ProjectMutationShape): string {
  return projectMutationLine("Updated", result);
}

export function formatProjectArchive(result: ProjectMutationShape): string {
  return projectMutationLine("Archived", result);
}

export function formatProjectUnarchive(result: ProjectMutationShape): string {
  return projectMutationLine("Unarchived", result);
}

/**
 * Delete echoes only the id (no name available from `projectDelete`'s
 * entity-stripped payload).
 */
export function formatProjectDelete(result: ProjectMutationShape): string {
  return projectMutationLine("Deleted", result);
}

export function setupProjectsCommands(program: Command): void {
  const projects = program
    .command("projects")
    .description("Project operations");

  projects.action(() => projects.help());

  projects
    .command("list")
    .description("list projects")
    .option("-l, --limit <n>", "max results", "100")
    .option("--after <cursor>", "cursor for next page")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [ListOptions, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const result = await listProjects(ctx.gql, {
          limit: parseLimit(options.limit),
          after: options.after,
        });
        outputResult(result, formatProjectList, rootOpts);
      }),
    );

  projects
    .command("read <project>")
    .description("get full project details")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [project, , command] = args as [string, unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const projectId = await resolveProjectId(ctx.sdk, project);
        const result = await getProject(ctx.gql, projectId);
        outputResult(result, formatProjectDetail, rootOpts);
      }),
    );

  projects
    .command("discuss <project>")
    .description("start a discussion thread on a project")
    .addHelpText(
      "after",
      "\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.\n\nFormatting: Linear renders comment bodies as markdown — structure long updates with headers, bullets, `code`, and fenced blocks (pipe tables do NOT render). Long single-paragraph bodies get a stderr formatting nudge (`validation.on-comment`, default warn).",
    )
    .option("--body <text>", "discussion body (markdown supported)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [project, options, command] = args as [
          string,
          DiscussionBodyOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const body = requireCommentBody(options);
        const projectId = await resolveProjectId(ctx.sdk, project);
        const result = await startProjectDiscussion(ctx.gql, {
          projectId,
          body,
        });

        outputResult(result, formatCommentCreated, getRootOpts(command));
      }),
    );

  projects
    .command("discussions <project>")
    .description("list root discussion threads on a project")
    .option("-l, --limit <n>", "max results", "25")
    .option("--after <cursor>", "cursor for next page")
    .option("--with-reactions", "include normalized discussion reactions")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [project, options, command] = args as [
          string,
          DiscussionsOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const projectId = await resolveProjectId(ctx.sdk, project);
        const paginationOptions = {
          limit: parseLimit(options.limit || "25"),
          after: options.after,
        };
        const result = options.withReactions
          ? await listDiscussionsForProjectWithReactions(
              ctx.gql,
              projectId,
              paginationOptions,
            )
          : await listDiscussionsForProject(
              ctx.gql,
              projectId,
              paginationOptions,
            );

        outputResult(result, formatCommentsList, getRootOpts(command));
      }),
    );

  const projectThreads = projects
    .command("threads")
    .description("discussion thread reaction operations");
  addCommentReactionCommands(projectThreads, "thread");

  const projectReplies = projects
    .command("replies <thread>")
    .description("list replies in a root discussion thread")
    .option("-l, --limit <n>", "max results", "50")
    .option("--after <cursor>", "cursor for next page")
    .option("--with-reactions", "include normalized discussion reactions")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [thread, options, command] = args as [
          string,
          DiscussionsOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const paginationOptions = {
          limit: parseLimit(options.limit || "50"),
          after: options.after,
        };
        const result = options.withReactions
          ? await listDiscussionRepliesWithReactions(
              ctx.gql,
              thread,
              paginationOptions,
              "project",
            )
          : await listDiscussionReplies(
              ctx.gql,
              thread,
              paginationOptions,
              "project",
            );

        outputResult(result, formatCommentsList, getRootOpts(command));
      }),
    );
  addCommentReactionCommands(projectReplies, "reply");

  projects
    .command("reply <thread>")
    .description("reply to a root discussion thread")
    .addHelpText(
      "after",
      "\nImportant: `<thread>` must be a root discussion thread ID.\n\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.",
    )
    .option("--body <text>", "reply body (markdown supported)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [thread, options, command] = args as [
          string,
          DiscussionBodyOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const body = requireCommentBody(options);
        const result = await replyToDiscussion(ctx.gql, {
          threadId: thread,
          body,
          entityKind: "project",
        });

        outputResult(result, formatCommentReplied, getRootOpts(command));
      }),
    );

  projects
    .command("edit <comment>")
    .description("edit a root discussion or reply comment")
    .addHelpText(
      "after",
      "\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.\n\nFormatting: Linear renders comment bodies as markdown — structure long updates with headers, bullets, `code`, and fenced blocks (pipe tables do NOT render). Long single-paragraph bodies get a stderr formatting nudge (`validation.on-comment`, default warn).",
    )
    .option("--body <text>", "new comment body (markdown supported)")
    .option("--body-file <path>", "read new body from file (use - for stdin)")
    .option("--stdin", "read new body from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [comment, options, command] = args as [
          string,
          DiscussionBodyOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const body = requireCommentBody(options);
        const result = await editDiscussionComment(
          ctx.gql,
          comment,
          { body },
          "project",
        );

        outputResult(result, formatCommentEdited, getRootOpts(command));
      }),
    );

  projects
    .command("edit-reply <reply>")
    .description("edit a discussion reply")
    .addHelpText(
      "after",
      "\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.\n\nFormatting: Linear renders comment bodies as markdown — structure long updates with headers, bullets, `code`, and fenced blocks (pipe tables do NOT render). Long single-paragraph bodies get a stderr formatting nudge (`validation.on-comment`, default warn).",
    )
    .option("--body <text>", "new reply body (markdown supported)")
    .option("--body-file <path>", "read new body from file (use - for stdin)")
    .option("--stdin", "read new body from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [reply, options, command] = args as [
          string,
          DiscussionBodyOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const body = requireCommentBody(options);
        const result = await editDiscussionReply(
          ctx.gql,
          reply,
          { body },
          "project",
        );

        outputResult(result, formatCommentEdited, getRootOpts(command));
      }),
    );

  projects
    .command("delete-comment <comment>")
    .description("delete a root discussion or reply comment")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [comment, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));

        const result = await deleteDiscussionComment(
          ctx.gql,
          comment,
          "project",
        );

        outputResult(result, formatCommentDeleted, getRootOpts(command));
      }),
    );

  projects
    .command("delete-reply <reply>")
    .description("delete a discussion reply")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [reply, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));

        const result = await deleteDiscussionReply(ctx.gql, reply, "project");

        outputResult(result, formatCommentDeleted, getRootOpts(command));
      }),
    );

  projects
    .command("resolve <thread>")
    .description("resolve a discussion thread")
    .option("--with-comment <comment>", "comment to mark as resolving comment")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [thread, options, command] = args as [
          string,
          ResolveDiscussionOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const result = await resolveDiscussion(ctx.gql, {
          threadId: thread,
          resolvingCommentId: options.withComment,
          entityKind: "project",
        });

        outputResult(result, formatThreadResolved, getRootOpts(command));
      }),
    );

  projects
    .command("unresolve <thread>")
    .description("unresolve a discussion thread")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [thread, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));

        const result = await unresolveDiscussion(ctx.gql, thread, "project");

        outputResult(result, formatThreadUnresolved, getRootOpts(command));
      }),
    );

  projects
    .command("create <name>")
    .description("create a new project")
    .addHelpText(
      "after",
      "\nBody input: --description / --content take inline text; --description-file / --content-file read from a file (use - for stdin). Inline and file flags for the same field are mutually exclusive.",
    )
    .requiredOption("--teams <teams>", "comma-separated team names or UUIDs")
    .option("--description <text>", "project description")
    .option(
      "--description-file <path>",
      "read description from file (use - for stdin)",
    )
    .option("--content <text>", "project content (markdown)")
    .option("--content-file <path>", "read content from file (use - for stdin)")
    .option("--lead <user>", "project lead (name, email, or UUID)")
    .option("--members <users>", "comma-separated member names or UUIDs")
    .option("--priority <0-4>", "0=none 1=urgent 2=high 3=medium 4=low")
    .option("--status <status>", "project status name or UUID")
    .option("--start-date <date>", "start date (YYYY-MM-DD)")
    .option("--target-date <date>", "target date (YYYY-MM-DD)")
    .option("--labels <labels>", "comma-separated label names or UUIDs")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [name, options, command] = args as [
          string,
          CreateOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const teamNames = options.teams
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        const teamIds = await Promise.all(
          teamNames.map((t) => resolveTeamId(ctx.sdk, t)),
        );

        const input: ProjectCreateInput = {
          name,
          teamIds,
        };

        const { description: resolvedDescription, content: resolvedContent } =
          resolveDualBodyInput(options);

        if (resolvedDescription !== undefined) {
          input.description = resolvedDescription;
        }

        if (resolvedContent !== undefined) {
          input.content = resolvedContent;
        }

        if (options.lead) {
          input.leadId = await resolveUserId(ctx.sdk, options.lead);
        }

        if (options.members) {
          const memberNames = options.members
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean);
          input.memberIds = await Promise.all(
            memberNames.map((m) => resolveUserId(ctx.sdk, m)),
          );
        }

        if (options.priority) {
          input.priority = parsePriority(options.priority);
        }

        if (options.status) {
          input.statusId = await resolveProjectStatusId(
            ctx.gql,
            options.status,
          );
        }

        if (options.startDate) {
          input.startDate = options.startDate;
        }

        if (options.targetDate) {
          input.targetDate = options.targetDate;
        }

        if (options.labels) {
          const labelNames = options.labels
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean);
          input.labelIds = await resolveProjectLabelIds(ctx.sdk, labelNames);
        }

        const result = await createProject(ctx.gql, input);
        outputResult(result, formatProjectCreate, getRootOpts(command));
      }),
    );

  projects
    .command("update <project>")
    .description("update an existing project")
    .addHelpText(
      "after",
      "\nBody input: --description / --content take inline text; --description-file / --content-file read from a file (use - for stdin). Inline and file flags for the same field are mutually exclusive.",
    )
    .option("--name <name>", "new name")
    .option("--description <text>", "new description")
    .option(
      "--description-file <path>",
      "read new description from file (use - for stdin)",
    )
    .option("--content <text>", "new content (markdown)")
    .option(
      "--content-file <path>",
      "read new content from file (use - for stdin)",
    )
    .option("--lead <user>", "new lead (name, email, or UUID)")
    .option("--members <users>", "comma-separated member names or UUIDs")
    .option("--priority <0-4>", "new priority")
    .option("--status <status>", "new status name or UUID")
    .option("--start-date <date>", "new start date (YYYY-MM-DD)")
    .option("--target-date <date>", "new target date (YYYY-MM-DD)")
    .option("--teams <teams>", "comma-separated team names or UUIDs")
    .option("--labels <labels>", "comma-separated label names or UUIDs")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [project, options, command] = args as [
          string,
          UpdateOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const projectId = await resolveProjectId(ctx.sdk, project);

        const input: ProjectUpdateInput = {};

        if (options.name) {
          input.name = options.name;
        }

        const { description: resolvedDescription, content: resolvedContent } =
          resolveDualBodyInput(options);

        if (resolvedDescription !== undefined) {
          input.description = resolvedDescription;
        }

        if (resolvedContent !== undefined) {
          input.content = resolvedContent;
        }

        if (options.lead) {
          input.leadId = await resolveUserId(ctx.sdk, options.lead);
        }

        if (options.members) {
          const memberNames = options.members
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean);
          input.memberIds = await Promise.all(
            memberNames.map((m) => resolveUserId(ctx.sdk, m)),
          );
        }

        if (options.priority) {
          input.priority = parsePriority(options.priority);
        }

        if (options.status) {
          input.statusId = await resolveProjectStatusId(
            ctx.gql,
            options.status,
          );
        }

        if (options.startDate) {
          input.startDate = options.startDate;
        }

        if (options.targetDate) {
          input.targetDate = options.targetDate;
        }

        if (options.teams) {
          const teamNames = options.teams
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          input.teamIds = await Promise.all(
            teamNames.map((t) => resolveTeamId(ctx.sdk, t)),
          );
        }

        if (options.labels) {
          const labelNames = options.labels
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean);
          input.labelIds = await resolveProjectLabelIds(ctx.sdk, labelNames);
        }

        if (Object.keys(input).length === 0) {
          throw invalidParameterError(
            "update options",
            "at least one option must be provided",
          );
        }

        const result = await updateProject(ctx.gql, projectId, input);
        outputResult(result, formatProjectUpdate, getRootOpts(command));
      }),
    );

  projects
    .command("archive <project>")
    .description("archive a project")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [project, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const projectId = await resolveProjectId(ctx.sdk, project);
        const result = await archiveProject(ctx.gql, projectId);
        outputResult(result, formatProjectArchive, getRootOpts(command));
      }),
    );

  projects
    .command("unarchive <project>")
    .description("unarchive a project")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [project, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const projectId = await resolveProjectId(ctx.sdk, project, {
          includeArchived: true,
        });
        const result = await unarchiveProject(ctx.gql, projectId);
        outputResult(result, formatProjectUnarchive, getRootOpts(command));
      }),
    );

  projects
    .command("delete <project>")
    .description("delete a project")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [project, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const projectId = await resolveProjectId(ctx.sdk, project, {
          includeArchived: true,
        });
        const result = await deleteProject(ctx.gql, projectId);
        outputResult(result, formatProjectDelete, getRootOpts(command));
      }),
    );

  projects
    .command("usage")
    .description("show detailed usage for projects")
    .action(() => {
      console.log(formatDomainUsage(projects, PROJECTS_META));
    });
}
