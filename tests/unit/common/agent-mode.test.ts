//
// Unit tests for agent-mode detection + token-economy limit resolution
// (lin-g1hy).

import { describe, expect, it } from "vitest";
import {
  AGENT_LIST_LIMIT,
  resolveAgentLimit,
  resolveAgentMode,
} from "../../../src/common/agent-mode.js";

describe("resolveAgentMode", () => {
  it("is off with an empty environment", () => {
    expect(resolveAgentMode({})).toBe(false);
  });

  it("auto-detects the Claude Code host via CLAUDECODE", () => {
    expect(resolveAgentMode({ CLAUDECODE: "1" })).toBe(true);
  });

  it("auto-detects via CLAUDE_CODE", () => {
    expect(resolveAgentMode({ CLAUDE_CODE: "1" })).toBe(true);
  });

  it("LINEAR_AGENT_MODE=1 forces on", () => {
    expect(resolveAgentMode({ LINEAR_AGENT_MODE: "1" })).toBe(true);
  });

  it("LINEAR_AGENT_MODE=0 forces off even inside Claude Code (opt-out wins)", () => {
    expect(resolveAgentMode({ LINEAR_AGENT_MODE: "0", CLAUDECODE: "1" })).toBe(
      false,
    );
  });

  it("LINEAR_AGENT_MODE=false forces off", () => {
    expect(
      resolveAgentMode({ LINEAR_AGENT_MODE: "false", CLAUDECODE: "1" }),
    ).toBe(false);
  });

  it("LINEAR_AGENT_MODE=true forces on without a host var", () => {
    expect(resolveAgentMode({ LINEAR_AGENT_MODE: "true" })).toBe(true);
  });

  it("treats an empty LINEAR_AGENT_MODE as unset (falls through to host)", () => {
    expect(resolveAgentMode({ LINEAR_AGENT_MODE: "", CLAUDECODE: "1" })).toBe(
      true,
    );
    expect(resolveAgentMode({ LINEAR_AGENT_MODE: "" })).toBe(false);
  });
});

describe("resolveAgentLimit", () => {
  it("substitutes the agent default when the value came from the static default", () => {
    expect(resolveAgentLimit(50, "default", true)).toBe(AGENT_LIST_LIMIT);
  });

  it("keeps the human default when agent mode is off", () => {
    expect(resolveAgentLimit(50, "default", false)).toBe(50);
  });

  it("honors an explicit --limit (cli source) even in agent mode", () => {
    expect(resolveAgentLimit(100, "cli", true)).toBe(100);
  });

  it("honors an env-sourced limit in agent mode", () => {
    expect(resolveAgentLimit(75, "env", true)).toBe(75);
  });

  it("accepts a custom agent default", () => {
    expect(resolveAgentLimit(100, "default", true, 5)).toBe(5);
  });
});
