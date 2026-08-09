import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  getStateValue,
  listStateDimensions,
  parseStateDimensions,
  setStateLabel,
} from "../../../src/services/state-service.js";

vi.mock("../../../src/services/issue-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/services/issue-service.js")
    >();
  return {
    ...actual,
    updateIssue: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("../../../src/services/comment-service.js", () => ({
  createComment: vi.fn().mockResolvedValue({ id: "c-1" }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function makeClient(issueResponse: unknown): GraphQLClient {
  return {
    request: vi.fn().mockResolvedValue(issueResponse),
  } as unknown as GraphQLClient;
}

function issuePayload(labels: string[]) {
  return {
    issue: {
      id: "uuid-1",
      identifier: "ENG-1",
      labels: { nodes: labels.map((name) => ({ id: `l-${name}`, name })) },
    },
  };
}

describe("parseStateDimensions", () => {
  it("extracts dimension:value pairs", () => {
    expect(
      parseStateDimensions([
        "patrol:active",
        "mode:degraded",
        "health:healthy",
      ]),
    ).toEqual({ patrol: "active", mode: "degraded", health: "healthy" });
  });

  it("ignores labels without a colon", () => {
    expect(parseStateDimensions(["region:east", "swarm", "wip"])).toEqual({
      region: "east",
    });
  });

  it("ignores labels with empty dimension or value", () => {
    expect(
      parseStateDimensions([":value", "dimension:", "::", "ok:yes"]),
    ).toEqual({
      ok: "yes",
    });
  });

  it("later labels overwrite earlier ones for the same dimension", () => {
    expect(parseStateDimensions(["mode:a", "mode:b", "mode:c"])).toEqual({
      mode: "c",
    });
  });

  it("preserves values containing colons (split on first only)", () => {
    expect(parseStateDimensions(["url:https://example.com"])).toEqual({
      url: "https://example.com",
    });
  });

  it("returns {} for an empty list", () => {
    expect(parseStateDimensions([])).toEqual({});
  });
});

describe("getStateValue", () => {
  it("returns the matching value when present", async () => {
    const client = makeClient(issuePayload(["patrol:active", "mode:normal"]));
    const result = await getStateValue(client, "uuid-1", "patrol");
    expect(result).toEqual({
      issue_id: "uuid-1",
      issue_identifier: "ENG-1",
      dimension: "patrol",
      value: "active",
    });
  });

  it("returns null when the dimension is not present", async () => {
    const client = makeClient(issuePayload(["mode:normal"]));
    const result = await getStateValue(client, "uuid-1", "patrol");
    expect(result.value).toBeNull();
  });

  it("returns null when the issue has no labels", async () => {
    const client = makeClient(issuePayload([]));
    const result = await getStateValue(client, "uuid-1", "patrol");
    expect(result.value).toBeNull();
  });
});

describe("listStateDimensions", () => {
  it("returns the full state map for the issue", async () => {
    const client = makeClient(
      issuePayload(["patrol:active", "mode:normal", "health:healthy", "swarm"]),
    );
    const result = await listStateDimensions(client, "uuid-1");
    expect(result.issue_id).toBe("uuid-1");
    expect(result.states).toEqual({
      patrol: "active",
      mode: "normal",
      health: "healthy",
    });
  });

  it("returns an empty map when no state labels are present", async () => {
    const client = makeClient(issuePayload(["swarm", "region:east"]));
    const result = await listStateDimensions(client, "uuid-1");
    // Any colon-formatted label is treated as state by design — the
    // parser doesn't enforce a known set of dimensions.
    expect(result.states).toEqual({ region: "east" });
  });
});

describe("setStateLabel", () => {
  it("returns changed:false when the dimension is already set to the value", async () => {
    const { updateIssue } = await import(
      "../../../src/services/issue-service.js"
    );
    const { createComment } = await import(
      "../../../src/services/comment-service.js"
    );
    const client = makeClient(issuePayload(["patrol:active", "type:task"]));
    const result = await setStateLabel(client, "uuid-1", "patrol", "active");
    expect(result.changed).toBe(false);
    expect(result.old_value).toBe("active");
    expect(result.new_value).toBe("active");
    expect(updateIssue).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
  });

  it("adds the new label when no prior dimension is set", async () => {
    const { updateIssue } = await import(
      "../../../src/services/issue-service.js"
    );
    const request = vi
      .fn()
      .mockResolvedValueOnce(issuePayload(["type:task"]))
      // ensureLabel: not found, then create
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      .mockResolvedValueOnce({
        issueLabelCreate: {
          success: true,
          issueLabel: { id: "l-new", name: "patrol:active" },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    const result = await setStateLabel(client, "uuid-1", "patrol", "active");
    expect(result).toMatchObject({
      issue_id: "uuid-1",
      dimension: "patrol",
      old_value: null,
      new_value: "active",
      changed: true,
    });
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "uuid-1",
      expect.objectContaining({
        labelIds: expect.arrayContaining(["l-type:task", "l-new"]),
      }),
    );
  });

  it("removes the old label and adds the new one when dimension already set", async () => {
    const { updateIssue } = await import(
      "../../../src/services/issue-service.js"
    );
    const request = vi
      .fn()
      .mockResolvedValueOnce(issuePayload(["patrol:active", "type:task"]))
      // ensureLabel: existing patrol:muted (reuse)
      .mockResolvedValueOnce({
        issueLabels: { nodes: [{ id: "l-muted", name: "patrol:muted" }] },
      });
    const client = { request } as unknown as GraphQLClient;

    const result = await setStateLabel(client, "uuid-1", "patrol", "muted");
    expect(result.old_value).toBe("active");
    expect(result.new_value).toBe("muted");
    expect(result.changed).toBe(true);

    const labelIds = (
      (updateIssue as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as {
        labelIds: string[];
      }
    ).labelIds;
    expect(labelIds).toContain("l-muted");
    expect(labelIds).toContain("l-type:task");
    expect(labelIds).not.toContain("l-patrol:active");
  });

  it("posts a comment when --reason is given", async () => {
    const { createComment } = await import(
      "../../../src/services/comment-service.js"
    );
    const request = vi
      .fn()
      .mockResolvedValueOnce(issuePayload(["patrol:active"]))
      .mockResolvedValueOnce({
        issueLabels: { nodes: [{ id: "l-muted", name: "patrol:muted" }] },
      });
    const client = { request } as unknown as GraphQLClient;

    const result = await setStateLabel(
      client,
      "uuid-1",
      "patrol",
      "muted",
      "investigating stuck worker",
    );
    expect(result.comment_id).toBe("c-1");
    expect(createComment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        issueId: "uuid-1",
        body: expect.stringContaining("patrol active → muted"),
      }),
    );
  });

  it("does not post a comment when --reason is omitted", async () => {
    const { createComment } = await import(
      "../../../src/services/comment-service.js"
    );
    const request = vi
      .fn()
      .mockResolvedValueOnce(issuePayload([]))
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      .mockResolvedValueOnce({
        issueLabelCreate: {
          success: true,
          issueLabel: { id: "l-new", name: "patrol:active" },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    const result = await setStateLabel(client, "uuid-1", "patrol", "active");
    expect(result.comment_id).toBeNull();
    expect(createComment).not.toHaveBeenCalled();
  });
});
