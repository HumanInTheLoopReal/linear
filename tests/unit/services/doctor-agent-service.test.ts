import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_CHECK_NAMES,
  checkClaudeHooks,
  checkClaudePlugin,
  checkClaudeSettings,
  checkCliInPath,
  isAgentCheckName,
  resolveAgentChecks,
} from "../../../src/services/doctor-agent-service.js";

// The service composes filesystem/PATH probes. Drive an isolated temp
// home/cwd so the four checks are deterministic regardless of the host.
let tmpRoot: string;
let home: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-agent-resolver-"));
  home = path.join(tmpRoot, "home");
  cwd = path.join(tmpRoot, "project");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeProjectSettings(file: string, contents: string | object): void {
  const claudeDir = path.join(cwd, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, file),
    typeof contents === "string" ? contents : JSON.stringify(contents, null, 2),
  );
}

const bothHooks = {
  hooks: {
    SessionStart: [
      { matcher: "", hooks: [{ type: "command", command: "linear prime" }] },
    ],
    PreCompact: [
      { matcher: "", hooks: [{ type: "command", command: "linear prime" }] },
    ],
  },
};

describe("integration-health probes", () => {
  it("reports plugin absence as the expected advisory state", () => {
    const check = checkClaudePlugin({ home, cwd });
    expect(check).toMatchObject({
      name: "claude_plugin",
      status: "ok",
      category: "integration",
      observed_state: "plugin_enabled=false",
    });
  });

  it("detects an enabled linear plugin", () => {
    writeProjectSettings("settings.json", {
      enabledPlugins: { "linear@linear-marketplace": true },
    });
    const check = checkClaudePlugin({ home, cwd });
    expect(check.status).toBe("ok");
    expect(check.message).toMatch(/enabled/);
    expect(check.observed_state).toMatch(/plugin_enabled_in/);
  });

  it("reports absent and valid settings files accurately", () => {
    expect(checkClaudeSettings({ home, cwd }).observed_state).toBe(
      "settings_files=0",
    );
    writeProjectSettings("settings.json", { hooks: {} });
    const check = checkClaudeSettings({ home, cwd });
    expect(check.status).toBe("ok");
    expect(check.message).toMatch(/valid/);
  });

  it("escalates malformed settings JSON", () => {
    writeProjectSettings("settings.json", "{ broken ");
    const check = checkClaudeSettings({ home, cwd });
    expect(check.status).toBe("error");
    expect(check.severity).toBe("error");
    expect(check.detail).toMatch(/.claude\/settings.json/);
  });

  it("accepts both required linear prime hooks", () => {
    writeProjectSettings("settings.json", bothHooks);
    const check = checkClaudeHooks({ home, cwd });
    expect(check.status).toBe("ok");
    expect(check.message).toMatch(/SessionStart and PreCompact/);
  });

  it("warns when only SessionStart is wired", () => {
    writeProjectSettings("settings.json", {
      hooks: {
        SessionStart: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "linear prime" }],
          },
        ],
      },
    });
    const check = checkClaudeHooks({ home, cwd });
    expect(check.status).toBe("warning");
    expect(check.message).toMatch(/PreCompact/);
  });

  it("warns when settings contain no linear hooks", () => {
    writeProjectSettings("settings.json", {
      hooks: {
        SessionStart: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "othertool prime" }],
          },
        ],
      },
    });
    const check = checkClaudeHooks({ home, cwd });
    expect(check.status).toBe("warning");
    expect(check.fix).toMatch(/linear setup claude/);
  });

  it("detects an executable on a synthetic PATH", () => {
    const binDir = path.join(tmpRoot, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const executable = path.join(binDir, "linear");
    fs.writeFileSync(executable, "#!/bin/sh\n");
    fs.chmodSync(executable, 0o755);
    const check = checkCliInPath({ home, cwd, pathEnv: binDir });
    expect(check.status).toBe("ok");
    expect(check.observed_state).toMatch(/cli_in_path=true/);
  });

  it("warns for missing, empty, and custom-name PATH lookups", () => {
    const missing = checkCliInPath({
      home,
      cwd,
      pathEnv: path.join(tmpRoot, "empty"),
    });
    expect(missing.status).toBe("warning");
    expect(missing.fix).toMatch(/PATH/);
    expect(checkCliInPath({ home, cwd, pathEnv: "" }).status).toBe("warning");
    expect(
      checkCliInPath({ home, cwd, pathEnv: "", cliName: "lin" }).message,
    ).toMatch(/'lin'/);
  });
});

describe("isAgentCheckName", () => {
  it("accepts the four integration check names", () => {
    for (const n of AGENT_CHECK_NAMES) {
      expect(isAgentCheckName(n)).toBe(true);
    }
  });
  it("rejects workspace and bogus names", () => {
    expect(isAgentCheckName("auth")).toBe(false);
    expect(isAgentCheckName("bogus")).toBe(false);
  });
});

describe("resolveAgentChecks", () => {
  it("runs all four checks in order when no filter is given", () => {
    const checks = resolveAgentChecks({ home, cwd, pathEnv: "" });
    expect(checks.map((c) => c.name)).toEqual([
      "claude_plugin",
      "claude_settings",
      "claude_hooks",
      "cli_in_path",
    ]);
  });

  it("runs only the requested check when `only` is an agent name", () => {
    const checks = resolveAgentChecks({
      only: "claude_hooks",
      home,
      cwd,
      pathEnv: "",
    });
    expect(checks).toHaveLength(1);
    expect(checks[0].name).toBe("claude_hooks");
  });

  it("returns [] when `only` is a non-agent (workspace) check name", () => {
    expect(resolveAgentChecks({ only: "auth", home, cwd })).toEqual([]);
  });

  it("returns [] when `only` is an unknown name", () => {
    expect(resolveAgentChecks({ only: "bogus", home, cwd })).toEqual([]);
  });

  it("populates ZFC fields on every emitted check", () => {
    const checks = resolveAgentChecks({ home, cwd, pathEnv: "" });
    for (const c of checks) {
      expect(typeof c.severity).toBe("string");
      expect(typeof c.observed_state).toBe("string");
      expect(typeof c.expected_state).toBe("string");
      expect(Array.isArray(c.commands)).toBe(true);
      expect(c.category).toBe("integration");
    }
  });
});
