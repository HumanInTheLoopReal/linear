import type { Command } from "commander";
import {
  type CommandOptions,
  createContext,
  getRootOpts,
} from "../common/context.js";
import { resolveReactionEmojiInput } from "../common/emoji.js";
import { handleCommand, outputResult, parseLimit } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import {
  createIssueDiscussionCommentReaction,
  deleteDiscussionComment,
  deleteIssueDiscussionCommentReactionByEmoji,
  deleteIssueDiscussionCommentReactionById,
  editDiscussionComment,
  listDiscussionsForIssue,
  replyToDiscussion,
  startIssueDiscussion,
} from "../services/discussion-service.js";
import { requireCommentBody } from "./_comment-body.js";

interface CreateCommentOptions extends CommandOptions {
  body?: string;
  bodyFile?: string;
  stdin?: boolean;
}

interface ListCommentOptions extends CommandOptions {
  limit?: string;
  after?: string;
}

interface ReplyCommentOptions extends CommandOptions {
  body?: string;
  bodyFile?: string;
  stdin?: boolean;
}

interface EditCommentOptions extends CommandOptions {
  body?: string;
  bodyFile?: string;
  stdin?: boolean;
}

interface ReactionOptions extends CommandOptions {
  shortcode?: string;
}

interface CommentUserShape {
  id: string;
  displayName: string;
}

interface CommentNodeShape {
  id: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
  parentId?: string | null;
  quotedText?: string | null;
  resolvedAt?: string | null;
  resolvingUser?: CommentUserShape | null;
  user?: CommentUserShape | null;
}

interface CommentListShape {
  nodes: CommentNodeShape[];
  pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
}

interface ReactionCommentShape {
  id: string;
  parentId?: string | null;
}

interface ReactionResultShape {
  id: string;
  emoji: string;
  comment?: ReactionCommentShape | null;
  issue?: { id: string } | null;
  user?: { id: string; displayName: string } | null;
}

interface DeleteResultShape {
  id: string;
  success: boolean;
}

interface ResolveAckShape {
  id: string;
  resolvedAt?: string | null;
  resolvingUser?: { id: string; displayName: string } | null;
}

function commentTs(iso: string | null | undefined): string {
  if (!iso) return "(unknown)";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function commentAuthor(node: { user?: CommentUserShape | null }): string {
  return node.user?.displayName ?? "(unknown)";
}

function indentBody(body: string, prefix = "  "): string {
  return body
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/**
 * The anchor text of an inline comment (today: selection-anchored document
 * comments). Rendered as a markdown-style quote line above the body so the
 * reader sees *what* was commented on before reading the comment. Newlines in
 * a multi-line selection are collapsed to keep the quote to one line.
 */
function quotedAnchor(node: CommentNodeShape): string | null {
  const quoted = node.quotedText?.replace(/\s+/g, " ").trim();
  if (!quoted) return null;
  return `  > ${quoted}`;
}

export function formatCommentsList(result: CommentListShape): string {
  const n = result.nodes.length;
  if (n === 0) return "(no comments)\n";

  const lines: string[] = [`💬 Comments (${n}):`, ""];
  for (let i = 0; i < n; i++) {
    const c = result.nodes[i];
    const tags: string[] = [];
    if (c.editedAt) tags.push("edited");
    if (c.resolvedAt) {
      const who = c.resolvingUser?.displayName;
      tags.push(who ? `resolved by ${who}` : "resolved");
    }
    const tagStr = tags.length > 0 ? `  [${tags.join(", ")}]` : "";
    lines.push(`◆ ${commentAuthor(c)} · ${commentTs(c.createdAt)}${tagStr}`);
    const anchor = quotedAnchor(c);
    if (anchor) lines.push(anchor);
    lines.push(indentBody(c.body));
    lines.push(`  id: ${c.id}`);
    if (i < n - 1) lines.push("");
  }
  if (result.pageInfo?.hasNextPage && result.pageInfo.endCursor) {
    lines.push("");
    lines.push(`(more — next page cursor: ${result.pageInfo.endCursor})`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatCommentCreated(
  comment: CommentNodeShape | null | undefined,
): string {
  if (!comment) return "✓ Comment created\n";
  return [
    "✓ Comment created",
    `  by ${commentAuthor(comment)} · ${commentTs(comment.createdAt)}`,
    `  id: ${comment.id}`,
    "",
    indentBody(comment.body),
    "",
  ].join("\n");
}

export function formatCommentReplied(
  comment: CommentNodeShape | null | undefined,
): string {
  if (!comment) return "✓ Reply posted\n";
  return [
    "✓ Reply posted",
    `  to thread: ${comment.parentId ?? "(unknown)"}`,
    `  by ${commentAuthor(comment)} · ${commentTs(comment.createdAt)}`,
    `  id: ${comment.id}`,
    "",
    indentBody(comment.body),
    "",
  ].join("\n");
}

export function formatCommentEdited(
  comment: CommentNodeShape | null | undefined,
): string {
  if (!comment) return "✏ Comment edited\n";
  return [
    "✏ Comment edited",
    `  by ${commentAuthor(comment)} · ${commentTs(comment.editedAt ?? comment.createdAt)}`,
    `  id: ${comment.id}`,
    "",
    indentBody(comment.body),
    "",
  ].join("\n");
}

export function formatCommentDeleted(result: DeleteResultShape): string {
  return `✓ Comment deleted (id: ${result.id})\n`;
}

export function formatReactionCreated(result: ReactionResultShape): string {
  const lines: string[] = [`✓ Reaction added: ${result.emoji}`];
  if (result.comment) lines.push(`  comment: ${result.comment.id}`);
  if (result.issue) lines.push(`  issue: ${result.issue.id}`);
  lines.push(`  reaction id: ${result.id}`);
  return `${lines.join("\n")}\n`;
}

export function formatReactionDeleted(result: DeleteResultShape): string {
  return `✓ Reaction removed (id: ${result.id})\n`;
}

export function formatThreadResolved(
  result: ResolveAckShape | null | undefined,
): string {
  if (!result) return "✓ Thread resolved\n";
  const who = result.resolvingUser?.displayName;
  const suffix = who ? ` by ${who}` : "";
  return `✓ Thread resolved${suffix} (id: ${result.id})\n`;
}

export function formatThreadUnresolved(
  result: ResolveAckShape | null | undefined,
): string {
  if (!result) return "✓ Thread unresolved\n";
  return `✓ Thread unresolved (id: ${result.id})\n`;
}

export const COMMENTS_META: DomainMeta = {
  name: "comments",
  summary:
    "deprecated compatibility facade for issue discussions with root-thread-only reply support",
  context:
    "the comments domain remains operational as an intentionally narrowed compatibility layer. compatibility mode supports replying by root thread ID only, nested-reply targets are not supported in compatibility mode, and edit/delete accept either root thread IDs or reply IDs for backward compatibility. new workflows should migrate to domain-centric issues discussion commands (issues discuss/discussions/replies/reply/edit-reply/delete-reply).",
  arguments: {
    issue: "issue identifier (UUID or ABC-123)",
    comment: "thread/reply identifier (UUID only)",
  },
  seeAlso: [
    "issues discuss <issue>",
    "issues discussions <issue>",
    "issues replies <thread>",
    "issues reply <thread>",
    "issues edit-reply <reply>",
    "issues delete-reply <reply>",
  ],
};

export function setupCommentsCommands(program: Command): void {
  const comments = program
    .command("comments")
    .description(
      "Deprecated compatibility facade for issue discussions. Prefer the `issues` discussion commands.",
    )
    .addHelpText(
      "after",
      "\nDEPRECATED: kept for compatibility. Prefer `issues discuss`, `issues discussions`, `issues replies`, `issues reply`, `issues edit-reply`, and `issues delete-reply`.\nCompatibility mode only supports replying by root thread ID (nested-reply targets are not supported).\nCompatibility edit/delete accept root thread IDs and reply IDs.",
    );

  comments.action(() => comments.help());

  comments
    .command("list <issue>")
    .description(
      "deprecated compatibility: list root issue discussions (migrate to `issues discussions <issue>`)",
    )
    .addHelpText("after", "\nPrefer: `issues discussions <issue>`")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are supported.`,
    )
    .option("-l, --limit <n>", "max results", "25")
    .option("--after <cursor>", "cursor for next page")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          ListCommentOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const limit = parseLimit(options.limit || "25");
        const resolvedIssueId = await resolveIssueId(ctx.sdk, issue);
        const result = await listDiscussionsForIssue(ctx.gql, resolvedIssueId, {
          limit,
          after: options.after,
        });

        outputResult(result, formatCommentsList, getRootOpts(command));
      }),
    );

  comments
    .command("create <issue>")
    .description(
      "deprecated compatibility: start an issue discussion (migrate to `issues discuss <issue> --body <text>`)",
    )
    .addHelpText("after", "\nPrefer: `issues discuss <issue> --body <text>`")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are supported.`,
    )
    .option("--body <text>", "comment body (markdown supported)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          CreateCommentOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const body = requireCommentBody(options);
        const resolvedIssueId = await resolveIssueId(ctx.sdk, issue);
        const result = await startIssueDiscussion(ctx.gql, {
          issueId: resolvedIssueId,
          body,
        });

        outputResult(result, formatCommentCreated, getRootOpts(command));
      }),
    );

  comments
    .command("reply <thread>")
    .description(
      "deprecated compatibility: reply to a root discussion thread (requires root thread ID; nested-reply targets are not supported in compatibility mode; migrate to `issues reply <thread> --body <text>`)",
    )
    .addHelpText("after", "\nPrefer: `issues reply <thread> --body <text>`")
    .addHelpText(
      "after",
      "\nImportant: `<thread>` must be the root discussion thread ID, not a reply ID.",
    )
    .addHelpText(
      "after",
      "\nNested-reply targets are not supported in compatibility mode.",
    )
    .option("--body <text>", "reply body (markdown supported)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [thread, options, command] = args as [
          string,
          ReplyCommentOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const body = requireCommentBody(options);
        const result = await replyToDiscussion(ctx.gql, {
          threadId: thread,
          body,
          entityKind: "issue",
        });

        outputResult(result, formatCommentReplied, getRootOpts(command));
      }),
    );

  comments
    .command("edit <comment>")
    .description(
      "deprecated compatibility: edit a discussion comment (accepts root thread ID or reply ID; migrate reply workflows to `issues edit-reply <reply> --body <text>`)",
    )
    .addHelpText("after", "\nPrefer: `issues edit-reply <reply> --body <text>`")
    .option("--body <text>", "new comment body (markdown supported)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [comment, options, command] = args as [
          string,
          EditCommentOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const body = requireCommentBody(options);
        const result = await editDiscussionComment(ctx.gql, comment, {
          body,
        });

        outputResult(result, formatCommentEdited, getRootOpts(command));
      }),
    );

  comments
    .command("delete <comment>")
    .description(
      "deprecated compatibility: delete a discussion comment (accepts root thread ID or reply ID; migrate reply workflows to `issues delete-reply <reply>`)",
    )
    .addHelpText("after", "\nPrefer: `issues delete-reply <reply>`")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [comment, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));

        const result = await deleteDiscussionComment(ctx.gql, comment);

        outputResult(result, formatCommentDeleted, getRootOpts(command));
      }),
    );

  comments
    .command("react <comment> [emoji]")
    .description(
      "DEPRECATED compatibility command. Prefer: `issues threads react <thread>` or `issues replies react <reply>`.",
    )
    .addHelpText(
      "after",
      "\nDEPRECATED compatibility command. Prefer: `issues threads react <thread>` or `issues replies react <reply>`.",
    )
    .option("--shortcode <name>", "emoji shortcode (e.g. thumbs_up)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [comment, emoji, options, command] = args as [
          string,
          string | undefined,
          ReactionOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const result = await createIssueDiscussionCommentReaction(ctx.gql, {
          commentId: comment,
          emoji: resolveReactionEmojiInput(emoji, options.shortcode),
        });

        outputResult(result, formatReactionCreated, getRootOpts(command));
      }),
    );

  comments
    .command("unreact <comment> [emoji]")
    .description(
      "DEPRECATED compatibility command. Prefer: `issues threads unreact <thread>` or `issues replies unreact <reply>`.",
    )
    .addHelpText(
      "after",
      "\nDEPRECATED compatibility command. Prefer: `issues threads unreact <thread>` or `issues replies unreact <reply>`.",
    )
    .option("--shortcode <name>", "emoji shortcode (e.g. thumbs_up)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [comment, emoji, options, command] = args as [
          string,
          string | undefined,
          ReactionOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const result = await deleteIssueDiscussionCommentReactionByEmoji(
          ctx.gql,
          {
            commentId: comment,
            emoji: resolveReactionEmojiInput(emoji, options.shortcode),
          },
        );

        outputResult(result, formatReactionDeleted, getRootOpts(command));
      }),
    );

  comments
    .command("unreact-id <comment> <reactionId>")
    .description(
      "DEPRECATED compatibility command. Prefer: `issues threads unreact-id <thread> <reactionId>` or `issues replies unreact-id <reply> <reactionId>`.",
    )
    .addHelpText(
      "after",
      "\nDEPRECATED compatibility command. Prefer: `issues threads unreact-id <thread> <reactionId>` or `issues replies unreact-id <reply> <reactionId>`.",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [comment, reactionId, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const result = await deleteIssueDiscussionCommentReactionById(ctx.gql, {
          commentId: comment,
          reactionId,
        });

        outputResult(result, formatReactionDeleted, getRootOpts(command));
      }),
    );

  comments
    .command("usage")
    .description("show detailed usage for comments")
    .action(() => {
      console.log(formatDomainUsage(comments, COMMENTS_META));
    });
}
