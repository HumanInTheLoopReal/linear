import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupPrimeCommands } from "../../../src/commands/prime.js";
import { upsertMemory } from "../../../src/common/memory-store.js";

function createProgram(): Command {
  const program = new Command();
  setupPrimeCommands(program);
  return program;
}

describe("linear prime", () => {
  let tmpHome: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "linear-prime-test-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("prints the full brief with markdown headings and a zero-memories notice", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("# Linear Workflow Context");
    expect(out).toContain("SESSION CLOSE PROTOCOL");
    expect(out).toContain("Essential Commands");
    expect(out).toContain("## Persistent Memories (0)");
  });

  it("injects stored memories into the persistent memories section", async () => {
    upsertMemory("auth-jwt", "auth module uses JWT not sessions");
    upsertMemory("cache-tip", "cache phantom DBs hide in three places");

    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("## Persistent Memories (2)");
    expect(out).toContain("### auth-jwt");
    expect(out).toContain("auth module uses JWT not sessions");
    expect(out).toContain("### cache-tip");
  });

  it("with --memories-only, omits the workflow brief and prints just memories", async () => {
    upsertMemory("only-this", "only this should appear");

    const program = createProgram();
    await program.parseAsync(["node", "test", "prime", "--memories-only"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).not.toContain("# Linear Workflow Context");
    expect(out).not.toContain("SESSION CLOSE PROTOCOL");
    expect(out).toContain("## Persistent Memories (1)");
    expect(out).toContain("### only-this");
  });

  it("documents the top-level aliases", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("Top-Level Aliases");
    expect(out).toContain("linear list");
    expect(out).toContain("linear ready");
    expect(out).toContain("linear dep tree");
    expect(out).toContain("src/commands/aliases.ts");
  });

  it("covers the essential-command categories (deps, search/health, quality, lifecycle)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    // Dependencies & Blocking
    expect(out).toContain("### Dependencies & Blocking");
    expect(out).toContain("linear depends add");
    expect(out).toContain("linear depends tree");
    expect(out).toContain("linear blocked");
    // Search & Project Health
    expect(out).toContain("### Search & Project Health");
    expect(out).toContain("linear issues search");
    expect(out).toContain("linear doctor");
    expect(out).toContain("linear preflight");
    expect(out).toContain("linear where");
    // Quality Tools
    expect(out).toContain("### Quality Tools");
    expect(out).toContain("linear issues lint");
    expect(out).toContain("linear human");
    // Lifecycle & Hygiene
    expect(out).toContain("### Lifecycle & Hygiene");
    expect(out).toContain("linear snooze");
    expect(out).toContain("linear wake");
    expect(out).toContain("linear orphans");
  });

  it("advertises the surgical description editors (pull/push, check, note, section flags)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("### Editing Descriptions");
    expect(out).toContain("linear issues pull <id>");
    expect(out).toContain("linear issues push <id>");
    expect(out).toContain("linear issues check <id>");
    expect(out).toContain("linear issues note <id>");
    expect(out).toContain("--append-notes");
    expect(out).toContain('linear comment <id> "text"');
  });

  it("teaches markdown-structured comments (render as markdown, no pipe tables)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("Comments render as **markdown**");
    expect(out).toContain("pipe tables do NOT render");
  });

  it("warns agents away from `linear edit` and gates issue creation", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("linear edit");
    expect(out).toContain("$EDITOR");
    expect(out).toContain("Creation guard");
    expect(out).toContain("necessary children");
    expect(out).not.toMatch(/parallel subagents.*create/i);
  });

  it("includes process-safe start, completion, child, and finding workflows", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("## Common Workflows");
    expect(out).toContain("**Starting work:**");
    expect(out).toContain("**Completing work:**");
    expect(out).toContain("**Creating an approved durable child:**");
    expect(out).toContain("linear next");
    expect(out).toContain("linear start <id>");
    expect(out).toContain("--parent-ticket <parent>");
    expect(out).toContain(
      "Do not create a sibling/top-level issue automatically",
    );
  });

  it("keeps durable Linear state separate from temporary agent tasks", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("Linear stores approved outcomes");
    expect(out).toContain("host agent's task system");
    expect(out).toContain("Discovery is not commitment");
    expect(out).toContain("never command-by-command narration");
    expect(out).not.toContain("Use Linear for ALL task tracking");
    expect(out).not.toContain("Do NOT use TodoWrite");
  });

  it("prepends a truncation directive so agents know to read the persisted hook output", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out.startsWith("[linear prime] ")).toBe(true);
    expect(out).toContain("persisted hook output");
  });

  it("lists agent integrations (skill, slash command)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("Agent Integrations");
    expect(out).toContain(".claude/skills/linear/SKILL.md");
    expect(out).toContain("/linear:plan-to-linear");
  });

  it("with --stealth, replaces git operations with a durable receipt/handoff", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime", "--stealth"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    // Header stays put so the agent still sees a SessionStart brief.
    expect(out).toContain("# Linear Workflow Context");
    expect(out).toContain("SESSION CLOSE PROTOCOL");
    // Git ops are gone; a durable result and authority check take their place.
    expect(out).not.toContain("git push");
    expect(out).not.toContain("git commit");
    expect(out).toContain("receipt / handoff");
    expect(out).toContain("terminal gate");
    expect(out).toContain("Stealth mode");
  });

  it("with --full overrides --memories-only and prints the full brief", async () => {
    upsertMemory("k", "v");
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "prime",
      "--memories-only",
      "--full",
    ]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("# Linear Workflow Context");
    expect(out).toContain("## Persistent Memories (1)");
  });

  it("with --mcp prepends the MCP-available hint", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime", "--mcp"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("MCP available");
    expect(out).toContain("linear mcp");
  });

  it("--export dumps the default brief to stdout (bypassing any PRIME.md override)", async () => {
    // Plant an override that would normally win — --export must skip it.
    const overrideDir = path.join(tmpHome, ".linear");
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(
      path.join(overrideDir, "PRIME.md"),
      "# my custom brief\noverride body\n",
    );

    const program = createProgram();
    await program.parseAsync(["node", "test", "prime", "--export"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    // Default brief wins under --export, override is ignored.
    expect(out).toContain("# Linear Workflow Context");
    expect(out).not.toContain("# my custom brief");
  });

  it("PRIME.md override under ~/.linear suppresses the built-in brief", async () => {
    const overrideDir = path.join(tmpHome, ".linear");
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(
      path.join(overrideDir, "PRIME.md"),
      "# my custom brief\nfoo\n",
    );
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("# my custom brief");
    expect(out).toContain("foo");
    expect(out).not.toContain("# Linear Workflow Context");
  });

  // Plant a `linear` MCP server in the mocked ~/.claude/settings.json so
  // isMCPActive() (which reads os.homedir() → tmpHome) reports active.
  function wireLinearMCP(): void {
    const claudeDir = path.join(tmpHome, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ mcpServers: { linear: { command: "linear mcp" } } }),
    );
  }

  it("auto-emits the compact MCP brief when a linear MCP server is configured", async () => {
    wireLinearMCP();
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    // Compact MCP brief, not the full CLI reference.
    expect(out).toContain("# Linear Issue Tracker Active (MCP)");
    expect(out).toContain("SESSION CLOSE PROTOCOL");
    expect(out).not.toContain("# Linear Workflow Context");
    expect(out).not.toContain("### Dependencies & Blocking");
  });

  it("with --full forces the full brief even when an MCP server is active", async () => {
    wireLinearMCP();
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime", "--full"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("# Linear Workflow Context");
    expect(out).not.toContain("# Linear Issue Tracker Active (MCP)");
  });

  it("emits the full brief when no MCP server is configured (unchanged)", async () => {
    // No settings.json planted → isMCPActive() is false.
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime"]);

    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("# Linear Workflow Context");
    expect(out).not.toContain("# Linear Issue Tracker Active (MCP)");
  });

  it("with --hook-json wraps the brief in the SessionStart hook envelope", async () => {
    const consoleSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const program = createProgram();
    await program.parseAsync(["node", "test", "prime", "--hook-json"]);

    // --hook-json emits JSON via outputResult's formatter on the text path.
    const stdoutOut = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const jsonOut = consoleSpy.mock.calls.map((c) => c[0]).join("");
    const raw = stdoutOut || jsonOut;
    const parsed = JSON.parse(raw);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "# Linear Workflow Context",
    );
  });

  it("with --json (set on the parent program), wraps the brief in an envelope", async () => {
    // Mount setupPrimeCommands under a parent that owns the global --json
    // flag — matches how src/main.ts wires the program in production.
    const parent = new Command();
    parent.option("--json", "structured envelope");
    setupPrimeCommands(parent);
    const consoleSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await parent.parseAsync(["node", "test", "--json", "prime"]);

    // --json routes through outputSuccess (JSON.stringify + console.log).
    // Text-mode stdoutSpy stays empty for the brief; the envelope lands
    // on console.log.
    const jsonOut = consoleSpy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(jsonOut);
    expect(parsed).toHaveProperty("brief");
    expect(parsed.brief).toContain("# Linear Workflow Context");
    expect(parsed.stealth).toBe(false);
    expect(parsed.memories_only).toBe(false);
    expect(parsed.mcp).toBe(false);
    expect(parsed.override_path).toBeUndefined();
    expect(parsed.exported).toBeUndefined();
  });
});
