import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCliHarness, hasLiveApiToken, parseJson } from "./cli-harness.js";

const harness = createCliHarness();
const { runLinear } = harness;

describe("Milestones CLI Commands", () => {
  beforeAll(() => {
    if (!hasLiveApiToken) {
      console.warn(
        "\nLINEAR_API_TOKEN not set - skipping live milestone tests\n",
      );
    }
  });

  afterAll(() => harness.cleanup());

  it("uses the kebab-case command name in domain and root help", async () => {
    const [{ stdout: domainHelp }, { stdout: rootHelp }] = await Promise.all([
      runLinear(["milestones", "--help"], { json: false }),
      runLinear(["--help"], { json: false }),
    ]);

    expect(domainHelp).toContain("Usage: linear milestones");
    expect(domainHelp).toContain("Project milestone operations");
    for (const command of ["list", "read", "create", "update"]) {
      expect(domainHelp).toContain(command);
    }
    expect(rootHelp).toContain("milestones");
    expect(rootHelp).not.toContain("projectMilestones");
  });

  it("does not expose the removed camelCase command", async () => {
    const { stdout } = await runLinear(["projectMilestones", "--help"], {
      json: false,
    });

    expect(stdout).toContain("Usage: linear [options] [command]");
    expect(stdout).not.toContain("projectMilestones ");
  });

  it("requires --project for milestone lists without making an API call", async () => {
    await expect(runLinear(["milestones", "list"])).rejects.toMatchObject({
      stderr: expect.stringContaining("--project"),
    });
  });

  it.skipIf(!hasLiveApiToken)(
    "lists milestones for an available project",
    { timeout: 30_000 },
    async () => {
      const { stdout: projectsOutput } = await runLinear([
        "projects",
        "list",
        "--limit",
        "1",
      ]);
      const projects = parseJson<{ nodes: Array<{ name: string }> }>(
        projectsOutput,
      );
      if (projects.nodes.length === 0) return;

      const { stdout } = await runLinear([
        "milestones",
        "list",
        "--project",
        projects.nodes[0].name,
      ]);
      const milestones = parseJson<{ nodes?: unknown[] } | unknown[]>(stdout);
      const nodes = Array.isArray(milestones) ? milestones : milestones.nodes;
      expect(Array.isArray(nodes)).toBe(true);
    },
  );
});
