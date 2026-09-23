import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  GetIssueReadCommentsPageDocument,
  ListIssuesForExportDocument,
} from "../../../src/gql/graphql.js";
import {
  exportIssues,
  projectIssueForExport,
  summarizeExport,
} from "../../../src/services/issue-export-service.js";

function issueNode(args: {
  id: string;
  identifier?: string;
  title?: string;
  description?: string | null;
  status?: string;
  priority?: number;
  labels?: string[];
  team?: { id: string; key: string; name: string } | null;
  parent?: { id: string; identifier: string; title: string } | null;
  children?: Array<{ id: string; identifier: string; title: string }>;
  assignee?: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
  inverseRelations?: Array<{
    id: string;
    type: string;
    issue: { id: string; identifier: string };
  }>;
  relations?: Array<{
    id: string;
    type: string;
    relatedIssue: { id: string; identifier: string };
  }>;
  comments?: Array<{
    id: string;
    body: string;
    createdAt: string;
    user?: { id: string; displayName: string } | null;
  }>;
  /** Cursor for more comments past this first page; unset means none. */
  moreCommentsAfter?: string;
}) {
  return {
    id: args.id,
    identifier: args.identifier ?? `ENG-${args.id}`,
    title: args.title ?? `Title ${args.id}`,
    description: args.description ?? null,
    state: { id: `s-${args.id}`, name: args.status ?? "Started" },
    priority: args.priority ?? 2,
    team:
      args.team === undefined
        ? { id: "t-1", key: "ENG", name: "Engineering" }
        : args.team,
    labels: {
      nodes: (args.labels ?? []).map((n) => ({ id: `l-${n}`, name: n })),
    },
    assignee: args.assignee ?? null,
    project: args.project ?? null,
    parent: args.parent ?? null,
    children: { nodes: args.children ?? [] },
    inverseRelations: { nodes: args.inverseRelations ?? [] },
    relations: { nodes: args.relations ?? [] },
    comments: {
      nodes: (args.comments ?? []).map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt,
        editedAt: null,
        parentId: null,
        user: c.user ?? null,
      })),
      pageInfo: {
        hasNextPage: args.moreCommentsAfter !== undefined,
        endCursor: args.moreCommentsAfter ?? null,
      },
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function pageResp(nodes: ReturnType<typeof issueNode>[], hasNext = false) {
  return {
    issues: {
      nodes,
      pageInfo: { hasNextPage: hasNext, endCursor: hasNext ? "c" : null },
    },
  };
}

function makeClient(handler: () => unknown): GraphQLClient {
  return { request: vi.fn(async () => handler()) } as unknown as GraphQLClient;
}

describe("projectIssueForExport — export shape", () => {
  it("emits _type='issue' and the flat field set", () => {
    const node = issueNode({
      id: "1",
      identifier: "ENG-1",
      title: "Fix bug",
      description: "details",
      status: "Done",
      priority: 1,
      labels: ["bug"],
      parent: { id: "p-1", identifier: "ENG-0", title: "Parent" },
      children: [{ id: "c-1", identifier: "ENG-2", title: "Child" }],
      assignee: { id: "u-1", name: "Alice" },
      project: { id: "p1", name: "Proj" },
      comments: [
        {
          id: "cm-1",
          body: "hi",
          createdAt: "2026-05-02T00:00:00.000Z",
          user: { id: "u-1", displayName: "Alice" },
        },
      ],
    });
    const line = projectIssueForExport(node);
    expect(line).toMatchObject({
      _type: "issue",
      id: "1",
      identifier: "ENG-1",
      title: "Fix bug",
      description: "details",
      status: "Done",
      priority: 1,
      team: { id: "t-1", key: "ENG", name: "Engineering" },
      labels: ["bug"],
      assignee: { id: "u-1", name: "Alice" },
      project: { id: "p1", name: "Proj" },
      parent: "ENG-0",
      children: ["ENG-2"],
    });
    expect(line.comments).toEqual([
      {
        id: "cm-1",
        body: "hi",
        author: "Alice",
        created_at: "2026-05-02T00:00:00.000Z",
      },
    ]);
  });

  it("derives dependencies from inverseRelations(type='blocks')", () => {
    const node = issueNode({
      id: "1",
      inverseRelations: [
        { id: "r1", type: "blocks", issue: { id: "b1", identifier: "ENG-99" } },
        {
          id: "r2",
          type: "duplicate",
          issue: { id: "b2", identifier: "ENG-77" },
        },
      ],
    });
    const line = projectIssueForExport(node);
    expect(line.dependencies).toEqual([
      { depends_on_identifier: "ENG-99", type: "blocks" },
    ]);
  });

  it("falls back to null description and missing fields", () => {
    const node = issueNode({ id: "2", description: null, team: null });
    const line = projectIssueForExport(node);
    expect(line.description).toBeNull();
    expect(line.team).toBeNull();
    expect(line.assignee).toBeNull();
    expect(line.parent).toBeNull();
  });

  it("maps comment without user.displayName to author=null", () => {
    const node = issueNode({
      id: "1",
      comments: [
        {
          id: "cm-1",
          body: "anon",
          createdAt: "2026-05-01T00:00:00.000Z",
          user: null,
        },
      ],
    });
    expect(projectIssueForExport(node).comments[0].author).toBeNull();
  });
});

describe("exportIssues — pagination", () => {
  it("walks pages while hasNextPage is true", async () => {
    let page = 0;
    const client = makeClient(() => {
      page += 1;
      if (page === 1) return pageResp([issueNode({ id: "1" })], true);
      return pageResp([issueNode({ id: "2" })], false);
    });
    const lines = await exportIssues({ client });
    expect(lines.map((l) => l.id)).toEqual(["1", "2"]);
  });

  it("passes includeArchived flag through", async () => {
    const request = vi.fn(async () => pageResp([issueNode({ id: "1" })]));
    const client = { request } as unknown as GraphQLClient;
    await exportIssues({ client, includeArchived: true });
    const variables = request.mock.calls[0]?.[1] as {
      includeArchived?: boolean;
    };
    expect(variables.includeArchived).toBe(true);
  });
});

describe("exportIssues comment paging", () => {
  function comment(id: string) {
    return {
      id,
      body: id,
      createdAt: "2026-05-01T00:00:00.000Z",
      editedAt: null,
      parentId: null,
      user: null,
    };
  }

  it("fetches remaining comments only for issues whose first page reports more", async () => {
    const request = vi.fn(async (document: unknown, variables: unknown) => {
      if (document === ListIssuesForExportDocument) {
        return pageResp([
          issueNode({
            id: "busy",
            comments: [{ id: "c1", body: "c1", createdAt: "x" }],
            moreCommentsAfter: "cursor-1",
          }),
          issueNode({
            id: "quiet",
            comments: [{ id: "q1", body: "q1", createdAt: "x" }],
          }),
        ]);
      }
      const { after } = variables as { after: string };
      return after === "cursor-1"
        ? {
            issue: {
              comments: {
                nodes: [comment("c2")],
                pageInfo: { hasNextPage: true, endCursor: "cursor-2" },
              },
            },
          }
        : {
            issue: {
              comments: {
                nodes: [comment("c3")],
                pageInfo: { hasNextPage: false, endCursor: "cursor-3" },
              },
            },
          };
    });
    const client = { request } as unknown as GraphQLClient;

    const lines = await exportIssues({ client });

    expect(lines[0].comments.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(lines[1].comments.map((c) => c.id)).toEqual(["q1"]);
    const commentPageCalls = request.mock.calls.filter(
      ([document]) => document === GetIssueReadCommentsPageDocument,
    );
    expect(commentPageCalls.map(([, variables]) => variables)).toEqual([
      { id: "busy", first: 250, after: "cursor-1" },
      { id: "busy", first: 250, after: "cursor-2" },
    ]);
  });

  it("fails rather than exporting a partial discussion when the issue vanishes", async () => {
    const request = vi.fn(async (document: unknown) =>
      document === ListIssuesForExportDocument
        ? pageResp([
            issueNode({
              id: "busy",
              comments: [{ id: "c1", body: "c1", createdAt: "x" }],
              moreCommentsAfter: "cursor-1",
            }),
          ])
        : { issue: null },
    );
    const client = { request } as unknown as GraphQLClient;

    await expect(exportIssues({ client })).rejects.toThrow(
      'Issue with ID "busy" not found',
    );
  });
});

describe("summarizeExport", () => {
  it("reports issue_count plus the wiring flags", () => {
    const lines = [
      projectIssueForExport(issueNode({ id: "1" })),
      projectIssueForExport(issueNode({ id: "2" })),
    ];
    expect(
      summarizeExport(lines, { filterApplied: true, includeArchived: false }),
    ).toEqual({
      issue_count: 2,
      filter_applied: true,
      include_archived: false,
    });
  });
});
