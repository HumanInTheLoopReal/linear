import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { CORE_TYPES, listTypes } from "../../../src/services/types-service.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listTypes", () => {
  it("queries IssueLabels with the 'type:' prefix filter", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: { nodes: [] },
    });
    const client = { request } as unknown as GraphQLClient;

    await listTypes(client);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        filter: { name: { startsWith: "type:" } },
      }),
    );
  });

  it("always returns the full hardcoded CORE_TYPES list", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: { nodes: [] },
    });
    const client = { request } as unknown as GraphQLClient;

    const result = await listTypes(client);

    expect(result.core_types).toEqual(CORE_TYPES);
    expect(result.core_types.map((t) => t.name)).toEqual([
      "task",
      "bug",
      "feature",
      "chore",
      "epic",
      "decision",
      "spike",
      "story",
      "milestone",
    ]);
  });

  it("returns [] custom_types when no labels match", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: { nodes: [] },
    });
    const client = { request } as unknown as GraphQLClient;

    const result = await listTypes(client);
    expect(result.custom_types).toEqual([]);
  });

  it("strips the 'type:' prefix and excludes core type names", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: {
        nodes: [
          { id: "l1", name: "type:research" },
          { id: "l2", name: "type:bug" }, // core — must be filtered out
          { id: "l3", name: "type:port" },
          { id: "l4", name: "type:task" }, // core
        ],
      },
    });
    const client = { request } as unknown as GraphQLClient;

    const result = await listTypes(client);
    expect(result.custom_types).toEqual(["port", "research"]);
  });

  it("dedupes by name and sorts ascending", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: {
        nodes: [
          { id: "l1", name: "type:zeta" },
          { id: "l2", name: "type:alpha" },
          { id: "l3", name: "type:alpha" }, // duplicate name from two teams
          { id: "l4", name: "type:mu" },
        ],
      },
    });
    const client = { request } as unknown as GraphQLClient;

    const result = await listTypes(client);
    expect(result.custom_types).toEqual(["alpha", "mu", "zeta"]);
  });

  it("ignores empty suffixes ('type:' label alone)", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issueLabels: {
        nodes: [
          { id: "l1", name: "type:" },
          { id: "l2", name: "type:research" },
        ],
      },
    });
    const client = { request } as unknown as GraphQLClient;

    const result = await listTypes(client);
    expect(result.custom_types).toEqual(["research"]);
  });
});
