import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import type { AttachmentFilter } from "../gql/graphql.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import {
  createAttachment,
  deleteAttachment,
  listAttachments,
} from "../services/attachment-service.js";

export const ATTACHMENTS_META: DomainMeta = {
  name: "attachments",
  summary: "linked external resources on issues (PRs, commits, URLs)",
  context: [
    "attachments link external resources to issues. they represent GitHub",
    "pull requests, commits, Slack messages, or arbitrary URLs. each has a",
    "title, subtitle, sourceType (e.g. 'github', 'slack'), and metadata",
    "with integration-specific data. creating an attachment with the same",
    "url on the same issue updates the existing record (idempotent).",
  ].join("\n"),
  arguments: {
    issue: "issue identifier (UUID or ABC-123)",
    id: "attachment UUID",
  },
  seeAlso: ["issues read --with-attachments"],
};

interface ListOptions {
  sourceType?: string;
  title?: string;
  createdAfter?: string;
  createdBefore?: string;
}

interface CreateOptions {
  title: string;
  url: string;
  subtitle?: string;
}

interface AttachmentRowShape {
  id: string;
  title: string;
  url: string;
  sourceType?: string | null;
}

/**
 * The list format mirrors `formatLabelList` — `📎 Attachments (N):` header,
 * indented rows showing id-prefix, title, optional source-type bracket, and URL.
 */
export function formatAttachmentList(
  attachments: AttachmentRowShape[],
): string {
  if (attachments.length === 0) return "\n📎 No attachments.\n\n";
  const lines: string[] = ["", `📎 Attachments (${attachments.length}):`];
  for (const a of attachments) {
    const idShort = a.id.slice(0, 8);
    const source = a.sourceType ? ` [${a.sourceType}]` : "";
    lines.push(`  ${idShort}  ${a.title}${source}  ${a.url}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function formatAttachmentCreate(att: {
  id: string;
  title?: string | null;
}): string {
  const title = att.title ?? "(untitled)";
  return `Created attachment ${att.id.slice(0, 8)}: ${title}\n`;
}

export function formatAttachmentDelete(result: { id: string }): string {
  return `Deleted attachment ${result.id.slice(0, 8)}\n`;
}

function buildAttachmentFilter(
  options: ListOptions,
): AttachmentFilter | undefined {
  const filters: AttachmentFilter[] = [];

  if (options.sourceType) {
    filters.push({ sourceType: { eq: options.sourceType } });
  }
  if (options.title) {
    filters.push({ title: { eqIgnoreCase: options.title } });
  }
  if (options.createdAfter) {
    filters.push({ createdAt: { gte: options.createdAfter } });
  }
  if (options.createdBefore) {
    filters.push({ createdAt: { lt: options.createdBefore } });
  }

  if (filters.length === 0) return undefined;
  if (filters.length === 1) return filters[0];
  return { and: filters };
}

export function setupAttachmentsCommands(program: Command): void {
  const attachments = program
    .command("attachments")
    .description("Attachment operations");

  attachments.action(() => attachments.help());

  attachments
    .command("list <issue>")
    .description("list attachments on an issue")
    .option(
      "--source-type <type>",
      "filter by source type (e.g. github, slack)",
    )
    .option("--title <title>", "filter by title (case-insensitive)")
    .option("--created-after <date>", "created after date (YYYY-MM-DD)")
    .option("--created-before <date>", "created before date (YYYY-MM-DD)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          ListOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const filter = buildAttachmentFilter(options);
        const result = await listAttachments(ctx.gql, issueId, filter);
        outputResult(result, formatAttachmentList, rootOpts);
      }),
    );

  attachments
    .command("create <issue>")
    .description("create an attachment on an issue")
    .requiredOption("--title <title>", "attachment title")
    .requiredOption("--url <url>", "attachment URL")
    .option("--subtitle <text>", "attachment subtitle")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          CreateOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await createAttachment(ctx.gql, {
          issueId,
          title: options.title,
          url: options.url,
          ...(options.subtitle && { subtitle: options.subtitle }),
        });
        outputResult(result, formatAttachmentCreate, rootOpts);
      }),
    );

  attachments
    .command("delete <id>")
    .description("delete an attachment by UUID")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [id, , command] = args as [string, unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const result = await deleteAttachment(ctx.gql, id);
        outputResult(result, formatAttachmentDelete, rootOpts);
      }),
    );

  attachments
    .command("usage")
    .description("show detailed usage for attachments")
    .action(() => {
      console.log(formatDomainUsage(attachments, ATTACHMENTS_META));
    });
}
