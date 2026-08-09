import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  GetIssueHistoryDocument,
  ListCommentsDocument,
} from "../../../src/gql/graphql.js";
import { getIssueActivity } from "../../../src/services/activity-service.js";

const ISSUE = { id: "issue-1", identifier: "ENG-1", title: "Ship it" };

function historyResponse(
  nodes: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    issue: {
      ...ISSUE,
      history: {
        nodes,
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };
}

function commentsResponse(
  nodes: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    issue: {
      comments: {
        nodes,
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };
}

/**
 * `getIssueActivity` fans out to two documents through one client, so the
 * mock dispatches on document identity rather than call order.
 */
function mockGqlClient(
  history: Record<string, unknown>,
  comments: Record<string, unknown>,
): GraphQLClient {
  return {
    request: vi.fn().mockImplementation((document: unknown) => {
      if (document === GetIssueHistoryDocument) return Promise.resolve(history);
      if (document === ListCommentsDocument) return Promise.resolve(comments);
      throw new Error("unexpected document");
    }),
  } as unknown as GraphQLClient;
}

/**
 * Same dispatch, but the comment half answers a different page per call so a
 * paging loop can be observed end to end.
 */
function mockGqlClientPagedComments(
  history: Record<string, unknown>,
  commentPages: Array<Record<string, unknown>>,
): GraphQLClient {
  let page = 0;
  return {
    request: vi.fn().mockImplementation((document: unknown) => {
      if (document === GetIssueHistoryDocument) return Promise.resolve(history);
      if (document === ListCommentsDocument) {
        const response = commentPages[page];
        page += 1;
        if (!response) throw new Error("comment pages exhausted");
        return Promise.resolve(response);
      }
      throw new Error("unexpected document");
    }),
  } as unknown as GraphQLClient;
}

function commentPage(
  nodes: Array<Record<string, unknown>>,
  endCursor: string | null,
): Record<string, unknown> {
  return {
    issue: {
      comments: {
        nodes,
        pageInfo: { hasNextPage: endCursor !== null, endCursor },
      },
    },
  };
}

const STATE_EVENT = {
  id: "event-1",
  createdAt: "2026-08-02T10:00:00.000Z",
  actor: { id: "u1", name: "Ada", displayName: "ada", email: "a@b.c" },
  fromState: { id: "s1", name: "Todo", type: "unstarted" },
  toState: { id: "s2", name: "In Progress", type: "started" },
};

const ROOT_COMMENT = {
  id: "comment-1",
  body: "Starting on this",
  createdAt: "2026-08-01T09:00:00.000Z",
  parentId: null,
  user: { id: "u1", displayName: "ada" },
};

const REPLY_COMMENT = {
  id: "comment-2",
  body: "Thanks",
  createdAt: "2026-08-03T11:00:00.000Z",
  parentId: "comment-1",
  user: { id: "u2", displayName: "bob" },
};

describe("getIssueActivity", () => {
  it("merges comments and events into one newest-first timeline", async () => {
    const client = mockGqlClient(
      historyResponse([STATE_EVENT]),
      commentsResponse([ROOT_COMMENT, REPLY_COMMENT]),
    );

    const result = await getIssueActivity(client, "issue-1");

    expect(result.issue.identifier).toBe("ENG-1");
    expect(result.entries.map((entry) => entry.id)).toEqual([
      "comment-2",
      "event-1",
      "comment-1",
    ]);
    expect(result.entries.map((entry) => entry.kind)).toEqual([
      "comment",
      "event",
      "comment",
    ]);
    expect(result.total).toBe(3);
  });

  it("carries comment body and parent id, and event deltas", async () => {
    const client = mockGqlClient(
      historyResponse([STATE_EVENT]),
      commentsResponse([REPLY_COMMENT]),
    );

    const result = await getIssueActivity(client, "issue-1");

    const reply = result.entries.find((entry) => entry.id === "comment-2");
    expect(reply?.body).toBe("Thanks");
    expect(reply?.parentId).toBe("comment-1");
    expect(reply?.event).toBeNull();

    const event = result.entries.find((entry) => entry.id === "event-1");
    expect(event?.body).toBeNull();
    expect(event?.event?.toState).toEqual({
      id: "s2",
      name: "In Progress",
      type: "started",
    });
  });

  it("drops history events under commentsOnly", async () => {
    const client = mockGqlClient(
      historyResponse([STATE_EVENT]),
      commentsResponse([ROOT_COMMENT]),
    );

    const result = await getIssueActivity(client, "issue-1", {
      commentsOnly: true,
    });

    expect(result.entries.map((entry) => entry.id)).toEqual(["comment-1"]);
    expect(result.issue.identifier).toBe("ENG-1");
  });

  it("truncates to the limit, keeping the newest entries", async () => {
    const client = mockGqlClient(
      historyResponse([STATE_EVENT]),
      commentsResponse([ROOT_COMMENT, REPLY_COMMENT]),
    );

    const result = await getIssueActivity(client, "issue-1", { limit: 2 });

    expect(result.entries.map((entry) => entry.id)).toEqual([
      "comment-2",
      "event-1",
    ]);
    expect(result.total).toBe(2);
  });

  it("resumes after a cursor entry", async () => {
    const client = mockGqlClient(
      historyResponse([STATE_EVENT]),
      commentsResponse([ROOT_COMMENT, REPLY_COMMENT]),
    );

    const result = await getIssueActivity(client, "issue-1", {
      after: "event-1",
    });

    expect(result.entries.map((entry) => entry.id)).toEqual(["comment-1"]);
  });

  it("throws when the cursor entry is not on this issue", async () => {
    const client = mockGqlClient(
      historyResponse([STATE_EVENT]),
      commentsResponse([ROOT_COMMENT]),
    );

    await expect(
      getIssueActivity(client, "issue-1", { after: "nope" }),
    ).rejects.toThrow('Activity cursor "nope" not found');
  });

  it("pages the discussion half until the connection is exhausted", async () => {
    const client = mockGqlClientPagedComments(historyResponse([STATE_EVENT]), [
      commentPage([ROOT_COMMENT], "cursor-1"),
      commentPage([REPLY_COMMENT], null),
    ]);

    const result = await getIssueActivity(client, "issue-1");

    expect(result.entries.map((entry) => entry.id)).toEqual([
      "comment-2",
      "event-1",
      "comment-1",
    ]);
    expect(client.request).toHaveBeenCalledWith(
      ListCommentsDocument,
      expect.objectContaining({ after: "cursor-1" }),
    );
  });

  it("accepts a cursor pointing at a comment from a later page", async () => {
    const client = mockGqlClientPagedComments(historyResponse([STATE_EVENT]), [
      commentPage([REPLY_COMMENT], "cursor-1"),
      commentPage([ROOT_COMMENT], null),
    ]);

    const result = await getIssueActivity(client, "issue-1", {
      after: "comment-1",
    });

    expect(result.entries).toEqual([]);
  });

  // A connection that promises another page but withholds the cursor leaves no
  // way to finish the walk. Truncating there would silently hand back a partial
  // timeline, so the fetch fails closed instead.
  it("throws when a page promises more but returns no cursor", async () => {
    const client = mockGqlClientPagedComments(historyResponse([STATE_EVENT]), [
      {
        issue: {
          comments: {
            nodes: [ROOT_COMMENT],
            pageInfo: { hasNextPage: true, endCursor: null },
          },
        },
      },
    ]);

    await expect(getIssueActivity(client, "issue-1")).rejects.toThrow(
      "comment pagination returned no cursor; timeline would be incomplete",
    );
  });

  it("throws when the connection hands back a cursor it already served", async () => {
    const client = mockGqlClientPagedComments(historyResponse([STATE_EVENT]), [
      commentPage([ROOT_COMMENT], "cursor-1"),
      commentPage([REPLY_COMMENT], "cursor-1"),
    ]);

    await expect(getIssueActivity(client, "issue-1")).rejects.toThrow(
      'comment pagination repeated cursor "cursor-1"; timeline would be incomplete',
    );
  });

  it("returns an empty timeline when the issue has no activity", async () => {
    const client = mockGqlClient(historyResponse([]), commentsResponse([]));

    const result = await getIssueActivity(client, "issue-1");

    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
  });
});
