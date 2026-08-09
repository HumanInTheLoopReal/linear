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

vi.mock("../../../src/services/human-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/services/human-service.js")
    >();
  return { ...actual, listHumanIssues: vi.fn().mockResolvedValue([]) };
});

import { setupHumanCommands } from "../../../src/commands/human.js";
import { outputResult } from "../../../src/common/output.js";
import { listHumanIssues } from "../../../src/services/human-service.js";

function createProgram(): Command {
  const program = new Command();
  setupHumanCommands(program);
  return program;
}

describe("linear human list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("calls listHumanIssues with no status by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "human", "list"]);
    const call = vi.mocked(listHumanIssues).mock.calls[0]?.[0];
    expect(call?.status).toBeUndefined();
    expect(outputResult).toHaveBeenCalled();
  });

  it("threads --status open into the service call", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "human",
      "list",
      "--status",
      "open",
    ]);
    expect(vi.mocked(listHumanIssues).mock.calls[0]?.[0]?.status).toBe("open");
  });

  it("threads --status closed", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "human", "list", "-s", "closed"]);
    expect(vi.mocked(listHumanIssues).mock.calls[0]?.[0]?.status).toBe(
      "closed",
    );
  });

  it("threads --status in_progress", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "human",
      "list",
      "--status",
      "in_progress",
    ]);
    expect(vi.mocked(listHumanIssues).mock.calls[0]?.[0]?.status).toBe(
      "in_progress",
    );
  });

  it("rejects an unknown --status value", async () => {
    const program = createProgram();
    let captured: unknown;
    vi.spyOn(console, "error").mockImplementation((m) => {
      captured = m;
    });
    await program.parseAsync([
      "node",
      "test",
      "human",
      "list",
      "--status",
      "bogus",
    ]);
    expect(listHumanIssues).not.toHaveBeenCalled();
    expect(String(captured)).toMatch(/--status: unknown value 'bogus'/);
  });
});

describe("linear human (agent-only, lin-8yl1.7)", () => {
  function humanHelp(): string {
    const program = createProgram();
    const human = program.commands.find((c) => c.name() === "human");
    if (!human) throw new Error("human command not registered");
    // `addHelpText("after", …)` is emitted by outputHelp(), not by the bare
    // helpInformation() body, so capture the rendered output via writeOut.
    let captured = "";
    human.configureOutput({ writeOut: (s) => (captured += s) });
    human.outputHelp();
    return captured;
  }

  it("documents the agent-only triage purpose in the group help", () => {
    const help = humanHelp();
    // Anyone reading `linear human --help` must come away knowing this is an
    // escalation and triage queue, not a command cheat-sheet.
    expect(help).toMatch(/agent-only/);
    expect(help).toMatch(/triage queue/);
    expect(help).toMatch(/linear --help/);
  });

  it("describes the group as a triage queue, not a command menu", () => {
    const help = humanHelp();
    expect(help).toMatch(/triage the human-decision queue/);
  });
});
