import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { allMetas, buildProgram } from "../../src/program.js";

/**
 * Usage-consistency invariant (lin-ay7q, item 1). Every user-facing domain
 * must expose a progressive-disclosure usage path so `linear <domain> usage`
 * (or the flat `linear <domain>-usage` for single-verb commands) always
 * works. The test walks the REAL constructed command tree rather than a
 * hand-maintained list, so a future domain added without a usage path fails
 * here automatically.
 */
function hasUsagePath(program: Command, name: string): boolean {
  const cmd = program.commands.find((c) => c.name() === name);
  if (!cmd) return false;
  // Domains with subcommands expose `<domain> usage`.
  if (cmd.commands.some((s) => s.name() === "usage")) return true;
  // Flat single-verb commands (e.g. `linear assign <id> <user>`) can't host a
  // `usage` subcommand, so they expose a sibling `<name>-usage` command.
  return program.commands.some((c) => c.name() === `${name}-usage`);
}

describe("buildProgram", () => {
  it("names the program 'linear' and wires the top-level commands", () => {
    const program = buildProgram();
    expect(program.name()).toBe("linear");
    expect(program.commands.length).toBeGreaterThan(0);
  });

  it("returns a fresh, hermetic program each call (no shared singleton)", () => {
    expect(buildProgram()).not.toBe(buildProgram());
  });

  it("registers every domain in allMetas as a top-level command", () => {
    const program = buildProgram();
    const names = new Set(program.commands.map((c) => c.name()));
    const missing = allMetas.map((m) => m.name).filter((n) => !names.has(n));
    expect(missing).toEqual([]);
  });

  it("every domain exposes a usage progressive-disclosure path", () => {
    const program = buildProgram();
    const offenders = allMetas
      .map((m) => m.name)
      .filter((name) => !hasUsagePath(program, name));
    expect(offenders).toEqual([]);
  });

  it("exposes the top-level `usage` overview command", () => {
    const program = buildProgram();
    expect(program.commands.some((c) => c.name() === "usage")).toBe(true);
  });
});
