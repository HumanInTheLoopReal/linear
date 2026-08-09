import type { Command } from "commander";
import { resolveBodyInput } from "../common/body-input.js";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult, parseLimit } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import type { DocumentUpdateInput } from "../gql/graphql.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveProjectId } from "../resolvers/project-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import {
  createAttachment,
  listAttachments,
} from "../services/attachment-service.js";
import {
  listDiscussionReplies,
  listDiscussionRepliesWithReactions,
  listDiscussionsForDocument,
  listDiscussionsForDocumentWithReactions,
  replyToDiscussion,
  startDocumentDiscussion,
} from "../services/discussion-service.js";
import {
  createDocument,
  deleteDocument,
  getDocument,
  getDocumentCommentTarget,
  listDocuments,
  listDocumentsBySlugIds,
  updateDocument,
} from "../services/document-service.js";
import { requireCommentBody } from "./_comment-body.js";
import {
  formatCommentCreated,
  formatCommentReplied,
  formatCommentsList,
} from "./comments.js";

/**
 * Format consistent with `formatAttachmentList` / `formatProjectDetail`
 * for visual cohesion:
 *
 *   list   → `📄 Documents (N):` header + indented rows
 *   read   → `<title>` header + dates + raw body content
 *   CRUD   → `<Verb> document <id-prefix>: <title>` mutation echo
 *
 * `docFormatYmd` slices ISO timestamps to YYYY-MM-DD (matches the dating
 * convention used by formatProjectDetail/formatMilestoneDetail).
 */
function docFormatYmd(value: string | null | undefined): string {
  if (!value) return "(unknown)";
  return value.slice(0, 10);
}

interface DocumentRowShape {
  id: string;
  title: string;
  updatedAt?: string | null;
  icon?: string | null;
}

export function formatDocumentList(result: {
  nodes: DocumentRowShape[];
}): string {
  if (result.nodes.length === 0) return "\n📄 No documents found.\n\n";
  const lines: string[] = ["", `📄 Documents (${result.nodes.length}):`];
  for (const d of result.nodes) {
    const idShort = d.id.slice(0, 8);
    const icon = d.icon ? `${d.icon} ` : "";
    const updated = docFormatYmd(d.updatedAt);
    lines.push(`  ${idShort}  ${icon}${d.title}  (updated ${updated})`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

interface DocumentDetailShape extends DocumentRowShape {
  content?: string | null;
  createdAt?: string | null;
  url?: string | null;
}

export function formatDocumentRead(doc: DocumentDetailShape): string {
  const lines: string[] = [];
  const icon = doc.icon ? `${doc.icon} ` : "";
  lines.push(`${icon}${doc.title}`);

  const created = docFormatYmd(doc.createdAt);
  const updated = docFormatYmd(doc.updatedAt);
  lines.push(`Created: ${created} · Updated: ${updated}`);
  if (doc.url) lines.push(`URL: ${doc.url}`);

  const content = (doc.content ?? "").trim();
  if (content) {
    lines.push("");
    lines.push(content);
  }

  return `${lines.join("\n")}\n`;
}

interface DocumentMutationShape {
  id: string;
  title?: string | null;
}

function docMutationLine(
  verb: "Created" | "Updated",
  doc: DocumentMutationShape,
): string {
  const title = doc.title ?? "(untitled)";
  return `${verb} document ${doc.id.slice(0, 8)}: ${title}\n`;
}

export function formatDocumentCreate(doc: DocumentMutationShape): string {
  return docMutationLine("Created", doc);
}

export function formatDocumentUpdate(doc: DocumentMutationShape): string {
  return docMutationLine("Updated", doc);
}

export function formatDocumentDelete(result: { id: string }): string {
  return `Deleted document ${result.id.slice(0, 8)}\n`;
}

interface DocumentCreateOptions {
  title: string;
  content?: string;
  bodyFile?: string;
  stdin?: boolean;
  project?: string;
  team?: string;
  icon?: string;
  color?: string;
  issue?: string;
}

interface DocumentUpdateOptions {
  title?: string;
  content?: string;
  bodyFile?: string;
  stdin?: boolean;
  project?: string;
  icon?: string;
  color?: string;
}

interface DocumentListOptions {
  project?: string;
  issue?: string;
  limit?: string;
  after?: string;
}

interface DocumentDiscussionsOptions {
  limit?: string;
  after?: string;
  withReactions?: boolean;
}

interface DocumentDiscussionBodyOptions {
  body?: string;
  bodyFile?: string;
  stdin?: boolean;
}

/** Extracts slug ID from a Linear document URL (e.g. /workspace/document/title-slug-abc123 -> abc123). */
export function extractDocumentIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("linear.app")) {
      return null;
    }

    const pathParts = parsed.pathname.split("/");
    const docIndex = pathParts.indexOf("document");
    if (docIndex === -1 || docIndex >= pathParts.length - 1) {
      return null;
    }

    const docSlug = pathParts[docIndex + 1];
    const lastHyphenIndex = docSlug.lastIndexOf("-");
    if (lastHyphenIndex === -1) {
      return docSlug || null;
    }

    return docSlug.substring(lastHyphenIndex + 1) || null;
  } catch {
    // URL constructor throws on malformed input — treat as unresolvable
    return null;
  }
}

export const DOCUMENTS_META: DomainMeta = {
  name: "documents",
  summary: "long-form markdown docs attached to projects or issues",
  context: [
    "a document is a markdown page. it can belong to a project and/or be",
    "attached to an issue. documents support icons and colors.",
    "",
    "comments are the human → agent feedback channel on a document: humans",
    "comment (inline comments carry the quoted text they anchor to), agents",
    "read the comments with `documents discussions` and revise the document",
    "with `documents update`. `documents discuss` / `documents reply` post",
    "back into the thread.",
  ].join("\n"),
  arguments: {
    document: "document slug ID (e.g. ad9a3d2952b9) or UUID",
    thread: "root comment ID from `documents discussions`",
  },
  seeAlso: [
    "issues discussions <issue>",
    "issues read <issue>",
    "projects list",
  ],
};

export function setupDocumentsCommands(program: Command): void {
  const documents = program
    .command("documents")
    .description("Document operations (project-level documentation)");

  documents.action(() => documents.help());

  documents
    .command("list")
    .description("list documents")
    .option("--project <project>", "filter by project name or ID")
    .option(
      "--issue <issue>",
      "filter by issue (shows documents attached to the issue)",
    )
    .option("-l, --limit <n>", "max results", "50")
    .option("--after <cursor>", "cursor for next page")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [DocumentListOptions, Command];
        if (options.project && options.issue) {
          throw new Error(
            "Cannot use --project and --issue together. Choose one filter.",
          );
        }

        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const limit = parseLimit(options.limit || "50");

        if (options.issue) {
          const issueId = await resolveIssueId(ctx.sdk, options.issue);
          const attachments = await listAttachments(ctx.gql, issueId);

          const documentSlugIds = [
            ...new Set(
              attachments
                .map((att) => extractDocumentIdFromUrl(att.url))
                .filter((id): id is string => id !== null),
            ),
          ];

          if (documentSlugIds.length === 0) {
            outputResult(
              {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
              formatDocumentList,
              rootOpts,
            );
            return;
          }

          const documents = await listDocumentsBySlugIds(
            ctx.gql,
            documentSlugIds,
          );
          outputResult(
            {
              nodes: documents,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
            formatDocumentList,
            rootOpts,
          );
          return;
        }

        let projectId: string | undefined;
        if (options.project) {
          projectId = await resolveProjectId(ctx.sdk, options.project);
        }

        const documents = await listDocuments(ctx.gql, {
          limit,
          after: options.after,
          filter: projectId
            ? { project: { id: { eq: projectId } } }
            : undefined,
        });

        outputResult(documents, formatDocumentList, rootOpts);
      }),
    );

  documents
    .command("read <document>")
    .description("get document content")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [document, , command] = args as [string, unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const documentResult = await getDocument(ctx.gql, document);
        outputResult(documentResult, formatDocumentRead, rootOpts);
      }),
    );

  documents
    .command("create")
    .description("create a new document")
    .addHelpText(
      "after",
      "\nContent input: pass --content <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.",
    )
    .requiredOption("--title <title>", "document title (required)")
    .option("--content <text>", "document content (markdown)")
    .option("--body-file <path>", "read content from file (use - for stdin)")
    .option("--stdin", "read content from stdin (alias for --body-file -)")
    .option("--project <project>", "project name or ID")
    .option("--team <team>", "team key or name")
    .option("--icon <icon>", "document icon")
    .option("--color <color>", "icon color")
    .option("--issue <issue>", "also attach document to issue (e.g., ABC-123)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [DocumentCreateOptions, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const resolvedContent = resolveBodyInput(options);

        const projectId = options.project
          ? await resolveProjectId(ctx.sdk, options.project)
          : undefined;
        // A document lives in exactly one container; the default team must
        // not leak in next to an explicit --project.
        if (projectId && options.team) {
          throw new Error(
            "Pass either --project or --team, not both (a document lives in exactly one container).",
          );
        }
        const teamKey = projectId
          ? undefined
          : (options.team ?? getDefaultTeam() ?? undefined);
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;

        const document = await createDocument(ctx.gql, {
          title: options.title,
          content: resolvedContent,
          projectId,
          teamId,
          icon: options.icon,
          color: options.color,
        });

        if (options.issue) {
          const issueId = await resolveIssueId(ctx.sdk, options.issue);

          try {
            await createAttachment(ctx.gql, {
              issueId,
              url: document.url,
              title: document.title,
            });
          } catch (attachError) {
            const errorMessage =
              attachError instanceof Error
                ? attachError.message
                : String(attachError);
            throw new Error(
              `Document created (${document.id}) but failed to attach to issue "${options.issue}": ${errorMessage}.`,
            );
          }
        }

        outputResult(document, formatDocumentCreate, rootOpts);
      }),
    );

  documents
    .command("update <document>")
    .description("update an existing document")
    .addHelpText(
      "after",
      "\nContent input: pass --content <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.",
    )
    .option("--title <title>", "new title")
    .option("--content <text>", "new content (markdown)")
    .option(
      "--body-file <path>",
      "read new content from file (use - for stdin)",
    )
    .option("--stdin", "read new content from stdin (alias for --body-file -)")
    .option("--project <project>", "move to project")
    .option("--icon <icon>", "new icon")
    .option("--color <color>", "new icon color")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [document, options, command] = args as [
          string,
          DocumentUpdateOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const resolvedContent = resolveBodyInput(options);

        const input: DocumentUpdateInput = {};
        if (options.title) input.title = options.title;
        if (resolvedContent !== undefined) input.content = resolvedContent;
        if (options.project) {
          input.projectId = await resolveProjectId(ctx.sdk, options.project);
        }
        if (options.icon) input.icon = options.icon;
        if (options.color) input.color = options.color;

        const updatedDocument = await updateDocument(ctx.gql, document, input);
        outputResult(updatedDocument, formatDocumentUpdate, rootOpts);
      }),
    );

  documents
    .command("delete <document>")
    .description("trash a document")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [document, , command] = args as [string, unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const result = await deleteDocument(ctx.gql, document);
        outputResult(result, formatDocumentDelete, rootOpts);
      }),
    );

  documents
    .command("discussions <document>")
    .description("list root comment threads on a document")
    .addHelpText(
      "after",
      "\nDocuments resolve by slug ID or UUID, same as `documents read`.\n\nComments are the human → agent feedback channel on a document: read them, then edit the document. Inline comments anchored to a text selection print their anchor as a `>` quote line above the body.",
    )
    .option("-l, --limit <n>", "max results", "25")
    .option("--after <cursor>", "cursor for next page")
    .option("--with-reactions", "include normalized discussion reactions")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [document, options, command] = args as [
          string,
          DocumentDiscussionsOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const paginationOptions = {
          limit: parseLimit(options.limit || "25"),
          after: options.after,
        };
        const result = options.withReactions
          ? await listDiscussionsForDocumentWithReactions(
              ctx.gql,
              document,
              paginationOptions,
            )
          : await listDiscussionsForDocument(
              ctx.gql,
              document,
              paginationOptions,
            );

        outputResult(result, formatCommentsList, rootOpts);
      }),
    );

  documents
    .command("discuss <document>")
    .description("start a comment thread on a document")
    .addHelpText(
      "after",
      "\nDocuments resolve by slug ID or UUID, same as `documents read`.\n\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive; one is required.\n\nFormatting: Linear renders comment bodies as markdown — structure long updates with headers, bullets, `code`, and fenced blocks (pipe tables do NOT render). Long single-paragraph bodies get a stderr formatting nudge (`validation.on-comment`, default warn).",
    )
    .option("--body <text>", "comment body (markdown supported)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [document, options, command] = args as [
          string,
          DocumentDiscussionBodyOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const body = requireCommentBody(options);
        const target = await getDocumentCommentTarget(ctx.gql, document);
        const result = await startDocumentDiscussion(ctx.gql, {
          documentContentId: target.documentContentId,
          body,
        });

        outputResult(result, formatCommentCreated, rootOpts);
      }),
    );

  documents
    .command("replies <thread>")
    .description("list replies in a root comment thread on a document")
    .addHelpText(
      "after",
      "\nImportant: `<thread>` is a comment ID (from `documents discussions`), not a document ID.",
    )
    .option("-l, --limit <n>", "max results", "50")
    .option("--after <cursor>", "cursor for next page")
    .option("--with-reactions", "include normalized discussion reactions")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [thread, options, command] = args as [
          string,
          DocumentDiscussionsOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const paginationOptions = {
          limit: parseLimit(options.limit || "50"),
          after: options.after,
        };
        const result = options.withReactions
          ? await listDiscussionRepliesWithReactions(
              ctx.gql,
              thread,
              paginationOptions,
              "document",
            )
          : await listDiscussionReplies(
              ctx.gql,
              thread,
              paginationOptions,
              "document",
            );

        outputResult(result, formatCommentsList, rootOpts);
      }),
    );

  documents
    .command("reply <thread>")
    .description("reply to a root comment thread on a document")
    .addHelpText(
      "after",
      "\nImportant: `<thread>` must be a root comment ID (from `documents discussions`), not a document ID.\n\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive; one is required.\n\nFormatting: Linear renders comment bodies as markdown — structure long updates with headers, bullets, `code`, and fenced blocks (pipe tables do NOT render). Long single-paragraph bodies get a stderr formatting nudge (`validation.on-comment`, default warn).",
    )
    .option("--body <text>", "reply body (markdown supported)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [thread, options, command] = args as [
          string,
          DocumentDiscussionBodyOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const body = requireCommentBody(options);
        const result = await replyToDiscussion(ctx.gql, {
          threadId: thread,
          body,
          entityKind: "document",
        });

        outputResult(result, formatCommentReplied, rootOpts);
      }),
    );

  documents
    .command("usage")
    .description("show detailed usage for documents")
    .action(() => {
      console.log(formatDomainUsage(documents, DOCUMENTS_META));
    });
}
