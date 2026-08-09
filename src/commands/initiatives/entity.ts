import type { Command } from "commander";
import type { LinearSdkClient } from "../../client/linear-client.js";
import { resolveDualBodyInput } from "../../common/body-input.js";
import { createContext, getRootOpts } from "../../common/context.js";
import { resolveReactionEmojiInput } from "../../common/emoji.js";
import { invalidParameterError } from "../../common/errors.js";
import {
  handleCommand,
  outputResult,
  parseLimit,
} from "../../common/output.js";
import {
  type InitiativeCreateInput,
  type InitiativeSortInput,
  InitiativeStatus,
  type InitiativeUpdateInput,
  type ListInitiativesQueryVariables,
  PaginationNulls,
  PaginationOrderBy,
  PaginationSortOrder,
} from "../../gql/graphql.js";
import { resolveInitiativeId } from "../../resolvers/initiative-resolver.js";
import { resolveTeamId } from "../../resolvers/team-resolver.js";
import { resolveUserId } from "../../resolvers/user-resolver.js";
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
  listDiscussionsForInitiative,
  listDiscussionsForInitiativeWithReactions,
  replyToDiscussion,
  resolveDiscussion,
  startInitiativeDiscussion,
  unresolveDiscussion,
} from "../../services/discussion-service.js";
import {
  archiveInitiative,
  createInitiative,
  deleteInitiative,
  getInitiative,
  listInitiatives,
  unarchiveInitiative,
  updateInitiative,
} from "../../services/initiative-service.js";
import { requireCommentBody } from "../_comment-body.js";
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
} from "../comments.js";

interface InitiativeExpandOptions {
  withProjects?: boolean;
  withSubInitiatives?: boolean;
  withParentInitiatives?: boolean;
  withUpdates?: boolean;
  withLinks?: boolean;
  withHistory?: boolean;
  withDocuments?: boolean;
}

interface InitiativeListOptions extends InitiativeExpandOptions {
  limit: string;
  after?: string;
  includeArchived?: boolean;
  sortBy?: string;
  sortOrder?: string;
  id?: string;
  slug?: string;
  name?: string;
  status?: string;
  health?: string;
  healthWithAge?: string;
  owner?: string;
  creator?: string;
  team?: string;
  targetAfter?: string;
  targetBefore?: string;
  startedAfter?: string;
  startedBefore?: string;
  completedAfter?: string;
  completedBefore?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  parent?: string;
  ancestor?: string;
}

interface InitiativeReadOptions extends InitiativeExpandOptions {}

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
          expectedEntityKind: "initiative",
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
          expectedEntityKind: "initiative",
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
          expectedEntityKind: "initiative",
          reactionId,
        });
        outputResult(result, formatReactionDeleted, getRootOpts(command));
      }),
    );
}

interface InitiativeCreateOptions {
  description?: string;
  descriptionFile?: string;
  content?: string;
  contentFile?: string;
  owner?: string;
  status?: string;
  targetDate?: string;
  sortOrder?: string;
}

interface InitiativeUpdateOptions {
  name?: string;
  description?: string;
  descriptionFile?: string;
  content?: string;
  contentFile?: string;
  owner?: string;
  status?: string;
  targetDate?: string;
  sortOrder?: string;
}

type InitiativeSortBy =
  | "name"
  | "createdAt"
  | "updatedAt"
  | "targetDate"
  | "health"
  | "healthUpdatedAt"
  | "manual"
  | "owner";

function parseSortOrder(value?: string): "asc" | "desc" | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "asc" || normalized === "desc") {
    return normalized;
  }
  throw invalidParameterError("--sort-order", "must be one of: asc, desc");
}

function parseSortBy(value?: string): InitiativeSortBy | undefined {
  if (!value) return undefined;

  const normalized = value.toLowerCase();

  if (normalized === "name") return "name";
  if (normalized === "createdat") return "createdAt";
  if (normalized === "updatedat") return "updatedAt";
  if (normalized === "targetdate") return "targetDate";
  if (normalized === "health") return "health";
  if (normalized === "healthupdatedat") return "healthUpdatedAt";
  if (normalized === "manual") return "manual";
  if (normalized === "owner") return "owner";

  throw invalidParameterError(
    "--sort-by",
    'must be one of: "name", "createdAt", "updatedAt", "targetDate", "health", "healthUpdatedAt", "manual", "owner"',
  );
}

function mapSortByToPaginationOrderBy(
  sortBy?: InitiativeSortBy,
): PaginationOrderBy | undefined {
  if (sortBy === "createdAt") return PaginationOrderBy.CreatedAt;
  if (sortBy === "updatedAt") return PaginationOrderBy.UpdatedAt;
  return undefined;
}

function mapSortByToInitiativeSort(
  sortBy?: InitiativeSortBy,
  sortOrder?: "asc" | "desc",
): ListInitiativesQueryVariables["sort"] | undefined {
  if (!sortBy) return undefined;

  const order =
    sortOrder === "desc"
      ? PaginationSortOrder.Descending
      : PaginationSortOrder.Ascending;

  const withNulls = {
    order,
    nulls: PaginationNulls.Last,
  };

  const sortEntry: InitiativeSortInput =
    sortBy === "manual"
      ? { manual: withNulls }
      : sortBy === "name"
        ? { name: withNulls }
        : sortBy === "createdAt"
          ? { createdAt: withNulls }
          : sortBy === "updatedAt"
            ? { updatedAt: withNulls }
            : sortBy === "targetDate"
              ? { targetDate: withNulls }
              : sortBy === "health"
                ? { health: withNulls }
                : sortBy === "healthUpdatedAt"
                  ? { healthUpdatedAt: withNulls }
                  : { owner: withNulls };

  return [sortEntry];
}

function parseInitiativeStatus(value?: string): InitiativeStatus | undefined {
  if (!value) return undefined;

  const normalized = value.toLowerCase();
  if (normalized === "planned") return InitiativeStatus.Planned;
  if (normalized === "active") return InitiativeStatus.Active;
  if (normalized === "completed") return InitiativeStatus.Completed;

  throw invalidParameterError(
    "--status",
    'must be one of: "Planned", "Active", "Completed"',
  );
}

function parseSortOrderNumber(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw invalidParameterError(
      "--sort-order",
      `must be a number, got "${value}"`,
    );
  }
  return parsed;
}

function applyNullableDateRange(
  target: { gte?: string; lte?: string },
  after?: string,
  before?: string,
): void {
  if (after !== undefined) {
    target.gte = after;
  }
  if (before !== undefined) {
    target.lte = before;
  }
}

function getExpandFlags(options: InitiativeExpandOptions): string[] {
  const map: Array<[boolean | undefined, string]> = [
    [options.withProjects, "--with-projects"],
    [options.withSubInitiatives, "--with-sub-initiatives"],
    [options.withParentInitiatives, "--with-parent-initiatives"],
    [options.withUpdates, "--with-updates"],
    [options.withLinks, "--with-links"],
    [options.withHistory, "--with-history"],
    [options.withDocuments, "--with-documents"],
  ];

  return map.filter(([enabled]) => enabled).map(([, flag]) => flag);
}

async function buildInitiativeFilter(
  sdk: LinearSdkClient,
  options: InitiativeListOptions,
): Promise<ListInitiativesQueryVariables["filter"] | undefined> {
  const filter: NonNullable<ListInitiativesQueryVariables["filter"]> = {};

  if (options.id) {
    filter.id = { eq: options.id };
  }

  if (options.slug) {
    filter.slugId = { eqIgnoreCase: options.slug };
  }

  if (options.name) {
    filter.name = { eqIgnoreCase: options.name };
  }

  const status = parseInitiativeStatus(options.status);
  if (status) {
    filter.status = { eq: status };
  }

  if (options.health) {
    filter.health = { eq: options.health };
  }

  if (options.healthWithAge) {
    filter.healthWithAge = { eq: options.healthWithAge };
  }

  if (options.owner) {
    const ownerId = await resolveUserId(sdk, options.owner);
    filter.owner = { id: { eq: ownerId } };
  }

  if (options.creator) {
    const creatorId = await resolveUserId(sdk, options.creator);
    filter.creator = { id: { eq: creatorId } };
  }

  if (options.team) {
    const teamId = await resolveTeamId(sdk, options.team);
    filter.teams = { some: { id: { eq: teamId } } };
  }

  if (options.targetAfter || options.targetBefore) {
    filter.targetDate = {};
    applyNullableDateRange(
      filter.targetDate,
      options.targetAfter,
      options.targetBefore,
    );
  }

  if (options.startedAfter || options.startedBefore) {
    filter.startedAt = {};
    applyNullableDateRange(
      filter.startedAt,
      options.startedAfter,
      options.startedBefore,
    );
  }

  if (options.completedAfter || options.completedBefore) {
    filter.completedAt = {};
    applyNullableDateRange(
      filter.completedAt,
      options.completedAfter,
      options.completedBefore,
    );
  }

  if (options.createdAfter || options.createdBefore) {
    filter.createdAt = {};
    applyNullableDateRange(
      filter.createdAt,
      options.createdAfter,
      options.createdBefore,
    );
  }

  if (options.updatedAfter || options.updatedBefore) {
    filter.updatedAt = {};
    applyNullableDateRange(
      filter.updatedAt,
      options.updatedAfter,
      options.updatedBefore,
    );
  }

  if (options.ancestor) {
    const ancestorId = await resolveInitiativeId(sdk, options.ancestor);
    filter.ancestors = { some: { id: { eq: ancestorId } } };
  }

  if (options.parent) {
    throw invalidParameterError(
      "--parent",
      "is not supported by current Linear initiatives filter API",
    );
  }

  return Object.keys(filter).length > 0 ? filter : undefined;
}

function initiativeStatusIcon(status: string | null | undefined): string {
  switch (status) {
    case InitiativeStatus.Active:
      return "◐";
    case InitiativeStatus.Completed:
      return "✓";
    default:
      return "○";
  }
}

function initiativeFormatYmd(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

interface InitiativeRowShape {
  id: string;
  name: string;
  slugId?: string | null;
  status?: string | null;
  health?: string | null;
  targetDate?: string | null;
  owner?: { name?: string | null } | null;
}

export function formatInitiativeList(result: {
  nodes: InitiativeRowShape[];
}): string {
  if (result.nodes.length === 0) {
    return "No initiatives found.\n";
  }
  const lines: string[] = [];
  for (const i of result.nodes) {
    const icon = initiativeStatusIcon(i.status);
    const slug = i.slugId ?? i.id.slice(0, 8);
    const state = i.status ?? "(no status)";
    const head = `${icon} ${slug}  ${i.name}  [${state}]`;
    lines.push(head);
    const owner = i.owner?.name ?? "(none)";
    const health = i.health ?? "(none)";
    const target = initiativeFormatYmd(i.targetDate) || "(none)";
    lines.push(`  Owner: ${owner}  ·  Health: ${health}  ·  Target: ${target}`);
  }
  lines.push("");
  lines.push(`Total: ${result.nodes.length} initiatives`);
  return `${lines.join("\n")}\n`;
}

interface InitiativeDetailShape extends InitiativeRowShape {
  description?: string | null;
  content?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  url?: string | null;
  projects?: { nodes: { name: string; slugId?: string | null }[] } | null;
  subInitiatives?: { nodes: { name: string }[] } | null;
  parentInitiatives?: { nodes: { name: string }[] } | null;
  initiativeUpdates?: {
    nodes: { id: string; health?: string | null; createdAt: string }[];
  } | null;
  links?: { nodes: { url: string; label?: string | null }[] } | null;
  documents?: { nodes: { title: string }[] } | null;
}

export function formatInitiativeDetail(
  initiative: InitiativeDetailShape,
): string {
  const icon = initiativeStatusIcon(initiative.status);
  const slug = initiative.slugId ?? initiative.id.slice(0, 8);
  const state = initiative.status ?? "(no status)";
  const summary = `[● · ${state}]`;
  const header = `${icon} ${slug} · ${initiative.name}   ${summary}`;

  const lines: string[] = [header];
  const owner = initiative.owner?.name ?? "(none)";
  const health = initiative.health ?? "(none)";
  lines.push(`Owner: ${owner} · Health: ${health}`);

  const startYmd = initiativeFormatYmd(initiative.startedAt);
  const targetYmd = initiativeFormatYmd(initiative.targetDate);
  if (startYmd || targetYmd) {
    lines.push(
      `Started: ${startYmd || "(none)"} · Target: ${targetYmd || "(none)"}`,
    );
  }

  const createdYmd = initiativeFormatYmd(initiative.createdAt);
  const updatedYmd = initiativeFormatYmd(initiative.updatedAt);
  if (createdYmd || updatedYmd) {
    lines.push(
      `Created: ${createdYmd || "(unknown)"} · Updated: ${updatedYmd || "(unknown)"}`,
    );
  }

  const desc = (initiative.content ?? initiative.description ?? "").trim();
  if (desc) {
    lines.push("");
    lines.push("DESCRIPTION");
    lines.push(desc);
  }

  const projects = initiative.projects?.nodes ?? [];
  if (projects.length > 0) {
    lines.push("");
    lines.push(`PROJECTS (${projects.length})`);
    for (const p of projects) {
      const pSlug = p.slugId ? ` (${p.slugId})` : "";
      lines.push(`  · ${p.name}${pSlug}`);
    }
  }

  const subs = initiative.subInitiatives?.nodes ?? [];
  if (subs.length > 0) {
    lines.push("");
    lines.push(`SUB-INITIATIVES (${subs.length})`);
    for (const s of subs) {
      lines.push(`  · ${s.name}`);
    }
  }

  const parents = initiative.parentInitiatives?.nodes ?? [];
  if (parents.length > 0) {
    lines.push("");
    lines.push(`PARENT INITIATIVES (${parents.length})`);
    for (const p of parents) {
      lines.push(`  · ${p.name}`);
    }
  }

  const links = initiative.links?.nodes ?? [];
  if (links.length > 0) {
    lines.push("");
    lines.push(`LINKS (${links.length})`);
    for (const l of links) {
      lines.push(l.label ? `  · ${l.label}: ${l.url}` : `  · ${l.url}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

interface InitiativeMutationShape {
  id: string;
  name?: string | null;
  slugId?: string | null;
}

function initiativeMutationLine(
  verb: "Created" | "Updated" | "Archived" | "Unarchived" | "Deleted",
  result: InitiativeMutationShape,
): string {
  const slug = result.slugId ?? result.id.slice(0, 8);
  const name = result.name ?? "(no name)";
  return `${verb} initiative ${slug}: ${name}\n`;
}

export function formatInitiativeCreated(
  result: InitiativeMutationShape,
): string {
  return initiativeMutationLine("Created", result);
}

export function formatInitiativeUpdated(
  result: InitiativeMutationShape,
): string {
  return initiativeMutationLine("Updated", result);
}

export function formatInitiativeArchived(
  result: InitiativeMutationShape,
): string {
  return initiativeMutationLine("Archived", result);
}

export function formatInitiativeUnarchived(
  result: InitiativeMutationShape,
): string {
  return initiativeMutationLine("Unarchived", result);
}

export function formatInitiativeDeleted(
  result: InitiativeMutationShape,
): string {
  return initiativeMutationLine("Deleted", result);
}

export function setupInitiativeEntityCommands(initiatives: Command): void {
  initiatives
    .command("list")
    .description("list initiatives")
    .option("-l, --limit <n>", "max results", "50")
    .option("--after <cursor>", "cursor for next page")
    .option("--include-archived", "include archived initiatives")
    .option(
      "--sort-by <field>",
      "name, createdAt, updatedAt, targetDate, health, healthUpdatedAt, manual, owner",
    )
    .option("--sort-order <order>", "asc or desc")
    .option("--id <id>", "filter by initiative UUID")
    .option("--slug <slug>", "filter by slug")
    .option("--name <name>", "filter by name")
    .option("--status <status>", "filter by status: planned, active, completed")
    .option("--health <health>", "filter by health")
    .option("--health-with-age <health>", "filter by health with age")
    .option("--owner <user>", "filter by owner (name, email, or UUID)")
    .option("--creator <user>", "filter by creator (name, email, or UUID)")
    .option("--team <team>", "filter by team (name, key, or UUID)")
    .option("--target-after <date>", "filter target date >= value")
    .option("--target-before <date>", "filter target date <= value")
    .option("--started-after <date>", "filter started date >= value")
    .option("--started-before <date>", "filter started date <= value")
    .option("--completed-after <date>", "filter completed date >= value")
    .option("--completed-before <date>", "filter completed date <= value")
    .option("--created-after <date>", "filter created date >= value")
    .option("--created-before <date>", "filter created date <= value")
    .option("--updated-after <date>", "filter updated date >= value")
    .option("--updated-before <date>", "filter updated date <= value")
    .option("--parent <initiative>", "filter by direct parent initiative")
    .option("--ancestor <initiative>", "filter by ancestor initiative")
    .option("--with-projects", "include linked projects in list output")
    .option(
      "--with-sub-initiatives",
      "include child initiatives in list output",
    )
    .option(
      "--with-parent-initiatives",
      "include parent initiatives in list output",
    )
    .option("--with-updates", "include updates in list output")
    .option("--with-links", "include links in list output")
    .option("--with-history", "include history in list output")
    .option("--with-documents", "include documents in list output")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [InitiativeListOptions, Command];
        const ctx = createContext(getRootOpts(command));

        const sortOrder = parseSortOrder(options.sortOrder);
        const sortBy = parseSortBy(options.sortBy);

        const expandFlags = getExpandFlags(options);
        if (expandFlags.length > 0) {
          throw invalidParameterError(
            "expand flags",
            `${expandFlags.join(", ")} are not supported for initiatives list yet`,
          );
        }

        if (sortOrder && !sortBy) {
          throw invalidParameterError(
            "--sort-order",
            "requires --sort-by to be specified",
          );
        }

        const orderBy = mapSortByToPaginationOrderBy(sortBy);
        const sort = mapSortByToInitiativeSort(sortBy, sortOrder);

        const filter = await buildInitiativeFilter(ctx.sdk, options);

        const result = await listInitiatives(ctx.gql, {
          limit: parseLimit(options.limit),
          after: options.after,
          includeArchived: options.includeArchived ?? false,
          filter,
          orderBy,
          sort,
        });

        outputResult(result, formatInitiativeList, getRootOpts(command));
      }),
    );

  initiatives
    .command("read <initiative>")
    .description("get initiative details")
    .option("--with-projects", "include linked projects in read output")
    .option(
      "--with-sub-initiatives",
      "include child initiatives in read output",
    )
    .option(
      "--with-parent-initiatives",
      "include parent initiatives in read output",
    )
    .option("--with-updates", "include updates in read output")
    .option("--with-links", "include links in read output")
    .option("--with-history", "include history in read output")
    .option("--with-documents", "include documents in read output")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [initiative, options, command] = args as [
          string,
          InitiativeReadOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const initiativeId = await resolveInitiativeId(ctx.sdk, initiative);

        // Read query already returns expanded fields. Keep flags accepted for
        // CLI contract compatibility until conditional field selection is added.
        void getExpandFlags(options);

        const result = await getInitiative(ctx.gql, initiativeId);
        outputResult(result, formatInitiativeDetail, getRootOpts(command));
      }),
    );

  initiatives
    .command("discuss <initiative>")
    .description("start a discussion thread on an initiative")
    .addHelpText(
      "after",
      "\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive; one is required.",
    )
    .option("--body <text>", "discussion body (markdown supported)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [initiative, options, command] = args as [
          string,
          DiscussionBodyOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const body = requireCommentBody(options);

        const initiativeId = await resolveInitiativeId(ctx.sdk, initiative);
        const result = await startInitiativeDiscussion(ctx.gql, {
          initiativeId,
          body,
        });

        outputResult(result, formatCommentCreated, getRootOpts(command));
      }),
    );

  initiatives
    .command("discussions <initiative>")
    .description("list root discussion threads on an initiative")
    .option("-l, --limit <n>", "max results", "25")
    .option("--after <cursor>", "cursor for next page")
    .option("--with-reactions", "include normalized discussion reactions")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [initiative, options, command] = args as [
          string,
          DiscussionsOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const initiativeId = await resolveInitiativeId(ctx.sdk, initiative);
        const paginationOptions = {
          limit: parseLimit(options.limit || "25"),
          after: options.after,
        };
        const result = options.withReactions
          ? await listDiscussionsForInitiativeWithReactions(
              ctx.gql,
              initiativeId,
              paginationOptions,
            )
          : await listDiscussionsForInitiative(
              ctx.gql,
              initiativeId,
              paginationOptions,
            );

        outputResult(result, formatCommentsList, getRootOpts(command));
      }),
    );

  const initiativeThreads = initiatives
    .command("threads")
    .description("discussion thread reaction operations");
  addCommentReactionCommands(initiativeThreads, "thread");

  const initiativeReplies = initiatives
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
              "initiative",
            )
          : await listDiscussionReplies(
              ctx.gql,
              thread,
              paginationOptions,
              "initiative",
            );

        outputResult(result, formatCommentsList, getRootOpts(command));
      }),
    );
  addCommentReactionCommands(initiativeReplies, "reply");

  initiatives
    .command("reply <thread>")
    .description("reply to a root discussion thread")
    .addHelpText(
      "after",
      "\nImportant: `<thread>` must be a root discussion thread ID.\n\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive; one is required.",
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
          entityKind: "initiative",
        });

        outputResult(result, formatCommentReplied, getRootOpts(command));
      }),
    );

  initiatives
    .command("edit <comment>")
    .description("edit a root discussion or reply comment")
    .addHelpText(
      "after",
      "\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive; one is required.",
    )
    .option("--body <text>", "new comment body (markdown supported)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
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
          {
            body,
          },
          "initiative",
        );

        outputResult(result, formatCommentEdited, getRootOpts(command));
      }),
    );

  initiatives
    .command("edit-reply <reply>")
    .description("edit a discussion reply")
    .addHelpText(
      "after",
      "\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive; one is required.",
    )
    .option("--body <text>", "new reply body (markdown supported)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
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
          {
            body,
          },
          "initiative",
        );

        outputResult(result, formatCommentEdited, getRootOpts(command));
      }),
    );

  initiatives
    .command("delete-comment <comment>")
    .description("delete a root discussion or reply comment")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [comment, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));

        const result = await deleteDiscussionComment(
          ctx.gql,
          comment,
          "initiative",
        );

        outputResult(result, formatCommentDeleted, getRootOpts(command));
      }),
    );

  initiatives
    .command("delete-reply <reply>")
    .description("delete a discussion reply")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [reply, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));

        const result = await deleteDiscussionReply(
          ctx.gql,
          reply,
          "initiative",
        );

        outputResult(result, formatCommentDeleted, getRootOpts(command));
      }),
    );

  initiatives
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
          entityKind: "initiative",
        });

        outputResult(result, formatThreadResolved, getRootOpts(command));
      }),
    );

  initiatives
    .command("unresolve <thread>")
    .description("unresolve a discussion thread")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [thread, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));

        const result = await unresolveDiscussion(ctx.gql, thread, "initiative");

        outputResult(result, formatThreadUnresolved, getRootOpts(command));
      }),
    );

  initiatives
    .command("create <name>")
    .description("create a new initiative")
    .addHelpText(
      "after",
      "\nBody input: --description / --content take inline text; --description-file / --content-file read from a file (use - for stdin). Inline and file flags for the same field are mutually exclusive.",
    )
    .option("--description <text>", "initiative description")
    .option(
      "--description-file <path>",
      "read description from file (use - for stdin)",
    )
    .option("--content <text>", "initiative content (markdown)")
    .option("--content-file <path>", "read content from file (use - for stdin)")
    .option("--owner <user>", "owner (name, email, or UUID)")
    .option("--status <status>", "planned, active, completed")
    .option("--target-date <date>", "target date (YYYY-MM-DD)")
    .option("--sort-order <n>", "display sort order")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [name, options, command] = args as [
          string,
          InitiativeCreateOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const input: InitiativeCreateInput = { name };

        const { description: resolvedDescription, content: resolvedContent } =
          resolveDualBodyInput(options);

        if (resolvedDescription !== undefined) {
          input.description = resolvedDescription;
        }

        if (resolvedContent !== undefined) {
          input.content = resolvedContent;
        }

        if (options.owner) {
          input.ownerId = await resolveUserId(ctx.sdk, options.owner);
        }

        const status = parseInitiativeStatus(options.status);
        if (status) {
          input.status = status;
        }

        if (options.targetDate !== undefined) {
          input.targetDate = options.targetDate;
        }

        const sortOrder = parseSortOrderNumber(options.sortOrder);
        if (sortOrder !== undefined) {
          input.sortOrder = sortOrder;
        }

        const result = await createInitiative(ctx.gql, input);
        outputResult(result, formatInitiativeCreated, getRootOpts(command));
      }),
    );

  initiatives
    .command("update <initiative>")
    .description("update an initiative")
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
    .option("--owner <user>", "new owner (name, email, or UUID)")
    .option("--status <status>", "planned, active, completed")
    .option("--target-date <date>", "new target date (YYYY-MM-DD)")
    .option("--sort-order <n>", "new display sort order")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [initiative, options, command] = args as [
          string,
          InitiativeUpdateOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const initiativeId = await resolveInitiativeId(ctx.sdk, initiative);

        const input: InitiativeUpdateInput = {};

        if (options.name !== undefined) {
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

        if (options.owner) {
          input.ownerId = await resolveUserId(ctx.sdk, options.owner);
        }

        const status = parseInitiativeStatus(options.status);
        if (status) {
          input.status = status;
        }

        if (options.targetDate !== undefined) {
          input.targetDate = options.targetDate;
        }

        const sortOrder = parseSortOrderNumber(options.sortOrder);
        if (sortOrder !== undefined) {
          input.sortOrder = sortOrder;
        }

        if (Object.keys(input).length === 0) {
          throw invalidParameterError(
            "update options",
            "at least one option must be provided",
          );
        }

        const result = await updateInitiative(ctx.gql, initiativeId, input);
        outputResult(result, formatInitiativeUpdated, getRootOpts(command));
      }),
    );

  initiatives
    .command("archive <initiative>")
    .description("archive an initiative")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [initiative, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const initiativeId = await resolveInitiativeId(ctx.sdk, initiative);
        const result = await archiveInitiative(ctx.gql, initiativeId);
        outputResult(result, formatInitiativeArchived, getRootOpts(command));
      }),
    );

  initiatives
    .command("unarchive <initiative>")
    .description("unarchive an initiative")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [initiative, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const initiativeId = await resolveInitiativeId(ctx.sdk, initiative);
        const result = await unarchiveInitiative(ctx.gql, initiativeId);
        outputResult(result, formatInitiativeUnarchived, getRootOpts(command));
      }),
    );

  initiatives
    .command("delete <initiative>")
    .description("delete an initiative")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [initiative, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const initiativeId = await resolveInitiativeId(ctx.sdk, initiative);
        const result = await deleteInitiative(ctx.gql, initiativeId);
        outputResult(result, formatInitiativeDeleted, getRootOpts(command));
      }),
    );
}
