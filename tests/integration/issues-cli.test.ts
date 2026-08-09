import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCliHarness, hasLiveApiToken, parseJson } from "./cli-harness.js";

const harness = createCliHarness();
const { runLinear } = harness;

describe("Issues CLI lifecycle", () => {
  beforeAll(() => {
    if (!hasLiveApiToken) {
      console.warn(
        "\nLINEAR_API_TOKEN not set - skipping issues lifecycle integration tests\n",
      );
    }
  });

  afterAll(() => harness.cleanup());

  it("shows lifecycle subcommands in issues help", async () => {
    const { stdout } = await runLinear(["issues", "--help"], { json: false });

    expect(stdout).toContain("archive");
    expect(stdout).toContain("unarchive");
    expect(stdout).toContain("delete");
  });

  it.skipIf(!hasLiveApiToken)(
    "creates temporary issue and runs archive/unarchive/delete lifecycle",
    { timeout: 90_000 },
    async () => {
      let cleanupIssueId: string | undefined;
      try {
        const teamsResult = await runLinear(["teams", "list", "--limit", "1"]);
        const teams = parseJson<{ nodes: Array<{ key: string }> }>(
          teamsResult.stdout,
        );

        expect(teams.nodes.length).toBeGreaterThan(0);
        const teamKey = teams.nodes[0].key;
        const title = `issue-lifecycle-e2e-${Date.now()}`;
        const createdResult = await runLinear([
          "issues",
          "create",
          title,
          "--team",
          teamKey,
          "--no-validate",
        ]);
        const createdIssue = parseJson<{ id: string; identifier: string }>(
          createdResult.stdout,
        );
        cleanupIssueId = createdIssue.id;

        expect(createdIssue.id).toBeTruthy();
        expect(createdIssue.identifier).toMatch(
          new RegExp(`^${teamKey}-\\d+$`, "i"),
        );

        const archivedResult = await runLinear([
          "issues",
          "archive",
          createdIssue.identifier,
        ]);
        const archivedIssue = parseJson<{ id: string }>(archivedResult.stdout);
        expect(archivedIssue.id).toBe(createdIssue.id);

        const unarchivedResult = await runLinear([
          "issues",
          "unarchive",
          createdIssue.id,
        ]);
        const unarchivedIssue = parseJson<{ id: string }>(
          unarchivedResult.stdout,
        );
        expect(unarchivedIssue.id).toBe(createdIssue.id);

        const deletedResult = await runLinear([
          "issues",
          "delete",
          createdIssue.identifier,
        ]);
        const deletedPayload = parseJson<{ id: string; success: boolean }>(
          deletedResult.stdout,
        );
        expect(deletedPayload).toEqual({
          id: createdIssue.id,
          success: true,
        });
        cleanupIssueId = undefined;
      } finally {
        if (cleanupIssueId) {
          await runLinear(["issues", "delete", cleanupIssueId]).catch(() => {});
        }
      }
    },
  );
});
