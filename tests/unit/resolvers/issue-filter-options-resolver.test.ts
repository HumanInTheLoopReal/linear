import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import type { LinearSdkClient } from "../../../src/client/linear-client.js";
import { normalizeIssueFilterOptions } from "../../../src/common/issue-filter-options.js";
import { resolveFilterOptions } from "../../../src/resolvers/issue-filter-options-resolver.js";
import { resolveSearchFilterIds } from "../../../src/resolvers/issue-filter-resolver.js";
import { resolveMilestoneId } from "../../../src/resolvers/milestone-resolver.js";

vi.mock("../../../src/resolvers/issue-filter-resolver.js", () => ({
  resolveSearchFilterIds: vi.fn().mockResolvedValue({
    teamId: "team-uuid",
    projectId: "project-uuid",
    stateIds: ["status-uuid"],
  }),
}));

vi.mock("../../../src/resolvers/milestone-resolver.js", () => ({
  resolveMilestoneId: vi.fn().mockResolvedValue("milestone-uuid"),
}));

const sdk = {} as unknown as LinearSdkClient;
const gql = {} as unknown as GraphQLClient;

describe("resolveFilterOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns direct options without requiring a GraphQL client", async () => {
    const result = await resolveFilterOptions(
      sdk,
      normalizeIssueFilterOptions({ priority: "2", estimate: "5" }),
    );

    expect(resolveSearchFilterIds).not.toHaveBeenCalled();
    expect(resolveMilestoneId).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ priority: 2, estimate: 5 }),
    );
  });

  it("resolves normalized search references through the SDK", async () => {
    const normalized = normalizeIssueFilterOptions({
      team: "ENG",
      project: "Backend",
      status: "Todo",
      priority: "2",
    });

    const result = await resolveFilterOptions(sdk, normalized);

    expect(resolveSearchFilterIds).toHaveBeenCalledWith(
      sdk,
      normalized.searchReferences,
    );
    expect(result).toEqual(
      expect.objectContaining({
        teamId: "team-uuid",
        projectId: "project-uuid",
        stateIds: ["status-uuid"],
        priority: 2,
      }),
    );
  });

  it("uses the GraphQL exception seam only for milestone resolution", async () => {
    const normalized = normalizeIssueFilterOptions({
      project: "Backend",
      milestone: "v1.0",
    });

    await resolveFilterOptions(sdk, normalized, gql);

    expect(resolveMilestoneId).toHaveBeenCalledWith(
      gql,
      sdk,
      "v1.0",
      "Backend",
    );
  });

  it("fails clearly when a milestone lacks its GraphQL exception dependency", async () => {
    const normalized = normalizeIssueFilterOptions({
      milestone: "550e8400-e29b-41d4-a716-446655440002",
    });

    await expect(resolveFilterOptions(sdk, normalized)).rejects.toThrow(
      "Milestone filter resolution requires the milestone GraphQL client",
    );
    expect(resolveMilestoneId).not.toHaveBeenCalled();
  });
});
