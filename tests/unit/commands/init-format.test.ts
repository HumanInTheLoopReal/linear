//
// Format tests for `linear init`. Layout mirrors other Phase-2 setup verbs:
// 📋 banner + Mode block (role/interactive/stealth) + Config block (team
// write status) + Identity block (delegates to formatContext so the section
// matches `linear context`) + Agents block (AGENTS.md action + CLAUDE.md
// action + Claude hook action) + Recipes block (when present) + Hooks block.

import { describe, expect, it } from "vitest";
import { formatInit } from "../../../src/commands/init.js";
import type { InitResult } from "../../../src/services/init-service.js";

describe("formatInit", () => {
  function makeResult(overrides: Partial<InitResult> = {}): InitResult {
    return {
      backend: "linear",
      role: "maintainer",
      interactive: false,
      stealth: false,
      context: {
        cli_version: "2026.4.9",
        backend: "linear",
        config_path: "/home/me/.linear/config.json",
        workspace: { id: "w", name: "Acme", url_key: "acme" },
        viewer: { id: "u", name: "Alex", email: "alex@acme.com" },
        default_team: {
          configured: "ENG",
          resolved: { id: "t", key: "ENG", name: "Engineering" },
        },
      },
      team_written: "ENG",
      agents_file: "/proj/AGENTS.md",
      agents_action: "created",
      agents_profile: "minimal",
      claude_md_file: "/proj/CLAUDE.md",
      claude_md_action: "created",
      claude_hook: {
        recipe: "claude",
        path: "/home/me/.claude/settings.json",
        scope: "global",
        action: "installed",
        stealth: false,
        command: "linear prime",
        events_added: ["SessionStart", "PreCompact"],
      },
      recipes: [],
      hooks: null,
      hooks_skipped_reason: "no hooks selected (pass --hooks=auto to install)",
      stealth_exclude: null,
      ...overrides,
    };
  }

  it("starts with the 📋 banner", () => {
    const out = formatInit(makeResult());
    expect(out.startsWith("📋 linear init:\n")).toBe(true);
  });

  it("renders Mode block with role + interactive flag", () => {
    const out = formatInit(makeResult());
    expect(out).toContain("Mode:\n");
    expect(out).toContain("  · role: maintainer, interactive: no\n");
  });

  it("renders Mode block with stealth annotation", () => {
    const out = formatInit(makeResult({ stealth: true }));
    expect(out).toContain("  · role: maintainer (stealth), interactive: no\n");
  });

  it("renders Config block with team write", () => {
    const out = formatInit(makeResult());
    expect(out).toContain("Config:\n");
    expect(out).toContain("  ✓ team → ENG\n");
  });

  it("renders Config block with no-team-given variant", () => {
    const out = formatInit(makeResult({ team_written: null }));
    expect(out).toContain("  · team (no --team given, unchanged)\n");
  });

  it("renders Identity block by delegating to formatContext (indented)", () => {
    const out = formatInit(makeResult());
    expect(out).toContain("Identity:\n");
    expect(out).toContain("  linear v2026.4.9\n");
    expect(out).toContain("  Workspace:\n");
    expect(out).toContain("    name:        Acme\n");
  });

  it("renders Agents block with created AGENTS.md and profile", () => {
    const out = formatInit(makeResult());
    expect(out).toContain("Agents:\n");
    expect(out).toContain("  ✓ /proj/AGENTS.md wrote (profile: minimal)\n");
  });

  it("renders Agents block with appended action label", () => {
    const out = formatInit(makeResult({ agents_action: "appended" }));
    expect(out).toContain(
      "  ✓ /proj/AGENTS.md appended managed block to (profile: minimal)\n",
    );
  });

  it("renders Agents block with preserved profile annotation", () => {
    const out = formatInit(
      makeResult({ agents_action: "preserved", agents_profile: "full" }),
    );
    expect(out).toContain(
      "  · /proj/AGENTS.md preserved (full profile kept across minimal re-run) (profile: full)\n",
    );
  });

  it("renders Agents block with --skip-agents (no file, no hook)", () => {
    const out = formatInit(
      makeResult({
        agents_file: null,
        agents_action: "skipped",
        claude_md_file: null,
        claude_md_action: "skipped",
        claude_hook: null,
      }),
    );
    expect(out).toContain("  · AGENTS.md skipped (--skip-agents)\n");
    expect(out).toContain("  · CLAUDE.md skipped (--skip-agents)\n");
  });

  it("renders Claude hook with events list", () => {
    const out = formatInit(makeResult());
    expect(out).toContain(
      "  ✓ Claude hook installed (global): /home/me/.claude/settings.json\n",
    );
    expect(out).toContain("    events: SessionStart, PreCompact\n");
  });

  it("renders Recipes block when extra recipes are installed", () => {
    const out = formatInit(
      makeResult({
        recipes: [
          {
            recipe: "claude",
            result: {
              recipe: "claude",
              path: "/home/me/.claude/settings.json",
              scope: "global",
              action: "installed",
              stealth: false,
              command: "linear prime",
            },
          },
          {
            recipe: "cursor",
            result: {
              recipe: "cursor",
              path: "/proj/.cursor/rules/linear.mdc",
              action: "installed",
            },
          },
        ],
      }),
    );
    expect(out).toContain("Recipes:\n");
    // Claude hook is filtered out of Recipes (shown above in Agents block)
    expect(out).toContain("  ✓ cursor → /proj/.cursor/rules/linear.mdc\n");
  });

  it("renders Hooks block with installer result", () => {
    const out = formatInit(
      makeResult({
        hooks: {
          recipe: "hooks",
          target: "lefthook",
          path: "/proj/lefthook.local.yml",
          action: "installed",
          hook_names: ["pre-commit", "pre-push"],
        },
      }),
    );
    expect(out).toContain("Hooks:\n");
    expect(out).toContain(
      "  ✓ lefthook → /proj/lefthook.local.yml (installed)\n",
    );
  });

  it("renders Hooks block with skipped-reason line", () => {
    const out = formatInit(makeResult());
    expect(out).toContain("Hooks:\n");
    expect(out).toContain(
      "  · no hooks selected (pass --hooks=auto to install)\n",
    );
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatInit(makeResult());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  // ── Stealth git-exclude block (lin-lntd) ────────────────────────────

  it("omits the Stealth block when stealth_exclude is null", () => {
    const out = formatInit(makeResult());
    expect(out).not.toContain("Stealth:\n");
  });

  it("renders the added patterns when stealth wrote the exclude", () => {
    const out = formatInit(
      makeResult({
        stealth: true,
        stealth_exclude: {
          path: "/proj/.git/info/exclude",
          added: [".linear/", ".claude/settings.local.json"],
          already_present: [],
          skipped_not_git: false,
        },
      }),
    );
    expect(out).toContain("Stealth:\n");
    expect(out).toContain(
      "  ✓ .git/info/exclude → +.linear/, .claude/settings.local.json\n",
    );
  });

  it("notes 'already configured' when nothing new was added", () => {
    const out = formatInit(
      makeResult({
        stealth: true,
        stealth_exclude: {
          path: "/proj/.git/info/exclude",
          added: [],
          already_present: [".linear/", ".claude/settings.local.json"],
          skipped_not_git: false,
        },
      }),
    );
    expect(out).toContain("  · .git/info/exclude already configured\n");
  });

  it("notes the skip when cwd is not a git repo", () => {
    const out = formatInit(
      makeResult({
        stealth: true,
        stealth_exclude: {
          path: null,
          added: [],
          already_present: [],
          skipped_not_git: true,
        },
      }),
    );
    expect(out).toContain("  · git exclude skipped (not a git repo)\n");
  });
});
