import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudeSettingsPath,
  hasLinearMCP,
  hasLinearPlugin,
  isMCPActive,
  isValidJson,
  linearHookEvents,
  readAllClaudeSettings,
  readClaudeSettingsFile,
} from "../../../src/common/claude-settings.js";

// These helpers touch the filesystem, so each test gets its own isolated
// temp "home" + "project" dir. No mocking of fs — we drive real files,
// which mirrors how the doctor checks observe the world.
let tmpRoot: string;
let home: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-settings-"));
  home = path.join(tmpRoot, "home");
  cwd = path.join(tmpRoot, "project");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeSettings(
  dir: string,
  file: string,
  contents: string | object,
): void {
  const claudeDir = path.join(dir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const raw =
    typeof contents === "string" ? contents : JSON.stringify(contents, null, 2);
  fs.writeFileSync(path.join(claudeDir, file), raw);
}

const sessionStartHook = (command: string) => ({
  hooks: {
    SessionStart: [{ matcher: "", hooks: [{ type: "command", command }] }],
  },
});

describe("claudeSettingsPath", () => {
  it("joins home + .claude + settings.json for global scope", () => {
    expect(claudeSettingsPath("global", { home, cwd })).toBe(
      path.join(home, ".claude", "settings.json"),
    );
  });

  it("joins cwd + .claude + settings.json for project scope", () => {
    expect(claudeSettingsPath("project", { home, cwd })).toBe(
      path.join(cwd, ".claude", "settings.json"),
    );
  });

  it("joins cwd + .claude + settings.local.json for project-local scope", () => {
    expect(claudeSettingsPath("project-local", { home, cwd })).toBe(
      path.join(cwd, ".claude", "settings.local.json"),
    );
  });
});

describe("readClaudeSettingsFile", () => {
  it("reports a missing file as exists:false valid:false", () => {
    const f = readClaudeSettingsFile("global", { home, cwd });
    expect(f.exists).toBe(false);
    expect(f.valid).toBe(false);
    expect(f.settings).toBeUndefined();
  });

  it("parses a valid settings file", () => {
    writeSettings(cwd, "settings.json", { hooks: {} });
    const f = readClaudeSettingsFile("project", { home, cwd });
    expect(f.exists).toBe(true);
    expect(f.valid).toBe(true);
    expect(f.settings).toEqual({ hooks: {} });
  });

  it("flags a malformed settings file with an error message", () => {
    writeSettings(cwd, "settings.json", "{ not json ");
    const f = readClaudeSettingsFile("project", { home, cwd });
    expect(f.exists).toBe(true);
    expect(f.valid).toBe(false);
    expect(typeof f.error).toBe("string");
  });

  it("treats an empty file as a valid empty settings object", () => {
    writeSettings(cwd, "settings.json", "   \n");
    const f = readClaudeSettingsFile("project", { home, cwd });
    expect(f.exists).toBe(true);
    expect(f.valid).toBe(true);
    expect(f.settings).toEqual({});
  });
});

describe("readAllClaudeSettings", () => {
  it("returns all three scopes in stable order", () => {
    const all = readAllClaudeSettings({ home, cwd });
    expect(all.map((f) => f.scope)).toEqual([
      "global",
      "project",
      "project-local",
    ]);
  });
});

describe("isValidJson", () => {
  it("accepts valid JSON and empty strings", () => {
    expect(isValidJson('{"a":1}')).toBe(true);
    expect(isValidJson("")).toBe(true);
  });
  it("rejects malformed JSON", () => {
    expect(isValidJson("{ nope")).toBe(false);
  });
});

describe("linearHookEvents", () => {
  it("detects a SessionStart linear prime hook", () => {
    const events = linearHookEvents(sessionStartHook("linear prime"));
    expect(events.has("SessionStart")).toBe(true);
    expect(events.has("PreCompact")).toBe(false);
  });

  it("detects the stealth variant", () => {
    const events = linearHookEvents(sessionStartHook("linear prime --stealth"));
    expect(events.has("SessionStart")).toBe(true);
  });

  it("ignores a non-linear command", () => {
    const events = linearHookEvents(sessionStartHook("othertool prime"));
    expect(events.size).toBe(0);
  });

  it("returns empty for settings without hooks", () => {
    expect(linearHookEvents({}).size).toBe(0);
    expect(linearHookEvents(undefined).size).toBe(0);
  });

  it("detects both events when both are wired", () => {
    const events = linearHookEvents({
      hooks: {
        SessionStart: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "linear prime" }],
          },
        ],
        PreCompact: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "linear prime" }],
          },
        ],
      },
    });
    expect(events.has("SessionStart")).toBe(true);
    expect(events.has("PreCompact")).toBe(true);
  });
});

describe("hasLinearPlugin", () => {
  it("returns true when a linear plugin is enabled", () => {
    expect(
      hasLinearPlugin({
        enabledPlugins: { "linear@linear-marketplace": true },
      }),
    ).toBe(true);
  });

  it("returns false when the plugin entry is disabled", () => {
    expect(
      hasLinearPlugin({
        enabledPlugins: { "linear@linear-marketplace": false },
      }),
    ).toBe(false);
  });

  it("returns false when no enabledPlugins section exists", () => {
    expect(hasLinearPlugin({})).toBe(false);
    expect(hasLinearPlugin(undefined)).toBe(false);
  });

  it("ignores unrelated plugins", () => {
    expect(
      hasLinearPlugin({
        enabledPlugins: { "other-tool@some-marketplace": true },
      }),
    ).toBe(false);
  });
});

describe("hasLinearMCP", () => {
  it("detects a linear MCP server by key", () => {
    expect(
      hasLinearMCP({ mcpServers: { linear: { command: "linear mcp" } } }),
    ).toBe(true);
  });

  it("matches case-insensitively and as a substring", () => {
    expect(hasLinearMCP({ mcpServers: { "Linear-Remote": {} } })).toBe(true);
  });

  it("ignores unrelated MCP servers", () => {
    expect(hasLinearMCP({ mcpServers: { othertool: {} } })).toBe(false);
  });

  it("returns false when no mcpServers section exists", () => {
    expect(hasLinearMCP({})).toBe(false);
    expect(hasLinearMCP(undefined)).toBe(false);
  });
});

describe("isMCPActive", () => {
  it("returns true when ~/.claude/settings.json wires a linear MCP server", () => {
    writeSettings(home, "settings.json", {
      mcpServers: { linear: { command: "linear mcp" } },
    });
    expect(isMCPActive({ home })).toBe(true);
  });

  it("returns false when settings.json has no linear MCP server", () => {
    writeSettings(home, "settings.json", { mcpServers: { othertool: {} } });
    expect(isMCPActive({ home })).toBe(false);
  });

  it("returns false when the settings file is absent", () => {
    expect(isMCPActive({ home })).toBe(false);
  });

  it("returns false when the settings file is malformed JSON", () => {
    writeSettings(home, "settings.json", "{ not json ");
    expect(isMCPActive({ home })).toBe(false);
  });
});
