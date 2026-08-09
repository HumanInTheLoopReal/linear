import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCliHarness, hasLiveApiToken, parseJson } from "./cli-harness.js";

const harness = createCliHarness();
const { runLinear } = harness;

interface UserShape {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

describe("Users CLI Commands", () => {
  beforeAll(() => {
    if (!hasLiveApiToken) {
      console.warn("\nLINEAR_API_TOKEN not set - skipping live user tests\n");
    }
  });

  afterAll(() => harness.cleanup());

  it("displays help text", async () => {
    const { stdout } = await runLinear(["users", "--help"], { json: false });
    expect(stdout).toContain("Usage: linear users");
    expect(stdout).toContain("User operations");
    expect(stdout).toContain("list");
  });

  it.skipIf(!hasLiveApiToken)("lists sorted users as JSON", async () => {
    const { stdout, stderr } = await runLinear(["users", "list"]);
    expect(stderr).not.toContain("error");

    const response = parseJson<{ nodes: UserShape[] }>(stdout);
    expect(response.nodes.length).toBeGreaterThan(0);
    for (const user of response.nodes) {
      expect(user).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          email: expect.any(String),
          active: expect.any(Boolean),
        }),
      );
    }
    for (let index = 1; index < response.nodes.length; index += 1) {
      const previous = response.nodes[index - 1].name.toLowerCase();
      const current = response.nodes[index].name.toLowerCase();
      expect(previous.localeCompare(current)).toBeLessThanOrEqual(0);
    }
  });

  it.skipIf(!hasLiveApiToken)("filters active users", async () => {
    const { stdout } = await runLinear(["users", "list", "--active"]);
    const response = parseJson<{ nodes: UserShape[] }>(stdout);
    expect(response.nodes.every((user) => user.active)).toBe(true);
  });
});
