import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  createContext: vi.fn(() => ({ gql: { request: vi.fn() }, sdk: {} })),
  getRootOpts: vi.fn(() => ({})),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputSuccess: vi.fn(), outputResult: vi.fn() };
});

vi.mock("../../../src/services/info-service.js", () => ({
  runInfo: vi.fn().mockResolvedValue({
    cli_version: "x",
    platform: { key: "linear" },
    workspace: { id: "o", name: "Acme", url_key: "acme" },
    viewer: { id: "u", name: "Alex", email: "a@e.com" },
    counts: { open: 5, open_saturated: false },
  }),
}));

import { setupInfoCommands } from "../../../src/commands/info.js";
import { outputResult } from "../../../src/common/output.js";
import { runInfo } from "../../../src/services/info-service.js";

function createProgram(): Command {
  const program = new Command();
  setupInfoCommands(program);
  return program;
}

describe("linear info", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("calls runInfo with whatsNew=false by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "info"]);
    const call = vi.mocked(runInfo).mock.calls[0]?.[0];
    expect(call?.whatsNew).toBe(false);
    expect(outputResult).toHaveBeenCalled();
  });

  it("threads --whats-new into whatsNew=true", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "info", "--whats-new"]);
    const call = vi.mocked(runInfo).mock.calls[0]?.[0];
    expect(call?.whatsNew).toBe(true);
  });
});
