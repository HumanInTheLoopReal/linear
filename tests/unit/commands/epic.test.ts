import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The epic-management verbs delegate to shared runners (which
// have their own full coverage via the `issues epic-status` /
// `issues close-eligible-epics` suites). Here we mock the runners and assert
// epic.ts wires `epic status` / `epic close-eligible` to them with the right
// parsed options — i.e. the epic namespace surface exists. (lin-xzcf)
vi.mock("../../../src/commands/_epic-status.js", () => ({
  runEpicStatus: vi.fn(),
  runCloseEligibleEpics: vi.fn(),
}));

vi.mock("../../../src/commands/_create-validation.js", () => ({
  resolveCreateValidationMode: vi.fn(() => "off"),
}));

import {
  runCloseEligibleEpics,
  runEpicStatus,
} from "../../../src/commands/_epic-status.js";
import { setupEpicCommands } from "../../../src/commands/epic.js";

function createProgram(): Command {
  const program = new Command();
  setupEpicCommands(program);
  return program;
}

describe("epic management namespace verbs (lin-xzcf)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("registers status and close-eligible under the epic group", () => {
    const program = createProgram();
    const epic = program.commands.find((c) => c.name() === "epic");
    const names = epic?.commands.map((c) => c.name()) ?? [];
    expect(names).toEqual(
      expect.arrayContaining(["create", "status", "close-eligible", "usage"]),
    );
  });

  it("`epic status` delegates to runEpicStatus with parsed options", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "epic",
      "status",
      "--team",
      "ENG",
      "--eligible-only",
    ]);
    expect(runEpicStatus).toHaveBeenCalledTimes(1);
    const [, opts] = vi.mocked(runEpicStatus).mock.calls[0];
    expect(opts).toMatchObject({ team: "ENG", eligibleOnly: true });
  });

  it("`epic close-eligible --dry-run` delegates to runCloseEligibleEpics", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "epic",
      "close-eligible",
      "--dry-run",
    ]);
    expect(runCloseEligibleEpics).toHaveBeenCalledTimes(1);
    const [, opts] = vi.mocked(runCloseEligibleEpics).mock.calls[0];
    expect(opts).toMatchObject({ dryRun: true });
  });

  it("`epic close-eligible` without --dry-run still delegates (dryRun false)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "epic",
      "close-eligible",
      "--team",
      "ENG",
    ]);
    expect(runCloseEligibleEpics).toHaveBeenCalledTimes(1);
    const [, opts] = vi.mocked(runCloseEligibleEpics).mock.calls[0];
    expect(opts).toMatchObject({ team: "ENG", dryRun: false });
  });
});
