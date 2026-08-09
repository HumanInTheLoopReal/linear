import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupQuickstartCommands } from "../../../src/commands/quickstart.js";

function createProgram(): Command {
  const program = new Command();
  setupQuickstartCommands(program);
  return program;
}

describe("linear quickstart", () => {
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

  it("text-default: covers the linear surface — getting started + agent context", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "quickstart"]);
    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("linear auth login");
    expect(out).toContain("linear issues create");
    expect(out).toContain("linear prime");
    expect(out).toContain("DEPRECATION NOTE");
  });

  it("ends with a single trailing newline in text mode", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "quickstart"]);
    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
