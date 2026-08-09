import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  completionShells,
  filterIssueCompletions,
  formatIssueCompletions,
  generateScript,
  isCompletionShell,
  listIssueIdCompletions,
} from "../../../src/services/completions-service.js";

function mockGqlClient(response: Record<string, unknown>): GraphQLClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  } as unknown as GraphQLClient;
}

function mockGqlClientRejecting(): GraphQLClient {
  return {
    request: vi.fn().mockRejectedValue(new Error("network down")),
  } as unknown as GraphQLClient;
}

describe("completions-service", () => {
  describe("re-exports", () => {
    it("re-exports shell helpers from the templates module", () => {
      expect(isCompletionShell("bash")).toBe(true);
      expect(completionShells()).toEqual(["bash", "zsh", "fish"]);
    });
  });

  describe("generateScript", () => {
    it("returns a non-empty bash script", () => {
      const script = generateScript("bash");
      expect(script).toContain("__start_linear");
    });

    it("omits the description column when noDescriptions is set", () => {
      expect(generateScript("bash", true)).toContain("__completeNoDesc");
    });
  });

  describe("filterIssueCompletions", () => {
    it("filters by identifier prefix (case-insensitive)", () => {
      const result = filterIssueCompletions(
        [
          { identifier: "ENG-100", title: "Foo" },
          { identifier: "ENG-101", title: "Bar" },
          { identifier: "OPS-1", title: "Baz" },
        ],
        "eng-1",
      );
      expect(result).toEqual([
        { id: "ENG-100", title: "Foo" },
        { id: "ENG-101", title: "Bar" },
      ]);
    });

    it("returns all issues for an empty prefix", () => {
      const result = filterIssueCompletions(
        [
          { identifier: "ENG-1", title: "A" },
          { identifier: "OPS-2", title: "B" },
        ],
        "",
      );
      expect(result).toHaveLength(2);
    });

    it("skips issues without an identifier and defaults missing titles", () => {
      const result = filterIssueCompletions(
        [
          { identifier: null, title: "skip me" },
          { identifier: "ENG-7", title: null },
        ],
        "",
      );
      expect(result).toEqual([{ id: "ENG-7", title: "" }]);
    });
  });

  describe("formatIssueCompletions", () => {
    it("renders id\\ttitle lines by default", () => {
      const text = formatIssueCompletions([
        { id: "ENG-100", title: "Foo" },
        { id: "ENG-101", title: "Bar" },
      ]);
      expect(text).toBe("ENG-100\tFoo\nENG-101\tBar");
    });

    it("renders ids only when noDescriptions is set", () => {
      const text = formatIssueCompletions(
        [
          { id: "ENG-100", title: "Foo" },
          { id: "ENG-101", title: "Bar" },
        ],
        true,
      );
      expect(text).toBe("ENG-100\nENG-101");
    });
  });

  describe("listIssueIdCompletions", () => {
    it("queries issues and returns prefix-matched completions", async () => {
      const client = mockGqlClient({
        issues: {
          nodes: [
            { identifier: "ENG-100", title: "Foo" },
            { identifier: "ENG-101", title: "Bar" },
            { identifier: "OPS-9", title: "Other" },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      });
      const result = await listIssueIdCompletions(client, "ENG-1");
      expect(result).toEqual([
        { id: "ENG-100", title: "Foo" },
        { id: "ENG-101", title: "Bar" },
      ]);
      expect(client.request).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ first: 50 }),
      );
    });

    it("degrades to empty list on query failure (no throw)", async () => {
      const client = mockGqlClientRejecting();
      await expect(listIssueIdCompletions(client, "ENG-1")).resolves.toEqual(
        [],
      );
    });
  });
});
