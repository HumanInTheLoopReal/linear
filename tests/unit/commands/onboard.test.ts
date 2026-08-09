import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupOnboardCommands } from "../../../src/commands/onboard.js";

function createProgram(): Command {
  const program = new Command();
  setupOnboardCommands(program);
  return program;
}

describe("linear onboard", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("text-default: emits markdown with paste markers and the snippet body", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "onboard"]);

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("--- BEGIN AGENTS.MD CONTENT ---");
    expect(out).toContain("--- END AGENTS.MD CONTENT ---");
    expect(out).toContain("linear prime");
    expect(out).toContain("Issue Tracking");
  });

  it("ships a distinct copilot variant for .github/copilot-instructions.md", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "onboard"]);

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("--- BEGIN COPILOT-INSTRUCTIONS.MD CONTENT ---");
    expect(out).toContain("--- END COPILOT-INSTRUCTIONS.MD CONTENT ---");
    // Copilot variant addresses the every-completion-load context.
    expect(out).toContain("trailers");
    expect(out).toContain("Fixes ENG-123");
    // And it must NOT just be the AGENTS.md heading dropped in verbatim.
    const copilotSection = out.slice(
      out.indexOf("--- BEGIN COPILOT-INSTRUCTIONS.MD CONTENT ---"),
      out.indexOf("--- END COPILOT-INSTRUCTIONS.MD CONTENT ---"),
    );
    expect(copilotSection).not.toContain("## Issue Tracking");
  });
});
