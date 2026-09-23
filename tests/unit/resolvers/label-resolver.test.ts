import { describe, expect, it, vi } from "vitest";
import type { LinearSdkClient } from "../../../src/client/linear-client.js";
import {
  findMissingLabelNames,
  findWorkspaceLabelId,
  resolveLabelId,
  resolveLabelIds,
  resolveLabelIdsPermissive,
  resolveWorkspaceLabelId,
} from "../../../src/resolvers/label-resolver.js";

function mockSdkClient(nodes: Array<{ id: string; name?: string }>) {
  return {
    sdk: {
      issueLabels: vi.fn().mockResolvedValue({ nodes }),
    },
  } as unknown as LinearSdkClient;
}

describe("resolveLabelId", () => {
  it("returns UUID as-is", async () => {
    const client = mockSdkClient([]);
    const result = await resolveLabelId(
      client,
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(result).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("resolves label by name", async () => {
    const client = mockSdkClient([{ id: "label-uuid" }]);
    const result = await resolveLabelId(client, "Bug");
    expect(result).toBe("label-uuid");
  });

  it("throws when label not found", async () => {
    const client = mockSdkClient([]);
    await expect(resolveLabelId(client, "Nonexistent")).rejects.toThrow(
      'Label "Nonexistent" not found',
    );
  });
});

describe("resolveWorkspaceLabelId", () => {
  it("restricts lookup to workspace-global labels", async () => {
    const client = mockSdkClient([{ id: "workspace-label" }]);

    await expect(
      resolveWorkspaceLabelId(client, "type:decision"),
    ).resolves.toBe("workspace-label");
    expect(client.sdk.issueLabels).toHaveBeenCalledWith({
      filter: {
        name: { eqIgnoreCase: "type:decision" },
        team: { null: true },
      },
      first: 1,
    });
  });

  it("throws a typed not-found error when the workspace label is absent", async () => {
    await expect(
      resolveWorkspaceLabelId(mockSdkClient([]), "type:decision"),
    ).rejects.toThrow('Workspace label "type:decision" not found');
  });
});

describe("findWorkspaceLabelId", () => {
  it("returns undefined rather than masking a missing optional label as an error", async () => {
    await expect(
      findWorkspaceLabelId(mockSdkClient([]), "type:custom"),
    ).resolves.toBeUndefined();
  });

  // A UUID is not a free pass past the workspace scope: `labels update` and
  // `labels delete` are documented as workspace-only, so a team-scoped label's
  // UUID must miss here rather than reach the mutation.
  it("rejects a UUID belonging to a team-scoped label", async () => {
    const client = mockSdkClient([]);

    await expect(
      findWorkspaceLabelId(client, "550e8400-e29b-41d4-a716-446655440000"),
    ).resolves.toBeUndefined();
    expect(client.sdk.issueLabels).toHaveBeenCalledWith({
      filter: {
        id: { eq: "550e8400-e29b-41d4-a716-446655440000" },
        team: { null: true },
      },
      first: 1,
    });
  });

  it("accepts a UUID that does resolve to a workspace label", async () => {
    const client = mockSdkClient([
      { id: "550e8400-e29b-41d4-a716-446655440000" },
    ]);

    await expect(
      findWorkspaceLabelId(client, "550e8400-e29b-41d4-a716-446655440000"),
    ).resolves.toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("resolveWorkspaceLabelId scope enforcement", () => {
  it("raises the same not-found error for a team-scoped label UUID", async () => {
    await expect(
      resolveWorkspaceLabelId(
        mockSdkClient([]),
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).rejects.toThrow(
      'Workspace label "550e8400-e29b-41d4-a716-446655440000" not found',
    );
  });
});

describe("resolveLabelIds", () => {
  it("resolves mixed UUIDs and names", async () => {
    const client = mockSdkClient([{ id: "label-uuid" }]);
    const result = await resolveLabelIds(client, [
      "550e8400-e29b-41d4-a716-446655440000",
      "Bug",
    ]);
    expect(result).toEqual([
      "550e8400-e29b-41d4-a716-446655440000",
      "label-uuid",
    ]);
  });
});

// lin-ufud: permissive variant drives the --exclude-label flag — typos in
// the exclusion list shouldn't error the user out of `linear next`, since
// the missing label can't be excluding anything anyway.
describe("resolveLabelIdsPermissive", () => {
  it("returns ids for names that exist", async () => {
    const issueLabels = vi
      .fn()
      .mockResolvedValueOnce({ nodes: [{ id: "l-ex" }] })
      .mockResolvedValueOnce({ nodes: [{ id: "l-seed" }] });
    const client = { sdk: { issueLabels } } as unknown as LinearSdkClient;

    const result = await resolveLabelIdsPermissive(client, ["example", "seed"]);

    expect(result).toEqual(["l-ex", "l-seed"]);
  });

  it("silently drops names that don't resolve", async () => {
    const issueLabels = vi
      .fn()
      .mockResolvedValueOnce({ nodes: [{ id: "l-ex" }] })
      .mockResolvedValueOnce({ nodes: [] }) // missing
      .mockResolvedValueOnce({ nodes: [{ id: "l-smoke" }] });
    const client = { sdk: { issueLabels } } as unknown as LinearSdkClient;

    const result = await resolveLabelIdsPermissive(client, [
      "example",
      "does-not-exist",
      "smoke-test",
    ]);

    expect(result).toEqual(["l-ex", "l-smoke"]);
  });

  it("returns UUIDs unchanged without an SDK call", async () => {
    const issueLabels = vi.fn();
    const client = { sdk: { issueLabels } } as unknown as LinearSdkClient;

    const result = await resolveLabelIdsPermissive(client, [
      "550e8400-e29b-41d4-a716-446655440000",
    ]);

    expect(result).toEqual(["550e8400-e29b-41d4-a716-446655440000"]);
    expect(issueLabels).not.toHaveBeenCalled();
  });
});

describe("findMissingLabelNames", () => {
  it("returns the names and UUIDs no label matches", async () => {
    const issueLabels = vi
      .fn()
      .mockResolvedValueOnce({ nodes: [{ id: "l-bug" }] })
      .mockResolvedValueOnce({ nodes: [] })
      .mockResolvedValueOnce({ nodes: [] });
    const client = { sdk: { issueLabels } } as unknown as LinearSdkClient;

    const result = await findMissingLabelNames(client, [
      "Bug",
      "550e8400-e29b-41d4-a716-446655440000",
      "nope",
    ]);

    expect(result).toEqual(["550e8400-e29b-41d4-a716-446655440000", "nope"]);
    expect(issueLabels).toHaveBeenCalledWith({
      filter: { name: { eqIgnoreCase: "Bug" } },
      first: 1,
    });
    expect(issueLabels).toHaveBeenCalledWith({
      filter: { id: { eq: "550e8400-e29b-41d4-a716-446655440000" } },
      first: 1,
    });
  });

  it("returns an empty list when every name exists", async () => {
    const client = mockSdkClient([{ id: "l-1" }]);
    expect(await findMissingLabelNames(client, ["bug", "ux"])).toEqual([]);
  });
});
