import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  listTodos,
  TODO_LABEL_NAME,
} from "../../../src/services/todo-service.js";

function makeClient(responses: unknown[]): GraphQLClient {
  const request = vi.fn();
  for (const r of responses) request.mockResolvedValueOnce(r);
  return { request } as unknown as GraphQLClient;
}

function todoNode(opts: {
  id?: string;
  identifier?: string;
  title?: string;
  priority?: number;
  stateType?: string;
}) {
  return {
    id: opts.id ?? "t-1",
    identifier: opts.identifier ?? "ENG-1",
    title: opts.title ?? "Buy milk",
    description: "",
    priority: opts.priority ?? 0,
    state: {
      id: "s",
      name: "Backlog",
      type: opts.stateType ?? "backlog",
    },
    team: { id: "team-a", key: "ENG", name: "Eng" },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    labels: { nodes: [{ id: "l-task", name: TODO_LABEL_NAME }] },
  };
}

function issuesPage(
  nodes: ReturnType<typeof todoNode>[],
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return { issues: { nodes, pageInfo: { hasNextPage, endCursor } } };
}

describe("listTodos", () => {
  it("defaults to OPEN todos only; --all relaxes the state filter", async () => {
    const requestSpy = vi.fn().mockResolvedValueOnce(issuesPage([]));
    const client = { request: requestSpy } as unknown as GraphQLClient;

    await listTodos(client);
    expect(requestSpy).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        filter: expect.objectContaining({
          labels: { name: { eq: TODO_LABEL_NAME } },
          state: { type: { in: expect.any(Array) } },
        }),
      }),
    );

    requestSpy.mockResolvedValueOnce(issuesPage([]));
    await listTodos(client, { all: true });
    const allCall = requestSpy.mock.calls[1]?.[1] as { filter: IssueFilter };
    expect(allCall.filter).not.toHaveProperty("state");
  });

  it("forwards --team to the issue filter", async () => {
    const requestSpy = vi.fn().mockResolvedValueOnce(issuesPage([]));
    const client = { request: requestSpy } as unknown as GraphQLClient;
    await listTodos(client, { teamId: "team-uuid" });
    expect(requestSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filter: expect.objectContaining({
          team: { id: { eq: "team-uuid" } },
        }),
      }),
    );
  });

  it("respects --limit and stops paginating once filled", async () => {
    const client = makeClient([
      issuesPage(
        [todoNode({ id: "t-1" }), todoNode({ id: "t-2" })],
        true,
        "cursor-1",
      ),
      issuesPage([todoNode({ id: "t-3" })], true, "cursor-2"),
    ]);
    const result = await listTodos(client, { limit: 3 });
    expect(result).toHaveLength(3);
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      2,
    );
  });

  it("sorts by priority asc with no-priority (0) bumped to the end", async () => {
    const client = makeClient([
      issuesPage([
        todoNode({ id: "a", identifier: "ENG-1", priority: 0 }),
        todoNode({ id: "b", identifier: "ENG-2", priority: 3 }),
        todoNode({ id: "c", identifier: "ENG-3", priority: 1 }),
        todoNode({ id: "d", identifier: "ENG-4", priority: 1 }),
      ]),
    ]);
    const result = await listTodos(client);
    expect(result.map((r) => r.identifier)).toEqual([
      "ENG-3",
      "ENG-4",
      "ENG-2",
      "ENG-1",
    ]);
  });

  it("returns [] when no todos exist", async () => {
    const client = makeClient([issuesPage([])]);
    const result = await listTodos(client);
    expect(result).toEqual([]);
  });
});

// Helper type used by the filter assertion above.
type IssueFilter = {
  labels: unknown;
  state?: unknown;
  team?: unknown;
};
