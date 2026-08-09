import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputSuccess: vi.fn(), outputResult: vi.fn() };
});

vi.mock("../../../src/services/setup-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/services/setup-service.js")
    >();
  return {
    ...actual,
    installFileRecipe: vi.fn(() => ({
      recipe: "cursor",
      path: "/tmp/x",
      action: "installed",
    })),
    checkFileRecipe: vi.fn(() => ({
      recipe: "cursor",
      path: "/tmp/x",
      action: "checked",
      installed: false,
    })),
    removeFileRecipe: vi.fn(() => ({
      recipe: "cursor",
      path: "/tmp/x",
      action: "removed",
      installed: true,
    })),
    installClaude: vi.fn(() => ({
      recipe: "claude",
      path: "/tmp/c",
      scope: "project",
      action: "installed",
      events_added: ["SessionStart", "PreCompact"],
    })),
    checkClaude: vi.fn(() => ({
      recipe: "claude",
      path: "/tmp/c",
      scope: "project",
      action: "checked",
      installed: true,
    })),
    removeClaude: vi.fn(() => ({
      recipe: "claude",
      path: "/tmp/c",
      scope: "project",
      action: "removed",
      events_removed: ["SessionStart"],
    })),
    installGemini: vi.fn(() => ({
      recipe: "gemini",
      path: "/tmp/g",
      scope: "project",
      action: "installed",
      events_added: ["SessionStart", "PreCompress"],
      instructions_file: "/tmp/GEMINI.md",
      instructions_action: "written",
    })),
    checkGemini: vi.fn(() => ({
      recipe: "gemini",
      path: "/tmp/g",
      scope: "project",
      action: "checked",
      installed: true,
      instructions_file: "/tmp/GEMINI.md",
      instructions_action: "exists",
    })),
    removeGemini: vi.fn(() => ({
      recipe: "gemini",
      path: "/tmp/g",
      scope: "project",
      action: "removed",
      events_removed: ["SessionStart", "PreCompress"],
      instructions_file: "/tmp/GEMINI.md",
      instructions_action: "removed",
      installed: true,
    })),
    installCodex: vi.fn(() => ({
      recipe: "codex",
      path: "/tmp/AGENTS.md",
      scope: "project",
      action: "installed",
      instructions_action: "written",
    })),
    checkCodex: vi.fn(() => ({
      recipe: "codex",
      path: "/tmp/AGENTS.md",
      scope: "project",
      action: "checked",
      installed: true,
      instructions_action: "current",
    })),
    removeCodex: vi.fn(() => ({
      recipe: "codex",
      path: "/tmp/AGENTS.md",
      scope: "project",
      action: "removed",
      installed: true,
      instructions_action: "removed",
    })),
    installMux: vi.fn(() => ({
      recipe: "mux",
      action: "installed",
      layers: [{ layer: "base", path: "/tmp/AGENTS.md", action: "written" }],
      installed: true,
    })),
    checkMux: vi.fn(() => ({
      recipe: "mux",
      action: "checked",
      layers: [{ layer: "base", path: "/tmp/AGENTS.md", action: "current" }],
      installed: true,
    })),
    removeMux: vi.fn(() => ({
      recipe: "mux",
      action: "removed",
      layers: [{ layer: "base", path: "/tmp/AGENTS.md", action: "removed" }],
      installed: true,
    })),
  };
});

import { setupSetupCommands } from "../../../src/commands/setup.js";
import { outputResult } from "../../../src/common/output.js";
import {
  checkClaude,
  checkCodex,
  checkFileRecipe,
  checkGemini,
  checkMux,
  installClaude,
  installCodex,
  installFileRecipe,
  installGemini,
  installMux,
  removeClaude,
  removeCodex,
  removeFileRecipe,
  removeGemini,
  removeMux,
} from "../../../src/services/setup-service.js";

function createProgram(): Command {
  const program = new Command();
  setupSetupCommands(program);
  return program;
}

describe("linear setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    process.exitCode = 0;
  });

  it("--list emits the recipe catalog through outputResult", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "--list"]);
    const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
      recipes: Array<{ name: string }>;
    };
    const names = payload.recipes.map((r) => r.name);
    expect(names).toContain("claude");
    expect(names).toContain("cursor");
  });

  it("--print writes the workflow body to stdout", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "--print"]);
    expect(process.stdout.write).toHaveBeenCalled();
    const written = vi.mocked(process.stdout.write).mock.calls[0]?.[0];
    expect(String(written)).toContain("linear prime");
  });

  describe("--output <path>", () => {
    let cwdBackup: string;
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "linear-setup-out-")),
      );
      cwdBackup = process.cwd();
      process.chdir(tmpRoot);
    });

    afterEach(() => {
      process.chdir(cwdBackup);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("writes the workflow template to a relative path", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "test", "setup", "-o", "rules.md"]);
      const target = path.join(tmpRoot, "rules.md");
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(target, "utf8")).toContain("linear prime");
      const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
        action: string;
        path: string;
        bytes: number;
      };
      expect(payload.action).toBe("written");
      expect(payload.path).toBe(target);
      expect(payload.bytes).toBeGreaterThan(0);
    });

    it("creates intermediate directories", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "setup",
        "--output",
        "nested/dir/template.md",
      ]);
      const target = path.join(tmpRoot, "nested/dir/template.md");
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(target, "utf8")).toContain("linear prime");
    });

    it("accepts an absolute path", async () => {
      const program = createProgram();
      const target = path.join(tmpRoot, "abs-template.md");
      await program.parseAsync(["node", "test", "setup", "--output", target]);
      expect(fs.existsSync(target)).toBe(true);
    });

    it("--output short-circuits before recipe install", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "setup",
        "cursor",
        "-o",
        "rules.md",
      ]);
      // The recipe install should NOT be invoked when --output is set.
      expect(installFileRecipe).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(tmpRoot, "rules.md"))).toBe(true);
    });
  });

  describe("--add <name> <path>", () => {
    let cwdBackup: string;
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "linear-setup-add-")),
      );
      cwdBackup = process.cwd();
      process.chdir(tmpRoot);
    });

    afterEach(() => {
      process.chdir(cwdBackup);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("persists a user recipe to .linear/recipes.json", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "setup",
        "--add",
        "mytool",
        "docs/mytool.md",
      ]);
      const file = path.join(tmpRoot, ".linear", "recipes.json");
      expect(fs.existsSync(file)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(parsed.recipes.mytool.targetPath).toBe("docs/mytool.md");
      const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
        action: string;
        name: string;
        target: string;
      };
      expect(payload.action).toBe("added");
      expect(payload.name).toBe("mytool");
      expect(payload.target).toBe("docs/mytool.md");
    });

    it("--add without a positional path throws", async () => {
      const program = createProgram();
      // Commander's error handling routes through handleCommand, which exits 1 +
      // emits JSON to stderr. Just confirm outputResult never fired.
      await program.parseAsync(["node", "test", "setup", "--add", "mytool"]);
      expect(outputResult).not.toHaveBeenCalled();
    });

    it("--list surfaces user recipes alongside built-ins", async () => {
      // First add a user recipe.
      let program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "setup",
        "--add",
        "mytool",
        "docs/mytool.md",
      ]);
      vi.mocked(outputResult).mockClear();

      // Then list — the second call should include the user recipe.
      program = createProgram();
      await program.parseAsync(["node", "test", "setup", "--list"]);
      const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
        recipes: Array<{ name: string; source: string }>;
      };
      const mine = payload.recipes.find((r) => r.name === "mytool");
      expect(mine).toBeDefined();
      expect(mine?.source).toBe("user");
    });
  });

  it("installs a file recipe by name", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "cursor"]);
    expect(installFileRecipe).toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalled();
  });

  it("--check on a missing file recipe sets process.exitCode=1", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "cursor", "--check"]);
    expect(checkFileRecipe).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("--remove invokes removeFileRecipe", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "cursor", "--remove"]);
    expect(removeFileRecipe).toHaveBeenCalled();
  });

  it("dispatches claude to installClaude with global=false / stealth=false by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "claude"]);
    expect(installClaude).toHaveBeenCalledWith({
      cwd: expect.any(String),
      global: false,
      stealth: false,
    });
  });

  it("--global threads through to installClaude", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "claude", "--global"]);
    expect(installClaude).toHaveBeenCalledWith({
      cwd: expect.any(String),
      global: true,
      stealth: false,
    });
  });

  it("--stealth threads through to installClaude", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "claude", "--stealth"]);
    expect(installClaude).toHaveBeenCalledWith({
      cwd: expect.any(String),
      global: false,
      stealth: true,
    });
  });

  it("claude --check calls checkClaude", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "claude", "--check"]);
    expect(checkClaude).toHaveBeenCalled();
  });

  it("claude --remove calls removeClaude", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "claude", "--remove"]);
    expect(removeClaude).toHaveBeenCalled();
  });

  it("dispatches gemini to installGemini with global=false / stealth=false by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "gemini"]);
    expect(installGemini).toHaveBeenCalledWith({
      cwd: expect.any(String),
      global: false,
      stealth: false,
    });
    expect(installClaude).not.toHaveBeenCalled();
  });

  it("--global threads through to installGemini", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "gemini", "--global"]);
    expect(installGemini).toHaveBeenCalledWith({
      cwd: expect.any(String),
      global: true,
      stealth: false,
    });
  });

  it("--stealth threads through to installGemini", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "gemini", "--stealth"]);
    expect(installGemini).toHaveBeenCalledWith({
      cwd: expect.any(String),
      global: false,
      stealth: true,
    });
  });

  it("gemini --check calls checkGemini", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "gemini", "--check"]);
    expect(checkGemini).toHaveBeenCalled();
  });

  it("gemini --remove calls removeGemini", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "gemini", "--remove"]);
    expect(removeGemini).toHaveBeenCalled();
  });

  it("dispatches codex to installCodex with global=false by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "codex"]);
    expect(installCodex).toHaveBeenCalledWith({
      cwd: expect.any(String),
      global: false,
    });
    expect(installClaude).not.toHaveBeenCalled();
    expect(installGemini).not.toHaveBeenCalled();
  });

  it("--global threads through to installCodex", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "codex", "--global"]);
    expect(installCodex).toHaveBeenCalledWith({
      cwd: expect.any(String),
      global: true,
    });
  });

  it("codex --check calls checkCodex", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "codex", "--check"]);
    expect(checkCodex).toHaveBeenCalled();
  });

  it("codex --remove calls removeCodex", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "codex", "--remove"]);
    expect(removeCodex).toHaveBeenCalled();
  });

  it("dispatches mux with project=false global=false by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "mux"]);
    expect(installMux).toHaveBeenCalledWith({
      cwd: expect.any(String),
      project: false,
      global: false,
    });
  });

  it("mux --project and --global both thread through", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "setup",
      "mux",
      "--project",
      "--global",
    ]);
    expect(installMux).toHaveBeenCalledWith({
      cwd: expect.any(String),
      project: true,
      global: true,
    });
  });

  it("mux --check calls checkMux", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "mux", "--check"]);
    expect(checkMux).toHaveBeenCalled();
  });

  it("mux --remove calls removeMux", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "setup", "mux", "--remove"]);
    expect(removeMux).toHaveBeenCalled();
  });

  it("rejects an unknown recipe", async () => {
    const program = createProgram();
    let captured: unknown;
    vi.spyOn(console, "error").mockImplementation((msg) => {
      captured = msg;
    });
    await program.parseAsync(["node", "test", "setup", "bogus"]);
    expect(String(captured)).toMatch(/unknown recipe/);
  });

  it("errors when neither recipe nor --list/--print is supplied", async () => {
    const program = createProgram();
    let captured: unknown;
    vi.spyOn(console, "error").mockImplementation((msg) => {
      captured = msg;
    });
    await program.parseAsync(["node", "test", "setup"]);
    expect(String(captured)).toMatch(/missing recipe name/);
  });
});
