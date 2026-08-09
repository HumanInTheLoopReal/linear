import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  parseChecklist,
  toggleChecklistItem,
} from "../../../src/services/issue-service.js";

const DESCRIPTION = [
  "## Context",
  "",
  "component sweep",
  "",
  "## Checklist",
  "",
  "- [ ] Header audit",
  "- [x] Footer audit",
  "- [ ] Sidebar audit",
  "- [ ] Sidebar polish",
  "",
  "## Notes",
  "",
  "- plain bullet, not a checkbox",
].join("\n");

function clientWithIssue(description: string, extra: unknown[] = []) {
  const request = vi.fn().mockResolvedValueOnce({
    issue: {
      id: "uuid-1",
      identifier: "TES-9",
      title: "Sweep",
      description,
    },
  });
  for (const response of extra) request.mockResolvedValueOnce(response);
  return { request } as unknown as GraphQLClient;
}

function updateResponse(description: string) {
  return {
    issueUpdate: {
      success: true,
      issue: { id: "uuid-1", identifier: "TES-9", description },
    },
  };
}

describe("parseChecklist", () => {
  it("finds only checkbox lines, with state and 1-based index", () => {
    const items = parseChecklist(DESCRIPTION);
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({
      index: 1,
      checked: false,
      text: "Header audit",
    });
    expect(items[1].checked).toBe(true);
  });

  it("returns empty for descriptions without checkboxes", () => {
    expect(parseChecklist("just prose\n- plain bullet")).toEqual([]);
  });
});

describe("toggleChecklistItem", () => {
  it("checks one line by unique substring, leaving the rest untouched", async () => {
    const client = clientWithIssue(DESCRIPTION, [updateResponse("")]);
    const result = await toggleChecklistItem(client, "uuid-1", "header", true);
    expect(result.changed).toBe(true);
    expect(result.item).toEqual({
      index: 1,
      checked: true,
      text: "Header audit",
    });
    expect(result.checked_count).toBe(2);
    expect(result.total_count).toBe(4);
    const sent = (
      client as unknown as {
        request: { mock: { calls: Array<[unknown, unknown]> } };
      }
    ).request.mock.calls[1][1] as { input: { description: string } };
    expect(sent.input.description).toBe(
      DESCRIPTION.replace("- [ ] Header audit", "- [x] Header audit"),
    );
  });

  it("matches by 1-based checklist number", async () => {
    const client = clientWithIssue(DESCRIPTION, [updateResponse("")]);
    const result = await toggleChecklistItem(client, "uuid-1", "3", true);
    expect(result.item.text).toBe("Sidebar audit");
  });

  it("unchecks a checked line", async () => {
    const client = clientWithIssue(DESCRIPTION, [updateResponse("")]);
    const result = await toggleChecklistItem(client, "uuid-1", "footer", false);
    expect(result.changed).toBe(true);
    expect(result.checked_count).toBe(0);
  });

  it("is an idempotent no-op when already in the requested state", async () => {
    const client = clientWithIssue(DESCRIPTION);
    const result = await toggleChecklistItem(client, "uuid-1", "footer", true);
    expect(result.changed).toBe(false);
    // no issueUpdate call happened
    expect(
      (client as unknown as { request: { mock: { calls: unknown[] } } }).request
        .mock.calls,
    ).toHaveLength(1);
  });

  it("rejects ambiguous matches, listing the candidates", async () => {
    await expect(
      toggleChecklistItem(
        clientWithIssue(DESCRIPTION),
        "uuid-1",
        "sidebar",
        true,
      ),
    ).rejects.toThrow(
      /matches 2 checklist items[\s\S]*Sidebar audit[\s\S]*Sidebar polish/,
    );
  });

  it("rejects missing matches, listing all items", async () => {
    await expect(
      toggleChecklistItem(clientWithIssue(DESCRIPTION), "uuid-1", "nope", true),
    ).rejects.toThrow(/no checklist item matching "nope"[\s\S]*Header audit/);
  });

  it("errors clearly when the description has no checklist at all", async () => {
    await expect(
      toggleChecklistItem(clientWithIssue("prose only"), "uuid-1", "x", true),
    ).rejects.toThrow(/no checklist items/);
  });
});
