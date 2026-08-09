//
// Format tests for the hooks suite (run / list / install / uninstall).
// Hooks is local operational tooling.
//
//   run        → `<icon> <hook>: <detail|reason|no-op>` per invocation
//   list       → `Managed hooks:` block + `Install:` footer
//   install    → `<icon> Hooks <verb> via <target> at <path>` + hooks line
//   uninstall  → `✓ Removed` / `· Absent` per the action enum

import { describe, expect, it } from "vitest";
import {
  formatHooksInstall,
  formatHooksList,
  formatHooksRun,
  formatHooksUninstall,
} from "../../../src/commands/hooks.js";

describe("formatHooksRun", () => {
  it("renders `✓ <hook>: <detail>` for the applied case", () => {
    expect(
      formatHooksRun({
        hook: "prepare-commit-msg",
        action: "applied",
        detail: "appended Executed-By: claude",
      }),
    ).toBe("✓ prepare-commit-msg: appended Executed-By: claude\n");
  });

  it("falls back to `applied` when detail is missing", () => {
    expect(
      formatHooksRun({ hook: "prepare-commit-msg", action: "applied" }),
    ).toBe("✓ prepare-commit-msg: applied\n");
  });

  it("renders `· <hook>: skipped — <reason>` when reason is present", () => {
    expect(
      formatHooksRun({
        hook: "prepare-commit-msg",
        action: "skipped",
        reason: "LINEAR_ACTOR not set",
      }),
    ).toBe("· prepare-commit-msg: skipped — LINEAR_ACTOR not set\n");
  });

  it("renders `· <hook>: no-op` for a recognized but inert hook", () => {
    expect(formatHooksRun({ hook: "pre-commit", action: "skipped" })).toBe(
      "· pre-commit: no-op\n",
    );
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatHooksRun({
      hook: "prepare-commit-msg",
      action: "applied",
      detail: "x",
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("renders per-issue entries for post-commit auto-close", () => {
    const out = formatHooksRun({
      hook: "post-commit",
      action: "applied",
      detail: "parsed 2, closed 1",
      entries: [
        { identifier: "ENG-1", outcome: "closed" },
        { identifier: "ENG-2", outcome: "already-closed" },
      ],
    });
    expect(out).toContain("✓ post-commit: parsed 2, closed 1");
    expect(out).toContain("  ✓ ENG-1: closed");
    expect(out).toContain("  · ENG-2: already-closed");
  });

  it("marks 'error' entries with ✗ and the reason in parens", () => {
    const out = formatHooksRun({
      hook: "post-commit",
      action: "applied",
      detail: "parsed 1, closed 0",
      entries: [
        {
          identifier: "ENG-3",
          outcome: "error",
          reason: "permission denied",
        },
      ],
    });
    expect(out).toContain("  ✗ ENG-3: error (permission denied)");
  });

  it("renders no entries block when post-commit has no trailers", () => {
    const out = formatHooksRun({
      hook: "post-commit",
      action: "skipped",
      reason: "no close-trailers (Closes/Fixes/Resolves) in commit message",
      entries: [],
    });
    expect(out).toContain("· post-commit: skipped — no close-trailers");
    expect(out.split("\n").filter((l) => l.startsWith("  "))).toHaveLength(0);
  });
});

describe("formatHooksList", () => {
  function makeResult(
    overrides: Partial<Parameters<typeof formatHooksList>[0]> = {},
  ) {
    return {
      managed: [
        { hook: "prepare-commit-msg", has_behavior: true },
        { hook: "pre-commit", has_behavior: false },
        { hook: "post-merge", has_behavior: false },
      ],
      install: {
        target: "lefthook",
        path: "/repo/lefthook.local.yml",
        installed: false,
        lefthook_present: true,
        hook_names: ["prepare-commit-msg"],
      },
      note: "run `linear hooks install` …",
      ...overrides,
    };
  }

  it("renders the `Managed hooks:` header", () => {
    const out = formatHooksList(makeResult());
    expect(out.startsWith("Managed hooks:\n")).toBe(true);
  });

  it("marks behavior-bearing hooks with • and (active)", () => {
    const out = formatHooksList(makeResult());
    expect(out).toContain("• prepare-commit-msg");
    expect(out).toContain("(active)");
  });

  it("marks inert hooks with · and (inert)", () => {
    const out = formatHooksList(makeResult());
    expect(out).toContain("· pre-commit");
    expect(out).toContain("(inert)");
  });

  it("renders the per-hook narrative indented under each row when present", () => {
    const out = formatHooksList(
      makeResult({
        managed: [
          {
            hook: "prepare-commit-msg",
            has_behavior: true,
            narrative: "append Executed-By trailer + queue close-trailers",
          },
          {
            hook: "pre-commit",
            has_behavior: false,
            narrative: "linear-cli has no local issue DB to export. No-op.",
          },
        ],
      }),
    );
    expect(out).toContain(
      "      append Executed-By trailer + queue close-trailers",
    );
    expect(out).toContain(
      "      linear-cli has no local issue DB to export. No-op.",
    );
  });

  it("pads hook names so labels align", () => {
    const out = formatHooksList(makeResult());
    // Only the managed-hook rows have parens; the hint line below does not.
    const hookLines = out
      .split("\n")
      .filter((l) => l.startsWith("  ") && l.includes("("));
    const positions = hookLines.map((l) => l.indexOf("("));
    expect(new Set(positions).size).toBe(1);
  });

  it("renders `Install: not installed via <target> at <path>` when not wired", () => {
    const out = formatHooksList(makeResult());
    expect(out).toContain(
      "Install: not installed via lefthook at /repo/lefthook.local.yml\n",
    );
    expect(out).toContain(
      "  hint: run `linear hooks install` to wire dispatchers\n",
    );
  });

  it("renders `installed` + `hooks:` row when wiring is present", () => {
    const out = formatHooksList(
      makeResult({
        install: {
          target: "lefthook",
          path: "/repo/lefthook.local.yml",
          installed: true,
          lefthook_present: true,
          hook_names: ["prepare-commit-msg"],
        },
      }),
    );
    expect(out).toContain(
      "Install: installed via lefthook at /repo/lefthook.local.yml\n",
    );
    expect(out).toContain("  hooks: prepare-commit-msg\n");
    expect(out).not.toContain("hint:");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatHooksList(makeResult());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatHooksInstall", () => {
  it("renders `✓ Hooks installed via <target> at <path>` for `installed`", () => {
    const out = formatHooksInstall({
      target: "lefthook",
      path: "/repo/lefthook.local.yml",
      action: "installed",
      hook_names: ["prepare-commit-msg"],
    });
    expect(out).toContain(
      "✓ Hooks installed via lefthook at /repo/lefthook.local.yml\n",
    );
    expect(out).toContain("  hooks: prepare-commit-msg\n");
  });

  it("renders `✓ Hooks updated ...` for `updated`", () => {
    const out = formatHooksInstall({
      target: "git-hooks",
      path: "/repo/.git/hooks/prepare-commit-msg",
      action: "updated",
      hook_names: ["prepare-commit-msg"],
    });
    expect(out).toContain("✓ Hooks updated via git-hooks at");
  });

  it("renders `· Hooks already installed ...` for `current`", () => {
    const out = formatHooksInstall({
      target: "lefthook",
      path: "/repo/lefthook.local.yml",
      action: "current",
      hook_names: ["prepare-commit-msg"],
    });
    expect(out).toContain(
      "· Hooks already installed via lefthook at /repo/lefthook.local.yml\n",
    );
  });

  it("omits the hooks-list line when hook_names is empty", () => {
    const out = formatHooksInstall({
      target: "lefthook",
      path: "/repo/lefthook.local.yml",
      action: "installed",
      hook_names: [],
    });
    expect(out).not.toContain("hooks:");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatHooksInstall({
      target: "lefthook",
      path: "/p",
      action: "installed",
      hook_names: ["prepare-commit-msg"],
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("surfaces `shared git-hooks` + core.hooksPath for a shared install (lin-j1bp)", () => {
    const out = formatHooksInstall({
      target: "git-hooks",
      path: "/repo/.linear-hooks/prepare-commit-msg",
      action: "installed",
      hook_names: ["prepare-commit-msg"],
      shared: true,
      hooks_path: "/repo/.linear-hooks",
    });
    expect(out).toContain("via shared git-hooks at");
    expect(out).toContain("git config core.hooksPath=/repo/.linear-hooks\n");
  });

  it("notes chained content when pre-existing hooks were preserved (lin-j1bp)", () => {
    const out = formatHooksInstall({
      target: "git-hooks",
      path: "/repo/.git/hooks/pre-commit",
      action: "installed",
      hook_names: ["pre-commit"],
      chained: true,
    });
    expect(out).toContain("chained: pre-existing hook content preserved");
  });
});

describe("formatHooksUninstall", () => {
  it("renders `✓ Removed ...` for `removed`", () => {
    const out = formatHooksUninstall({
      target: "lefthook",
      path: "/repo/lefthook.local.yml",
      action: "removed",
      hook_names: ["prepare-commit-msg"],
    });
    expect(out).toContain(
      "✓ Removed hook wiring from lefthook at /repo/lefthook.local.yml\n",
    );
    expect(out).toContain("  hooks: prepare-commit-msg\n");
  });

  it("renders `· No managed hook wiring found ...` for `absent`", () => {
    expect(
      formatHooksUninstall({
        target: "lefthook",
        path: "/repo/lefthook.local.yml",
        action: "absent",
        hook_names: [],
      }),
    ).toBe("· No managed hook wiring found at /repo/lefthook.local.yml\n");
  });

  it("omits the hooks-list line for `removed` with no hook_names", () => {
    const out = formatHooksUninstall({
      target: "lefthook",
      path: "/repo/lefthook.local.yml",
      action: "removed",
      hook_names: [],
    });
    expect(out).not.toContain("hooks:");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatHooksUninstall({
      target: "lefthook",
      path: "/p",
      action: "removed",
      hook_names: [],
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("notes core.hooksPath reset for a shared uninstall (lin-j1bp)", () => {
    const out = formatHooksUninstall({
      target: "git-hooks",
      path: "/repo/.linear-hooks/prepare-commit-msg",
      action: "removed",
      hook_names: ["prepare-commit-msg"],
      shared: true,
      hooks_path_reset: true,
    });
    expect(out).toContain("from shared git-hooks at");
    expect(out).toContain("git config core.hooksPath unset");
  });
});
