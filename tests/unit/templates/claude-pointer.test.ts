//
// Unit tests for the thin CLAUDE.md pointer template. The pointer is
// intentionally short (per PROCESS.md §D2) — these tests pin the shape so
// future edits don't accidentally inline a workflow brief.

import { describe, expect, it } from "vitest";
import { CLAUDE_POINTER } from "../../../src/templates/claude-pointer.js";

describe("CLAUDE_POINTER", () => {
  it("starts with the Claude Code title", () => {
    expect(CLAUDE_POINTER.startsWith("# Claude Code Entry Point\n")).toBe(true);
  });

  it("points at AGENTS.md as the workflow source", () => {
    expect(CLAUDE_POINTER).toContain("[AGENTS.md](AGENTS.md)");
  });

  it("lists the current ground rules", () => {
    expect(CLAUDE_POINTER).toContain("linear prime");
    expect(CLAUDE_POINTER).toContain("durable outcomes");
    expect(CLAUDE_POINTER).toContain("task system");
    expect(CLAUDE_POINTER).toContain("commits it to the backlog");
    expect(CLAUDE_POINTER).toContain("unrelated discoveries wait for triage");
  });

  it("mentions the plugin install hint", () => {
    expect(CLAUDE_POINTER).toContain("/plugin install linear");
  });

  it("stays short — ≤ 30 lines", () => {
    const lines = CLAUDE_POINTER.split("\n");
    expect(lines.length).toBeLessThanOrEqual(30);
  });
});
