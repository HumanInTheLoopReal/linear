import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  createGraphQLClient,
  getRootOpts,
} from "../../../src/common/context.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configured endpoint", () => {
  it("passes LINEAR_ENDPOINT to both clients created by createContext", () => {
    const endpoint = "https://proxy.example/graphql";
    vi.stubEnv("LINEAR_ENDPOINT", endpoint);
    vi.stubEnv("LINEAR_NO_AUTO_INIT", "1");

    const context = createContext({ apiToken: "test-token" });

    expect((context.gql as unknown as { apiUrl?: string }).apiUrl).toBe(
      endpoint,
    );
    expect((context.sdk.sdk.client as unknown as { url: string }).url).toBe(
      endpoint,
    );
  });

  it("uses the configured endpoint in createGraphQLClient", () => {
    const endpoint = "https://proxy.example/graphql";
    vi.stubEnv("LINEAR_ENDPOINT", endpoint);

    const client = createGraphQLClient("test-token");

    expect((client as unknown as { apiUrl?: string }).apiUrl).toBe(endpoint);
  });
});

describe("getRootOpts", () => {
  it("returns root options for nested commands", () => {
    const root = new Command();
    root.option("--api-token <token>");
    root.option("--json");

    const child = root.command("issues");
    const grandchild = child.command("list");

    root.parse(["--api-token", "token-123", "--json", "issues", "list"], {
      from: "user",
    });

    expect(getRootOpts(grandchild)).toEqual(
      expect.objectContaining({ apiToken: "token-123", json: true }),
    );
  });

  it("returns the command's own options when already at root", () => {
    const root = new Command();
    root.option("--api-token <token>");

    root.parse(["--api-token", "root-token"], {
      from: "user",
    });

    expect(getRootOpts(root)).toEqual(
      expect.objectContaining({ apiToken: "root-token" }),
    );
  });
});
