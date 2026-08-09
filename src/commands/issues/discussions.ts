import type { Command } from "commander";
import { createContext, getRootOpts } from "../../common/context.js";
import { resolveReactionEmojiInput } from "../../common/emoji.js";
import {
  handleCommand,
  outputResult,
  parseLimit,
} from "../../common/output.js";
import { resolveIssueId } from "../../resolvers/issue-resolver.js";
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
  listDiscussionsForIssue,
  listDiscussionsForIssueWithReactions,
  replyToDiscussion,
  resolveDiscussion,
  startIssueDiscussion,
  unresolveDiscussion,
} from "../../services/discussion-service.js";
import {
  createReactionForIssue,
  deleteOwnReactionByEmoji,
  deleteOwnReactionById,
} from "../../services/reaction-service.js";
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

interface ReactionOptions {
  shortcode?: string;
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

function addCommentReactionCommands(
  parent: Command,
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
          expectedEntityKind: "issue",
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
          expectedEntityKind: "issue",
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
          expectedEntityKind: "issue",
          reactionId,
        });
        outputResult(result, formatReactionDeleted, getRootOpts(command));
      }),
    );
}

export function registerIssueDiscussionCommands(issues: Command): void {
  issues
    .command("react <issue> [emoji]")
    .description("add a root reaction to an issue")
    .option("--shortcode <name>", "emoji shortcode (e.g. thumbs_up)")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are supported.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, emoji, options, command] = args as [
          string,
          string | undefined,
          ReactionOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await createReactionForIssue(ctx.gql, {
          issueId,
          emoji: resolveReactionEmojiInput(emoji, options.shortcode),
        });

        outputResult(result, formatReactionCreated, getRootOpts(command));
      }),
    );

  issues
    .command("unreact <issue> [emoji]")
    .description("remove your root reaction from an issue by emoji")
    .option("--shortcode <name>", "emoji shortcode (e.g. thumbs_up)")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are supported.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, emoji, options, command] = args as [
          string,
          string | undefined,
          ReactionOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await deleteOwnReactionByEmoji(ctx.gql, {
          kind: "issue",
          id: issueId,
          emoji: resolveReactionEmojiInput(emoji, options.shortcode),
        });

        outputResult(result, formatReactionDeleted, getRootOpts(command));
      }),
    );

  issues
    .command("unreact-id <issue> <reactionId>")
    .description("remove your root reaction from an issue by reaction ID")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are supported.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, reactionId, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await deleteOwnReactionById(ctx.gql, {
          kind: "issue",
          id: issueId,
          reactionId,
        });

        outputResult(result, formatReactionDeleted, getRootOpts(command));
      }),
    );

  issues
    .command("discuss <issue>")
    .description("start a discussion thread on an issue")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are supported.\n\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive; one is required.\n\nFormatting: Linear renders comment bodies as markdown — structure long updates with headers, bullets, \`code\`, and fenced blocks (pipe tables do NOT render). Long single-paragraph bodies get a stderr formatting nudge (\`validation.on-comment\`, default warn).`,
    )
    .option("--body <text>", "discussion body (markdown supported)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          DiscussionBodyOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const body = requireCommentBody(options);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await startIssueDiscussion(ctx.gql, { issueId, body });

        outputResult(result, formatCommentCreated, getRootOpts(command));
      }),
    );

  issues
    .command("discussions <issue>")
    .description("list root discussion threads on an issue")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are supported.`,
    )
    .option("-l, --limit <n>", "max results", "25")
    .option("--after <cursor>", "cursor for next page")
    .option("--with-reactions", "include normalized discussion reactions")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          DiscussionsOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const paginationOptions = {
          limit: parseLimit(options.limit || "25"),
          after: options.after,
        };
        const result = options.withReactions
          ? await listDiscussionsForIssueWithReactions(
              ctx.gql,
              issueId,
              paginationOptions,
            )
          : await listDiscussionsForIssue(ctx.gql, issueId, paginationOptions);

        outputResult(result, formatCommentsList, getRootOpts(command));
      }),
    );

  const issueThreads = issues
    .command("threads")
    .description("discussion thread reaction operations");
  addCommentReactionCommands(issueThreads, "thread");

  const issueReplies = issues
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
              "issue",
            )
          : await listDiscussionReplies(
              ctx.gql,
              thread,
              paginationOptions,
              "issue",
            );

        outputResult(result, formatCommentsList, getRootOpts(command));
      }),
    );
  addCommentReactionCommands(issueReplies, "reply");

  issues
    .command("reply <thread>")
    .description("reply to a root discussion thread")
    .addHelpText(
      "after",
      "\nImportant: `<thread>` must be a root discussion thread ID.\n\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive; one is required.\n\nFormatting: Linear renders comment bodies as markdown — structure long updates with headers, bullets, `code`, and fenced blocks (pipe tables do NOT render). Long single-paragraph bodies get a stderr formatting nudge (`validation.on-comment`, default warn).",
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
          entityKind: "issue",
        });

        outputResult(result, formatCommentReplied, getRootOpts(command));
      }),
    );

  issues
    .command("edit <comment>")
    .description("edit a root discussion or reply comment")
    .addHelpText(
      "after",
      "\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive; one is required.\n\nFormatting: Linear renders comment bodies as markdown — structure long updates with headers, bullets, `code`, and fenced blocks (pipe tables do NOT render). Long single-paragraph bodies get a stderr formatting nudge (`validation.on-comment`, default warn).",
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
          { body },
          "issue",
        );

        outputResult(result, formatCommentEdited, getRootOpts(command));
      }),
    );

  issues
    .command("edit-reply <reply>")
    .description("edit a discussion reply")
    .addHelpText(
      "after",
      "\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive; one is required.\n\nFormatting: Linear renders comment bodies as markdown — structure long updates with headers, bullets, `code`, and fenced blocks (pipe tables do NOT render). Long single-paragraph bodies get a stderr formatting nudge (`validation.on-comment`, default warn).",
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
          { body },
          "issue",
        );

        outputResult(result, formatCommentEdited, getRootOpts(command));
      }),
    );

  issues
    .command("delete-comment <comment>")
    .description("delete a root discussion or reply comment")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [comment, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const result = await deleteDiscussionComment(ctx.gql, comment, "issue");

        outputResult(result, formatCommentDeleted, getRootOpts(command));
      }),
    );

  issues
    .command("delete-reply <reply>")
    .description("delete a discussion reply")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [reply, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const result = await deleteDiscussionReply(ctx.gql, reply, "issue");

        outputResult(result, formatCommentDeleted, getRootOpts(command));
      }),
    );

  issues
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
          entityKind: "issue",
        });

        outputResult(result, formatThreadResolved, getRootOpts(command));
      }),
    );

  issues
    .command("unresolve <thread>")
    .description("unresolve a discussion thread")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [thread, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const result = await unresolveDiscussion(ctx.gql, thread, "issue");

        outputResult(result, formatThreadUnresolved, getRootOpts(command));
      }),
    );
}
