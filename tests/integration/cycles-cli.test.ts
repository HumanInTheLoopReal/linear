import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCliHarness, hasLiveApiToken, parseJson } from "./cli-harness.js";

const harness = createCliHarness();
const { runLinear } = harness;

interface CycleShape {
  id: string;
  number: number;
  isActive: boolean;
  name?: string | null;
  startsAt: string;
  endsAt: string;
  issues?: unknown[];
}

async function firstTeamKey(): Promise<string | undefined> {
  const { stdout } = await runLinear(["teams", "list", "--limit", "1"]);
  return parseJson<{ nodes: Array<{ key: string }> }>(stdout).nodes[0]?.key;
}

describe("Cycles CLI Commands", () => {
  beforeAll(() => {
    if (!hasLiveApiToken) {
      console.warn("\nLINEAR_API_TOKEN not set - skipping live cycle tests\n");
    }
  });

  afterAll(() => harness.cleanup());

  it("displays help text", async () => {
    const { stdout } = await runLinear(["cycles", "--help"], { json: false });
    expect(stdout).toContain("Usage: linear cycles");
    expect(stdout).toContain("Cycle operations");
    expect(stdout).toContain("list");
    expect(stdout).toContain("read");
  });

  it.skipIf(!hasLiveApiToken)("rejects --window without --team", async () => {
    await expect(
      runLinear(["cycles", "list", "--window", "3"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("--window requires --team"),
    });
  });

  it.skipIf(!hasLiveApiToken).each(["abc", "-5"])(
    "rejects invalid --window value %s",
    async (window) => {
      await expect(
        runLinear(["cycles", "list", "--window", window, "--team", "ENG"]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("requires a non-negative integer"),
      });
    },
  );

  it.skipIf(!hasLiveApiToken)(
    "lists cycles with typed JSON fields",
    async () => {
      const { stdout, stderr } = await runLinear(["cycles", "list"]);
      expect(stderr).not.toContain("complexity");

      const response = parseJson<{ nodes: CycleShape[] }>(stdout);
      expect(Array.isArray(response.nodes)).toBe(true);
      if (response.nodes.length > 0) {
        expect(response.nodes[0]).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            number: expect.any(Number),
            isActive: expect.any(Boolean),
            startsAt: expect.any(String),
            endsAt: expect.any(String),
          }),
        );
      }
    },
  );

  it.skipIf(!hasLiveApiToken)("filters active cycles", async () => {
    const teamKey = await firstTeamKey();
    if (!teamKey) return;

    const { stdout } = await runLinear([
      "cycles",
      "list",
      "--active",
      "--team",
      teamKey,
    ]);
    const response = parseJson<{ nodes: CycleShape[] }>(stdout);
    expect(response.nodes.every((cycle) => cycle.isActive)).toBe(true);
  });

  it.skipIf(!hasLiveApiToken)(
    "supports the cycle window filter",
    { timeout: 30_000 },
    async () => {
      const teamKey = await firstTeamKey();
      if (!teamKey) return;

      try {
        const { stdout, stderr } = await runLinear([
          "cycles",
          "list",
          "--window",
          "3",
          "--team",
          teamKey,
        ]);
        expect(stderr).not.toContain("query too complex");
        expect(parseJson<{ nodes: CycleShape[] }>(stdout).nodes).toBeInstanceOf(
          Array,
        );
      } catch (error: unknown) {
        const failure = error as { stdout?: string; stderr?: string };
        if (!(failure.stdout || failure.stderr)?.includes("No active cycle")) {
          throw error;
        }
      }
    },
  );

  it.skipIf(!hasLiveApiToken)("reads a cycle by ID", async () => {
    const { stdout: listOutput } = await runLinear([
      "cycles",
      "list",
      "--limit",
      "1",
    ]);
    const cycleId = parseJson<{ nodes: CycleShape[] }>(listOutput).nodes[0]?.id;
    if (!cycleId) return;

    const { stdout, stderr } = await runLinear(["cycles", "read", cycleId]);
    expect(stderr).not.toContain("query too complex");
    const cycle = parseJson<CycleShape>(stdout);
    expect(cycle.id).toBe(cycleId);
    expect(cycle.issues).toBeInstanceOf(Array);
  });

  it.skipIf(!hasLiveApiToken)("reads a named cycle within a team", async () => {
    const teamKey = await firstTeamKey();
    if (!teamKey) return;

    const { stdout: listOutput } = await runLinear([
      "cycles",
      "list",
      "--team",
      teamKey,
    ]);
    const namedCycle = parseJson<{ nodes: CycleShape[] }>(
      listOutput,
    ).nodes.find((cycle) => cycle.name);
    if (!namedCycle?.name) return;

    const { stdout, stderr } = await runLinear([
      "cycles",
      "read",
      namedCycle.name,
      "--team",
      teamKey,
    ]);
    expect(stderr).not.toContain("query too complex");
    expect(parseJson<CycleShape>(stdout).name).toBe(namedCycle.name);
  });
});
