import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCliHarness, hasLiveApiToken, parseJson } from "./cli-harness.js";

const harness = createCliHarness();
const { runLinear } = harness;

describe("Teams CLI Commands", () => {
  beforeAll(() => {
    if (!hasLiveApiToken) {
      console.warn("\nLINEAR_API_TOKEN not set - skipping live team tests\n");
    }
  });

  afterAll(() => harness.cleanup());

  it("displays help text", async () => {
    const { stdout } = await runLinear(["teams", "--help"], { json: false });
    expect(stdout).toContain("Usage: linear teams");
    expect(stdout).toContain("Team operations");
    expect(stdout).toContain("list");
  });

  it.skipIf(!hasLiveApiToken)("lists sorted teams as JSON", async () => {
    const { stdout, stderr } = await runLinear(["teams", "list"]);
    expect(stderr).not.toContain("error");

    const response = parseJson<{
      nodes: Array<{ id: string; key: string; name: string }>;
    }>(stdout);
    expect(response.nodes.length).toBeGreaterThan(0);
    for (const team of response.nodes) {
      expect(team).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          key: expect.any(String),
          name: expect.any(String),
        }),
      );
    }
    for (let index = 1; index < response.nodes.length; index += 1) {
      const previous = response.nodes[index - 1].name.toLowerCase();
      const current = response.nodes[index].name.toLowerCase();
      expect(previous.localeCompare(current)).toBeLessThanOrEqual(0);
    }
  });
});
