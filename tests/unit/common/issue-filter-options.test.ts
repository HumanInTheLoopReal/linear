import { describe, expect, it } from "vitest";
import { normalizeIssueFilterOptions } from "../../../src/common/issue-filter-options.js";

describe("normalizeIssueFilterOptions", () => {
  it("returns direct options without inventing network references", () => {
    const result = normalizeIssueFilterOptions({
      priority: "2",
      estimate: "5",
      dueAfter: "2025-01-01",
      dueBefore: "2025-12-31",
      createdAfter: "2025-02-01",
      createdBefore: "2025-11-30",
      completedAfter: "2025-03-01",
      completedBefore: "2025-10-31",
      updatedAfter: "2025-04-01",
      updatedBefore: "2025-09-30",
      hasBlockers: true,
      isBlocking: false,
    });

    expect(result.searchReferences).toBeUndefined();
    expect(result.milestoneReference).toBeUndefined();
    expect(result.directOptions).toEqual({
      priority: 2,
      estimate: 5,
      dueAfter: "2025-01-01",
      dueBefore: "2025-12-31",
      createdAfter: "2025-02-01",
      createdBefore: "2025-11-30",
      completedAfter: "2025-03-01",
      completedBefore: "2025-10-31",
      updatedAfter: "2025-04-01",
      updatedBefore: "2025-09-30",
      hasBlockers: true,
      isBlocking: false,
      labelPatternFilters: undefined,
    });
  });

  it("normalizes human references and comma-separated lists", () => {
    const result = normalizeIssueFilterOptions({
      team: "ENG",
      assignee: "alice",
      creator: "bob",
      project: "Backend",
      status: "Todo, In Progress",
      label: "Bug,Critical",
      cycle: "Sprint 1",
      parent: "ENG-123",
      milestone: "v1.0",
    });

    expect(result.searchReferences).toEqual({
      team: "ENG",
      assignee: "alice",
      creator: "bob",
      project: "Backend",
      statusNames: ["Todo", "In Progress"],
      labelNames: ["Bug", "Critical"],
      cycle: "Sprint 1",
      parent: "ENG-123",
    });
    expect(result.milestoneReference).toEqual({
      milestone: "v1.0",
      project: "Backend",
    });
  });

  it("uses a supplied default team when no team flag is present", () => {
    const result = normalizeIssueFilterOptions(
      { status: "In Progress" },
      "DEFAULT",
    );

    expect(result.searchReferences).toEqual({
      team: "DEFAULT",
      assignee: undefined,
      creator: undefined,
      project: undefined,
      statusNames: ["In Progress"],
      labelNames: undefined,
      cycle: undefined,
      parent: undefined,
    });
  });

  it("prefers an explicit team over the supplied default", () => {
    const result = normalizeIssueFilterOptions({ team: "EXPLICIT" }, "DEFAULT");
    expect(result.searchReferences?.team).toBe("EXPLICIT");
  });

  it("honors --all-teams by ignoring the supplied default", () => {
    const result = normalizeIssueFilterOptions({ allTeams: true }, "DEFAULT");
    expect(result.searchReferences).toBeUndefined();
  });

  it("compiles a label glob into a direct server-side filter", () => {
    const result = normalizeIssueFilterOptions({ labelPattern: "type:*" });

    expect(result.searchReferences).toBeUndefined();
    expect(result.directOptions.labelPatternFilters).toEqual([
      { labels: { some: { name: { startsWith: "type:" } } } },
    ]);
  });

  it("rejects mutually exclusive exact and glob label filters", () => {
    expect(() =>
      normalizeIssueFilterOptions({ label: "Bug", labelPattern: "type:*" }),
    ).toThrow(/cannot be combined with --label/);
  });

  it("wraps invalid label globs as parameter errors", () => {
    expect(() => normalizeIssueFilterOptions({ labelPattern: "a*b" })).toThrow(
      /interior or multi/,
    );
  });

  it.each([
    [{ priority: "abc" }, "--priority"],
    [{ priority: "5" }, "priority"],
    [{ estimate: "2abc" }, "--estimate"],
    [{ estimate: "-1" }, "estimate"],
  ] as const)("rejects invalid numeric flags %#", (flags, message) => {
    expect(() => normalizeIssueFilterOptions(flags)).toThrow(message);
  });

  it.each([
    [{ status: "In Progress" }, "--team"],
    [{ cycle: "Sprint 1" }, "--team"],
    [{ milestone: "v1.0" }, "--project"],
  ] as const)("validates reference dependencies %#", (flags, message) => {
    expect(() => normalizeIssueFilterOptions(flags)).toThrow(message);
  });

  it("allows UUID references without their disambiguating parent", () => {
    const result = normalizeIssueFilterOptions({
      status: "550e8400-e29b-41d4-a716-446655440000",
      cycle: "550e8400-e29b-41d4-a716-446655440001",
      milestone: "550e8400-e29b-41d4-a716-446655440002",
    });

    expect(result.searchReferences?.statusNames).toEqual([
      "550e8400-e29b-41d4-a716-446655440000",
    ]);
    expect(result.searchReferences?.cycle).toBe(
      "550e8400-e29b-41d4-a716-446655440001",
    );
    expect(result.milestoneReference).toEqual({
      milestone: "550e8400-e29b-41d4-a716-446655440002",
      project: undefined,
    });
  });

  it.each([
    [{ team: "ENG", status: "Todo,,Done" }, "empty"],
    [{ label: "bug, ,ux" }, "empty"],
    [{ dueBefore: "not-a-date" }, "--due-before"],
    [{ dueAfter: "2025-12-31", dueBefore: "2025-01-01" }, "due date"],
  ] as const)("rejects malformed input %#", (flags, message) => {
    expect(() => normalizeIssueFilterOptions(flags)).toThrow(message);
  });
});
