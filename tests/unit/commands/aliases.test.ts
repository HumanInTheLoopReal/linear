import { describe, expect, it } from "vitest";
import {
  ALIASES,
  applyTopLevelAliases,
} from "../../../src/commands/aliases.js";
import { buildProgram } from "../../../src/program.js";

const NODE = "/usr/bin/node";
const SCRIPT = "/path/to/linear";

describe("ALIASES map", () => {
  const program = buildProgram();
  const topLevelCommands = new Set(
    program.commands.map((command) => command.name()),
  );

  it("never shadows an existing linear top-level command", () => {
    const collisions = Object.keys(ALIASES).filter((k) =>
      topLevelCommands.has(k),
    );
    expect(collisions).toEqual([]);
  });

  it("every complete expansion resolves through the real command tree", () => {
    const offenders: Array<{ key: string; missingPath: string }> = [];
    for (const [key, expansion] of Object.entries(ALIASES)) {
      let parent = program;
      const resolved: string[] = [];
      for (const token of expansion) {
        const child = parent.commands.find(
          (command) => command.name() === token,
        );
        resolved.push(token);
        if (!child) {
          offenders.push({ key, missingPath: resolved.join(" ") });
          break;
        }
        parent = child;
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("applyTopLevelAliases", () => {
  it("rewrites the first positional when it matches an alias", () => {
    const result = applyTopLevelAliases([NODE, SCRIPT, "list"]);
    expect(result).toEqual([NODE, SCRIPT, "issues", "list"]);
  });

  it("passes subcommand args through unchanged after expansion", () => {
    const result = applyTopLevelAliases([NODE, SCRIPT, "dep", "tree", "TES-1"]);
    expect(result).toEqual([NODE, SCRIPT, "depends", "tree", "TES-1"]);
  });

  it("preserves `show <id>` semantics via the `read` rename", () => {
    const result = applyTopLevelAliases([NODE, SCRIPT, "show", "TES-1"]);
    expect(result).toEqual([NODE, SCRIPT, "issues", "read", "TES-1"]);
  });

  it("rewrites renamed top-levels (ready → next, defer → snooze)", () => {
    expect(applyTopLevelAliases([NODE, SCRIPT, "ready"])).toEqual([
      NODE,
      SCRIPT,
      "next",
    ]);
    expect(applyTopLevelAliases([NODE, SCRIPT, "defer", "TES-1"])).toEqual([
      NODE,
      SCRIPT,
      "snooze",
      "TES-1",
    ]);
    expect(applyTopLevelAliases([NODE, SCRIPT, "undefer", "TES-1"])).toEqual([
      NODE,
      SCRIPT,
      "wake",
      "TES-1",
    ]);
  });

  it("rewrites `link <id1> <id2>` to `depends add`, preserving --type", () => {
    expect(
      applyTopLevelAliases([NODE, SCRIPT, "link", "TES-12", "TES-7"]),
    ).toEqual([NODE, SCRIPT, "depends", "add", "TES-12", "TES-7"]);
    expect(
      applyTopLevelAliases([
        NODE,
        SCRIPT,
        "link",
        "TES-12",
        "TES-7",
        "-t",
        "related",
      ]),
    ).toEqual([
      NODE,
      SCRIPT,
      "depends",
      "add",
      "TES-12",
      "TES-7",
      "-t",
      "related",
    ]);
  });

  it("rewrites subdomain renames (label → labels)", () => {
    const result = applyTopLevelAliases([
      NODE,
      SCRIPT,
      "label",
      "add",
      "TES-1",
      "bug",
    ]);
    expect(result).toEqual([NODE, SCRIPT, "labels", "add", "TES-1", "bug"]);
  });

  it("does not rewrite when the verb is not in the alias map", () => {
    const argv = [NODE, SCRIPT, "projects", "list"];
    expect(applyTopLevelAliases(argv)).toEqual(argv);
  });

  it("does not rewrite when the verb is an existing top-level command", () => {
    const argv = [NODE, SCRIPT, "issues", "list"];
    expect(applyTopLevelAliases(argv)).toEqual(argv);
  });

  it("passes through no-arg invocations", () => {
    const argv = [NODE, SCRIPT];
    expect(applyTopLevelAliases(argv)).toEqual(argv);
  });

  it("skips leading boolean global options before the verb", () => {
    // --json is normalized to the --json=auto sentinel (see "--json
    // normalization" tests below) before alias expansion runs.
    const result = applyTopLevelAliases([NODE, SCRIPT, "--json", "list"]);
    expect(result).toEqual([NODE, SCRIPT, "--json=auto", "issues", "list"]);
  });

  it("skips leading --api-token <value> (space form) before the verb", () => {
    const result = applyTopLevelAliases([
      NODE,
      SCRIPT,
      "--api-token",
      "lin_api_xxx",
      "list",
    ]);
    expect(result).toEqual([
      NODE,
      SCRIPT,
      "--api-token",
      "lin_api_xxx",
      "issues",
      "list",
    ]);
  });

  it("handles --api-token=<value> (equals form) as a single token", () => {
    const result = applyTopLevelAliases([
      NODE,
      SCRIPT,
      "--api-token=lin_api_xxx",
      "show",
      "TES-1",
    ]);
    expect(result).toEqual([
      NODE,
      SCRIPT,
      "--api-token=lin_api_xxx",
      "issues",
      "read",
      "TES-1",
    ]);
  });

  it("passes through when only options are supplied (no positional)", () => {
    const argv = [NODE, SCRIPT, "--help"];
    expect(applyTopLevelAliases(argv)).toEqual(argv);
  });

  it("does not mutate the input argv", () => {
    const argv = [NODE, SCRIPT, "list", "--limit", "10"];
    const snapshot = [...argv];
    applyTopLevelAliases(argv);
    expect(argv).toEqual(snapshot);
  });

  it("preserves trailing arguments after the rewritten verb", () => {
    const result = applyTopLevelAliases([
      NODE,
      SCRIPT,
      "list",
      "--limit",
      "10",
      "--priority",
      "2",
    ]);
    expect(result).toEqual([
      NODE,
      SCRIPT,
      "issues",
      "list",
      "--limit",
      "10",
      "--priority",
      "2",
    ]);
  });

  it("rewrites `graph` into a two-token subdomain path", () => {
    const result = applyTopLevelAliases([NODE, SCRIPT, "graph", "TES-1"]);
    expect(result).toEqual([NODE, SCRIPT, "depends", "graph", "TES-1"]);
  });

  describe("--json normalization", () => {
    it("upgrades bare --json to --json=auto when next token is a verb", () => {
      const result = applyTopLevelAliases([
        NODE,
        SCRIPT,
        "--json",
        "issues",
        "read",
        "TES-1",
      ]);
      expect(result).toEqual([
        NODE,
        SCRIPT,
        "--json=auto",
        "issues",
        "read",
        "TES-1",
      ]);
    });

    it("leaves --json compact alone (mode value follows)", () => {
      const result = applyTopLevelAliases([
        NODE,
        SCRIPT,
        "--json",
        "compact",
        "issues",
        "read",
        "TES-1",
      ]);
      expect(result).toEqual([
        NODE,
        SCRIPT,
        "--json",
        "compact",
        "issues",
        "read",
        "TES-1",
      ]);
    });

    it("leaves --json pretty alone (mode value follows)", () => {
      const result = applyTopLevelAliases([
        NODE,
        SCRIPT,
        "--json",
        "pretty",
        "issues",
        "read",
        "TES-1",
      ]);
      expect(result).toEqual([
        NODE,
        SCRIPT,
        "--json",
        "pretty",
        "issues",
        "read",
        "TES-1",
      ]);
    });

    it("leaves --json=compact (joined) untouched", () => {
      const result = applyTopLevelAliases([
        NODE,
        SCRIPT,
        "--json=compact",
        "issues",
        "read",
      ]);
      expect(result).toEqual([
        NODE,
        SCRIPT,
        "--json=compact",
        "issues",
        "read",
      ]);
    });

    it("upgrades trailing bare --json with no following token", () => {
      const result = applyTopLevelAliases([NODE, SCRIPT, "--json"]);
      expect(result).toEqual([NODE, SCRIPT, "--json=auto"]);
    });

    it("upgrades bare --json followed by another flag", () => {
      const result = applyTopLevelAliases([
        NODE,
        SCRIPT,
        "--json",
        "--api-token",
        "x",
        "issues",
        "list",
      ]);
      expect(result).toEqual([
        NODE,
        SCRIPT,
        "--json=auto",
        "--api-token",
        "x",
        "issues",
        "list",
      ]);
    });

    it("normalizes --json before applying verb aliases", () => {
      const result = applyTopLevelAliases([NODE, SCRIPT, "--json", "list"]);
      expect(result).toEqual([NODE, SCRIPT, "--json=auto", "issues", "list"]);
    });
  });
});
