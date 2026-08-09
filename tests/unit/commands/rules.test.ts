import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputSuccess: vi.fn(), outputResult: vi.fn() };
});

vi.mock("../../../src/services/rules-audit-service.js", () => ({
  runRulesAudit: vi.fn().mockReturnValue({
    total_rules: 0,
    token_estimate: 0,
    contradictions: [],
    merge_candidates: [],
    rules: [],
  }),
}));

import { setupRulesCommands } from "../../../src/commands/rules.js";
import { outputResult } from "../../../src/common/output.js";
import { runRulesAudit } from "../../../src/services/rules-audit-service.js";

function createProgram(): Command {
  const program = new Command();
  setupRulesCommands(program);
  return program;
}

describe("linear rules audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("uses default path and threshold when no flags are given", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "rules", "audit"]);
    expect(runRulesAudit).toHaveBeenCalledWith({
      rulesDir: undefined,
      threshold: undefined,
    });
    expect(outputResult).toHaveBeenCalled();
  });

  it("forwards --path and --threshold (parsed as float) to the service", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "rules",
      "audit",
      "--path",
      "/tmp/rules",
      "--threshold",
      "0.75",
    ]);
    expect(runRulesAudit).toHaveBeenCalledWith({
      rulesDir: "/tmp/rules",
      threshold: 0.75,
    });
  });

  it("rejects --threshold outside [0,1] as process.exit(1)", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "rules",
      "audit",
      "--threshold",
      "2",
    ]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(runRulesAudit).not.toHaveBeenCalled();
  });

  it("emits the audit result as JSON via outputSuccess", async () => {
    vi.mocked(runRulesAudit).mockReturnValueOnce({
      total_rules: 3,
      token_estimate: 120,
      contradictions: [],
      merge_candidates: [
        { group_label: "auth", rules: ["a.md", "b.md"], score: 0.8 },
      ],
      rules: [],
    });
    const program = createProgram();
    await program.parseAsync(["node", "test", "rules", "audit"]);
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        total_rules: 3,
        token_estimate: 120,
      }),
      expect.any(Function),
      expect.anything(),
    );
  });
});
