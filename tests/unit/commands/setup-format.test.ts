//
// Format tests for `linear setup` text-default output. There are six
// distinct shape-specific formatters because setup dispatches to recipe
// install / check / remove / list / add / -o paths, each returning a
// different envelope:
//
//   formatSetupList        — `--list`         (recipe catalog)
//   formatSetupAdd         — `--add NAME PATH` (user recipe persisted)
//   formatSetupOutput      — `-o PATH`        (template written to path)
//   formatSetupFileRecipe  — file recipe install/check/remove
//   formatSetupClaude      — claude (hook) install/check/remove
//   formatSetupGemini      — gemini (hook) install/check/remove
//   formatSetupCodex       — codex (section) install/check/remove
//   formatSetupMux         — mux (section, multi-layer) install/check/remove
//
// Vocabulary: ✓ active/success, · neutral/no-op, ✗ missing.

import { describe, expect, it } from "vitest";
import {
  formatSetupAdd,
  formatSetupClaude,
  formatSetupCodex,
  formatSetupFileRecipe,
  formatSetupGemini,
  formatSetupList,
  formatSetupMux,
  formatSetupOutput,
} from "../../../src/commands/setup.js";

describe("formatSetupList", () => {
  it("renders 📋 header with recipe count and rows", () => {
    const out = formatSetupList({
      recipes: [
        {
          name: "cursor",
          description: "Cursor IDE rules",
          kind: "file",
          target: ".cursor/rules/linear.mdc",
          source: "builtin",
        },
        {
          name: "claude",
          description: "Claude Code SessionStart hook",
          kind: "hook",
          target: null,
          source: "builtin",
        },
      ],
    });
    expect(out).toContain("📋 Setup recipes (2):\n");
    expect(out).toContain("cursor");
    expect(out).toContain("[file]");
    expect(out).toContain("Cursor IDE rules");
    expect(out).toContain("→ .cursor/rules/linear.mdc");
    expect(out).toContain("[hook]");
    expect(out).toContain("Claude Code SessionStart hook");
  });

  it("flags user recipes with `(user)`", () => {
    const out = formatSetupList({
      recipes: [
        {
          name: "mytool",
          description: "custom",
          kind: "file",
          target: "docs/mytool.md",
          source: "user",
        },
      ],
    });
    expect(out).toContain("(user)");
  });
});

describe("formatSetupAdd", () => {
  it("emits ✓ + target + config + hint", () => {
    const out = formatSetupAdd({
      action: "added",
      name: "mytool",
      target: "docs/mytool.md",
      config: ".linear/recipes.json",
      hint: "install with: linear setup mytool",
    });
    expect(out).toContain("✓ Recipe 'mytool' added\n");
    expect(out).toContain("  target: docs/mytool.md\n");
    expect(out).toContain("  config: .linear/recipes.json\n");
    expect(out).toContain("  install with: linear setup mytool\n");
  });
});

describe("formatSetupOutput", () => {
  it("emits a single ✓ line with path and bytes", () => {
    const out = formatSetupOutput({
      action: "written",
      path: "/tmp/x.md",
      bytes: 1234,
    });
    expect(out).toBe("✓ Wrote workflow template → /tmp/x.md (1234 bytes)\n");
  });
});

describe("formatSetupFileRecipe", () => {
  it("install → ✓", () => {
    const out = formatSetupFileRecipe({
      recipe: "cursor",
      path: "/tmp/x",
      action: "installed",
    });
    expect(out).toContain("✓ cursor (file) installed\n");
    expect(out).toContain("  path: /tmp/x\n");
  });

  it("check installed → ✓", () => {
    const out = formatSetupFileRecipe({
      recipe: "cursor",
      path: "/tmp/x",
      action: "checked",
      installed: true,
    });
    expect(out).toContain("✓ cursor (file) installed\n");
  });

  it("check missing → ✗", () => {
    const out = formatSetupFileRecipe({
      recipe: "cursor",
      path: "/tmp/x",
      action: "checked",
      installed: false,
    });
    expect(out).toContain("✗ cursor (file) not installed\n");
  });

  it("remove existing → ✓ removed", () => {
    const out = formatSetupFileRecipe({
      recipe: "cursor",
      path: "/tmp/x",
      action: "removed",
      installed: true,
    });
    expect(out).toContain("✓ cursor (file) removed\n");
  });

  it("remove already-absent → · already absent", () => {
    const out = formatSetupFileRecipe({
      recipe: "cursor",
      path: "/tmp/x",
      action: "removed",
      installed: false,
    });
    expect(out).toContain("· cursor (file) already absent\n");
  });
});

describe("formatSetupClaude", () => {
  it("install lists path + command + events_added", () => {
    const out = formatSetupClaude({
      recipe: "claude",
      path: "/tmp/c/settings.json",
      scope: "project",
      action: "installed",
      stealth: false,
      command: "linear prime",
      events_added: ["SessionStart", "PreCompact"],
    });
    expect(out).toContain("✓ claude (hook, project) installed\n");
    expect(out).toContain("  path:    /tmp/c/settings.json\n");
    expect(out).toContain("  command: linear prime\n");
    expect(out).toContain("  events added:   SessionStart, PreCompact\n");
  });

  it("remove lists events_removed", () => {
    const out = formatSetupClaude({
      recipe: "claude",
      path: "/tmp/c/settings.json",
      scope: "global",
      action: "removed",
      stealth: false,
      command: "linear prime",
      events_removed: ["SessionStart"],
      installed: true,
    });
    expect(out).toContain("✓ claude (hook, global) removed\n");
    expect(out).toContain("  events removed: SessionStart\n");
  });

  it("check missing → ✗ not installed", () => {
    const out = formatSetupClaude({
      recipe: "claude",
      path: "/tmp/c/settings.json",
      scope: "project",
      action: "checked",
      stealth: false,
      command: "linear prime",
      installed: false,
    });
    expect(out).toContain("✗ claude (hook, project) not installed\n");
  });

  it("install surfaces the legacy_migrated path (lin-9svq)", () => {
    const out = formatSetupClaude({
      recipe: "claude",
      path: "/tmp/c/settings.json",
      scope: "project",
      action: "installed",
      stealth: false,
      command: "linear prime",
      events_added: ["SessionStart"],
      legacy_migrated: "/tmp/c/settings.local.json",
    });
    expect(out).toContain("  migrated:       /tmp/c/settings.local.json\n");
  });
});

describe("formatSetupGemini", () => {
  it("includes the GEMINI.md companion line", () => {
    const out = formatSetupGemini({
      recipe: "gemini",
      path: "/tmp/g/settings.json",
      scope: "project",
      action: "installed",
      stealth: false,
      command: "linear prime",
      events_added: ["SessionStart", "PreCompress"],
      instructions_file: "/tmp/GEMINI.md",
      instructions_action: "written",
    });
    expect(out).toContain("✓ gemini (hook, project) installed\n");
    expect(out).toContain("  GEMINI.md:      written (/tmp/GEMINI.md)\n");
  });
});

describe("formatSetupCodex", () => {
  it("includes the section action", () => {
    const out = formatSetupCodex({
      recipe: "codex",
      path: "/tmp/AGENTS.md",
      scope: "project",
      action: "installed",
      instructions_action: "written",
    });
    // Composite header (section + agent-skill) — lin-jxta widened the
    // codex render envelope to surface both legs.
    expect(out).toContain("✓ codex (section + agent-skill, project) installed");
    expect(out).toContain("  path:        /tmp/AGENTS.md");
    expect(out).toContain("  section:     written");
  });

  it("renders the agent-skill leg when present", () => {
    const out = formatSetupCodex({
      recipe: "codex",
      path: "/tmp/AGENTS.md",
      scope: "project",
      action: "installed",
      instructions_action: "written",
      agent_skill: {
        paths: [
          "/tmp/.agents/skills/linear/SKILL.md",
          "/tmp/.agents/skills/linear/agents/openai.yaml",
        ],
        installed: true,
      },
    });
    expect(out).toContain("  agent-skill: ✓ (2 files)");
    expect(out).toContain("    /tmp/.agents/skills/linear/SKILL.md");
    expect(out).toContain("    /tmp/.agents/skills/linear/agents/openai.yaml");
  });

  it("check missing → ✗", () => {
    const out = formatSetupCodex({
      recipe: "codex",
      path: "/tmp/AGENTS.md",
      scope: "global",
      action: "checked",
      instructions_action: "absent",
      installed: false,
    });
    expect(out).toContain(
      "✗ codex (section + agent-skill, global) not installed",
    );
  });

  it("renders the native-hooks leg when present", () => {
    const out = formatSetupCodex({
      recipe: "codex",
      path: "/tmp/AGENTS.md",
      scope: "project",
      action: "installed",
      instructions_action: "written",
      hooks_config: {
        config_path: "/tmp/.codex/config.toml",
        hooks_path: "/tmp/.codex/hooks.json",
        action: "installed",
        installed: true,
      },
    });
    expect(out).toContain("  hooks:       ✓");
    expect(out).toContain("    /tmp/.codex/config.toml");
    expect(out).toContain("    /tmp/.codex/hooks.json");
  });
});

describe("formatSetupMux", () => {
  it("renders one row per layer", () => {
    const out = formatSetupMux({
      recipe: "mux",
      action: "installed",
      layers: [
        { layer: "base", path: "/tmp/AGENTS.md", action: "written" },
        { layer: "project", path: "/tmp/.mux/AGENTS.md", action: "written" },
      ],
      installed: true,
    });
    expect(out).toContain("✓ mux (sections) installed\n");
    expect(out).toContain("  [base] written: /tmp/AGENTS.md\n");
    expect(out).toContain("  [project] written: /tmp/.mux/AGENTS.md\n");
  });

  it("check with installed=false → · not installed", () => {
    const out = formatSetupMux({
      recipe: "mux",
      action: "checked",
      layers: [{ layer: "base", path: "/tmp/AGENTS.md", action: "absent" }],
      installed: false,
    });
    expect(out).toContain("· mux (sections) not installed\n");
  });
});
