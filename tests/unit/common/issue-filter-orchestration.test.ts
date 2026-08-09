import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultTeam } from "../../../src/common/config-store.js";
import { prepareIssueFilterOptions } from "../../../src/common/issue-filter-orchestration.js";

vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn().mockReturnValue(null),
}));

describe("prepareIssueFilterOptions", () => {
  beforeEach(() => {
    vi.mocked(getDefaultTeam).mockReset().mockReturnValue(null);
  });

  it("applies team.default before normalization", () => {
    vi.mocked(getDefaultTeam).mockReturnValueOnce("DEFAULT");

    const result = prepareIssueFilterOptions({ status: "In Progress" });

    expect(result.searchReferences).toEqual(
      expect.objectContaining({
        team: "DEFAULT",
        statusNames: ["In Progress"],
      }),
    );
  });

  it("does not read config when --team is explicit", () => {
    const result = prepareIssueFilterOptions({ team: "EXPLICIT" });

    expect(getDefaultTeam).not.toHaveBeenCalled();
    expect(result.searchReferences?.team).toBe("EXPLICIT");
  });

  it("does not read or apply team.default under --all-teams", () => {
    const result = prepareIssueFilterOptions({ allTeams: true });

    expect(getDefaultTeam).not.toHaveBeenCalled();
    expect(result.searchReferences).toBeUndefined();
  });
});
