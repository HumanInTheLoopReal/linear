//
// Format tests for `linear comments` text-default output (lin-f5lc).
// Seven distinct formatters because each subcommand returns its own
// shape — list of comment blocks, single-comment mutation echoes
// (created/replied/edited), delete acknowledgment, reaction acknowledgments.
//
// The `linear issues discussion` subcommands reuse these same formatters
// rather than growing a parallel set that can drift.

import { describe, expect, it } from "vitest";
import {
  formatCommentCreated,
  formatCommentDeleted,
  formatCommentEdited,
  formatCommentReplied,
  formatCommentsList,
  formatReactionCreated,
  formatReactionDeleted,
} from "../../../src/commands/comments.js";

function comment(overrides: Record<string, unknown> = {}) {
  return {
    id: "comment-1",
    body: "Hello world",
    createdAt: "2026-05-16T10:30:00.000Z",
    editedAt: null,
    parentId: null,
    resolvedAt: null,
    resolvingUser: null,
    user: { id: "u-1", displayName: "Alex Doe" },
    ...overrides,
  };
}

describe("formatCommentsList", () => {
  it("returns `(no comments)` placeholder when nodes is empty", () => {
    const out = formatCommentsList({ nodes: [] });
    expect(out).toBe("(no comments)\n");
  });

  it("renders 💬 header with count and per-comment block", () => {
    const out = formatCommentsList({ nodes: [comment()] });
    expect(out).toContain("💬 Comments (1):\n");
    expect(out).toContain("◆ Alex Doe · 2026-05-16 10:30\n");
    expect(out).toContain("  Hello world\n");
    expect(out).toContain("  id: comment-1\n");
  });

  it("renders an inline comment's anchor as a quote line above the body", () => {
    const out = formatCommentsList({
      nodes: [comment({ quotedText: "the sentence being commented on" })],
    });
    expect(out).toContain(
      "◆ Alex Doe · 2026-05-16 10:30\n  > the sentence being commented on\n  Hello world\n",
    );
  });

  it("collapses newlines in a multi-line anchor onto one quote line", () => {
    const out = formatCommentsList({
      nodes: [comment({ quotedText: "first line\n\nsecond line  " })],
    });
    expect(out).toContain("  > first line second line\n");
  });

  it("omits the quote line for comments with no anchor", () => {
    const out = formatCommentsList({ nodes: [comment({ quotedText: null })] });
    expect(out).not.toContain("  > ");
  });

  it("flags edited comments with [edited]", () => {
    const out = formatCommentsList({
      nodes: [comment({ editedAt: "2026-05-16T11:00:00.000Z" })],
    });
    expect(out).toContain("[edited]");
  });

  it("flags resolved comments with resolver name", () => {
    const out = formatCommentsList({
      nodes: [
        comment({
          resolvedAt: "2026-05-16T12:00:00.000Z",
          resolvingUser: { id: "u-2", displayName: "Sam Smith" },
        }),
      ],
    });
    expect(out).toContain("[resolved by Sam Smith]");
  });

  it("blank-line-separates multiple comments", () => {
    const out = formatCommentsList({
      nodes: [
        comment({ id: "c-1", body: "first" }),
        comment({ id: "c-2", body: "second" }),
      ],
    });
    expect(out).toContain("  id: c-1\n\n◆");
  });

  it("appends pagination hint when hasNextPage", () => {
    const out = formatCommentsList({
      nodes: [comment()],
      pageInfo: { hasNextPage: true, endCursor: "cursor-abc" },
    });
    expect(out).toContain("(more — next page cursor: cursor-abc)");
  });

  it("indents multi-line bodies", () => {
    const out = formatCommentsList({
      nodes: [comment({ body: "line one\nline two" })],
    });
    expect(out).toContain("  line one\n");
    expect(out).toContain("  line two\n");
  });
});

describe("formatCommentCreated", () => {
  it("renders the created header + by-line + id + body", () => {
    const out = formatCommentCreated(comment());
    expect(out).toContain("✓ Comment created\n");
    expect(out).toContain("  by Alex Doe · 2026-05-16 10:30\n");
    expect(out).toContain("  id: comment-1\n");
    expect(out).toContain("  Hello world");
  });

  it("falls back to bare line when comment is null", () => {
    const out = formatCommentCreated(null);
    expect(out).toBe("✓ Comment created\n");
  });
});

describe("formatCommentReplied", () => {
  it("renders the reply header + parent thread + by-line + body", () => {
    const out = formatCommentReplied(comment({ parentId: "thread-99" }));
    expect(out).toContain("✓ Reply posted\n");
    expect(out).toContain("  to thread: thread-99\n");
    expect(out).toContain("  by Alex Doe · 2026-05-16 10:30\n");
    expect(out).toContain("  id: comment-1\n");
  });
});

describe("formatCommentEdited", () => {
  it("uses ✏ + edited timestamp", () => {
    const out = formatCommentEdited(
      comment({ editedAt: "2026-05-16T15:45:00.000Z" }),
    );
    expect(out).toContain("✏ Comment edited\n");
    expect(out).toContain("  by Alex Doe · 2026-05-16 15:45\n");
  });
});

describe("formatCommentDeleted", () => {
  it("renders a single ✓ acknowledgment", () => {
    expect(formatCommentDeleted({ id: "comment-1", success: true })).toBe(
      "✓ Comment deleted (id: comment-1)\n",
    );
  });
});

describe("formatReactionCreated", () => {
  it("renders ✓ + emoji + comment + reaction id", () => {
    const out = formatReactionCreated({
      id: "react-1",
      emoji: "👍",
      comment: { id: "comment-1" },
    });
    expect(out).toContain("✓ Reaction added: 👍\n");
    expect(out).toContain("  comment: comment-1\n");
    expect(out).toContain("  reaction id: react-1\n");
  });
});

describe("formatReactionDeleted", () => {
  it("renders ✓ + reaction id", () => {
    expect(formatReactionDeleted({ id: "react-1", success: true })).toBe(
      "✓ Reaction removed (id: react-1)\n",
    );
  });
});
