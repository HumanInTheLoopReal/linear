import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatTips,
  setupTipsCommands,
  TIPS,
} from "../../../src/commands/tips.js";

function createProgram(): Command {
  const program = new Command();
  setupTipsCommands(program);
  return program;
}

describe("linear tips", () => {
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

  it("text-default: emits a 💡 header with the count and grouped tips", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "tips"]);

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain(`💡 Tips (${TIPS.length})`);
    // Categories appear as plain section headers (no bullet)
    expect(out).toMatch(/^Discovery$/m);
    expect(out).toMatch(/^Workflow$/m);
    // At least one tip body shows through
    expect(out).toContain("linear next");
  });

  it("groups tips under their category headings", () => {
    const out = formatTips({ count: TIPS.length, tips: TIPS });
    const lines = out.split("\n");
    const discoveryIdx = lines.indexOf("Discovery");
    const workflowIdx = lines.indexOf("Workflow");
    expect(discoveryIdx).toBeGreaterThan(0);
    expect(workflowIdx).toBeGreaterThan(discoveryIdx);
    // Bullets sit underneath the category header
    expect(lines[discoveryIdx + 1].startsWith("  • ")).toBe(true);
  });

  it("--json: emits the structured envelope", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    setupTipsCommands(program);
    await program.parseAsync(["node", "test", "--json", "tips"]);

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(logged.length).toBeGreaterThan(0);
    const parsed = JSON.parse(logged);
    expect(parsed.count).toBe(TIPS.length);
    expect(parsed.tips).toHaveLength(TIPS.length);
    expect(parsed.tips[0]).toHaveProperty("id");
    expect(parsed.tips[0]).toHaveProperty("category");
    expect(parsed.tips[0]).toHaveProperty("message");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatTips({ count: TIPS.length, tips: TIPS });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
