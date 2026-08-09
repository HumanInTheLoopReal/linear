import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCliHarness, hasLiveApiToken, parseJson } from "./cli-harness.js";

const harness = createCliHarness();
const { runLinear } = harness;

describe("Documents CLI Commands", () => {
  beforeAll(() => {
    if (!hasLiveApiToken) {
      console.warn(
        "\nLINEAR_API_TOKEN not set - skipping live documents integration tests\n",
      );
    }
  });

  afterAll(() => harness.cleanup());

  it("displays help text", async () => {
    const { stdout } = await runLinear(["documents", "--help"], {
      json: false,
    });

    expect(stdout).toContain("Usage: linear documents");
    expect(stdout).toContain("Document operations");
    for (const command of ["create", "update", "read", "list", "delete"]) {
      expect(stdout).toContain(command);
    }
  });

  it.skipIf(!hasLiveApiToken)("lists documents as JSON", async () => {
    const { stdout, stderr } = await runLinear(["documents", "list"]);

    expect(stderr).not.toContain("error");
    const response = parseJson<{ nodes: Array<Record<string, unknown>> }>(
      stdout,
    );
    expect(Array.isArray(response.nodes)).toBe(true);
    if (response.nodes.length > 0) {
      const document = response.nodes[0];
      for (const field of [
        "id",
        "title",
        "slugId",
        "url",
        "createdAt",
        "updatedAt",
      ]) {
        expect(document).toHaveProperty(field);
      }
    }
  });

  it.skipIf(!hasLiveApiToken)(
    "returns a structured error for a missing document",
    async () => {
      try {
        await runLinear(["documents", "read", "nonexistent-uuid-12345"]);
        expect.fail("Should have thrown an error");
      } catch (error: unknown) {
        const failure = error as { stdout?: string; stderr?: string };
        const output = parseJson<{ error?: string }>(
          failure.stdout || failure.stderr || "{}",
        );
        expect(output.error).toBeDefined();
      }
    },
  );

  it.skipIf(!hasLiveApiToken).each(["abc", "-5"])(
    "rejects invalid --limit value %s",
    async (limit) => {
      try {
        await runLinear(["documents", "list", "--limit", limit]);
        expect.fail("Should have thrown an error");
      } catch (error: unknown) {
        const failure = error as { stdout?: string; stderr?: string };
        const output = parseJson<{ error?: string }>(
          failure.stdout || failure.stderr || "{}",
        );
        expect(output.error).toContain("Invalid limit");
      }
    },
  );

  it.skipIf(!hasLiveApiToken)(
    "creates, reads, updates, and deletes a document",
    { timeout: 90_000 },
    async () => {
      let cleanupDocumentId: string | undefined;
      try {
        const { stdout: teamsOutput } = await runLinear([
          "teams",
          "list",
          "--limit",
          "1",
        ]);
        const teams = parseJson<{ nodes: Array<{ key: string }> }>(teamsOutput);
        expect(teams.nodes.length).toBeGreaterThan(0);
        const teamKey = teams.nodes[0].key;

        const { stdout: createOutput } = await runLinear([
          "documents",
          "create",
          "--title",
          `Test Document from Vitest ${Date.now()}`,
          "--team",
          teamKey,
        ]);
        const created = parseJson<{ id: string; title: string; url: string }>(
          createOutput,
        );
        cleanupDocumentId = created.id;
        expect(created.id).toBeTruthy();
        expect(created.url).toBeTruthy();

        const { stdout: readOutput } = await runLinear([
          "documents",
          "read",
          created.id,
        ]);
        expect(parseJson<{ id: string }>(readOutput).id).toBe(created.id);

        const { stdout: updateOutput } = await runLinear([
          "documents",
          "update",
          created.id,
          "--title",
          "Updated Test Document",
        ]);
        const updated = parseJson<{ id: string; title: string }>(updateOutput);
        expect(updated).toMatchObject({
          id: created.id,
          title: "Updated Test Document",
        });

        const { stdout: deleteOutput } = await runLinear([
          "documents",
          "delete",
          created.id,
        ]);
        expect(parseJson<{ success: boolean }>(deleteOutput).success).toBe(
          true,
        );
        cleanupDocumentId = undefined;

        const { stdout: verifyOutput } = await runLinear([
          "documents",
          "read",
          created.id,
        ]);
        expect(parseJson<{ trashed: boolean }>(verifyOutput).trashed).toBe(
          true,
        );
      } finally {
        if (cleanupDocumentId) {
          await runLinear(["documents", "delete", cleanupDocumentId]).catch(
            () => {},
          );
        }
      }
    },
  );
});
