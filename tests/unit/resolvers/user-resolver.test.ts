import { describe, expect, it, vi } from "vitest";
import type { LinearSdkClient } from "../../../src/client/linear-client.js";
import { resolveUserId } from "../../../src/resolvers/user-resolver.js";

interface MockUser {
  id: string;
  name?: string;
  email?: string;
}

function mockSdkClient(...callResults: Array<{ nodes: MockUser[] }>) {
  const users = vi.fn();
  for (const result of callResults) {
    users.mockResolvedValueOnce(result);
  }
  return { sdk: { users } } as unknown as LinearSdkClient;
}

describe("resolveUserId", () => {
  it("returns UUID as-is without calling SDK", async () => {
    const client = mockSdkClient();
    const result = await resolveUserId(
      client,
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(result).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(client.sdk.users).not.toHaveBeenCalled();
  });

  it("resolves user by display name", async () => {
    const client = mockSdkClient({
      nodes: [
        { id: "user-uuid-1", name: "John Doe", email: "john@example.com" },
      ],
    });
    const result = await resolveUserId(client, "John Doe");
    expect(result).toBe("user-uuid-1");
    expect(client.sdk.users).toHaveBeenCalledWith({
      filter: { displayName: { eqIgnoreCase: "John Doe" } },
      first: 10,
    });
  });

  it("falls back to email when name not found", async () => {
    const client = mockSdkClient(
      { nodes: [] },
      {
        nodes: [{ id: "user-uuid-2", name: "Jane", email: "jane@example.com" }],
      },
    );
    const result = await resolveUserId(client, "jane@example.com");
    expect(result).toBe("user-uuid-2");
    expect(client.sdk.users).toHaveBeenCalledTimes(2);
    expect(client.sdk.users).toHaveBeenNthCalledWith(2, {
      filter: { email: { eqIgnoreCase: "jane@example.com" } },
      first: 1,
    });
  });

  it("throws when user not found by name or email", async () => {
    const client = mockSdkClient({ nodes: [] }, { nodes: [] });
    await expect(resolveUserId(client, "Nobody")).rejects.toThrow(
      'User "Nobody" not found',
    );
  });

  it("throws when multiple users match by name", async () => {
    const client = mockSdkClient({
      nodes: [
        { id: "user-1", name: "Alex Smith", email: "alex1@example.com" },
        { id: "user-2", name: "Alex Smith", email: "alex2@example.com" },
      ],
    });
    await expect(resolveUserId(client, "Alex Smith")).rejects.toThrow(
      'Multiple Users found matching "Alex Smith"',
    );
  });

  // lin-17j1: @me / @self / @viewer resolve to the authenticated viewer
  // via `sdk.viewer` without touching the users(...) lookup path.
  describe("@me / @self / @viewer shortcuts", () => {
    function mockSdkClientWithViewer(viewer: MockUser) {
      const users = vi.fn();
      return {
        sdk: {
          users,
          viewer: Promise.resolve(viewer),
        },
        users,
      } as unknown as LinearSdkClient & { users: ReturnType<typeof vi.fn> };
    }

    it.each([
      "@me",
      "@self",
      "@viewer",
      "@ME",
      "@Self",
    ])("resolves %s to the viewer id without calling users()", async (token) => {
      const client = mockSdkClientWithViewer({
        id: "viewer-uuid",
        name: "Ada",
        email: "ada@example.com",
      });
      const result = await resolveUserId(client, token);
      expect(result).toBe("viewer-uuid");
      expect(client.users).not.toHaveBeenCalled();
    });

    it("does not short-circuit on a literal 'me' (no @ prefix)", async () => {
      const client = mockSdkClient({
        nodes: [{ id: "user-me-literal", name: "me", email: "m@e.x" }],
      });
      // No `viewer` getter on the SDK mock — would throw if the resolver
      // tried to short-circuit. Test passes only if the user lookup path
      // runs as for any other display name.
      const result = await resolveUserId(client, "me");
      expect(result).toBe("user-me-literal");
    });
  });
});
