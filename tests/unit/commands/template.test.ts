import fs from "node:fs";
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({ default: { readFileSync: vi.fn() } }));

vi.mock("../../../src/common/context.js", () => ({
  getRootOpts: vi.fn(() => ({})),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputResult: vi.fn(), outputSuccess: vi.fn() };
});

vi.mock("../../../src/common/config-store.js", () => ({
  getConfig: vi.fn(() => ({
    key: "template.create",
    value: null,
    found: false,
    source: "default",
  })),
  setConfig: vi.fn(),
  unsetConfig: vi.fn(() => true),
  readAll: vi.fn(() => ({})),
  getConfigPath: vi.fn((layer: string) => `/fake/${layer}/config.json`),
  findLocalConfigPath: vi.fn(() => "/fake/repo/.linear/config.json"),
  LocalConfigUnavailableError: class extends Error {},
}));

import {
  formatTemplateSet,
  formatTemplateShow,
  formatTemplateUnset,
  setupTemplateCommands,
  type TemplateSetResult,
  type TemplateShowResult,
  type TemplateUnsetResult,
} from "../../../src/commands/template.js";
import {
  findLocalConfigPath,
  getConfig,
  readAll,
  setConfig,
  unsetConfig,
} from "../../../src/common/config-store.js";
import { outputResult } from "../../../src/common/output.js";
import { DEFAULT_CREATE_TEMPLATE } from "../../../src/services/template-service.js";

function createProgram(): Command {
  const program = new Command();
  setupTemplateCommands(program);
  return program;
}

function lastResult<T>(): T {
  const calls = vi.mocked(outputResult).mock.calls;
  return calls[calls.length - 1][0] as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConfig).mockReturnValue({
    key: "template.create",
    value: null,
    found: false,
    source: "default",
  });
  vi.mocked(unsetConfig).mockReturnValue(true);
  vi.mocked(readAll).mockReturnValue({});
  vi.mocked(findLocalConfigPath).mockReturnValue(
    "/fake/repo/.linear/config.json",
  );
  vi.mocked(fs.readFileSync).mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

describe("formatters (lin-u70v)", () => {
  it("formatTemplateShow renders source, body, and section list", () => {
    const out = formatTemplateShow({
      source: "global",
      template: "## A\n\n<!-- a -->",
      sections: ["## A"],
      types_source: "default",
      types: [{ type: "task", sections: ["## A"], overridden: false }],
    });
    expect(out).toContain("Issue template (source: global)");
    expect(out).toContain("## A");
    expect(out).toContain("Required sections (untyped): ## A");
  });

  it("formatTemplateShow lists the effective sections per type", () => {
    const out = formatTemplateShow({
      source: "local",
      template: "## Context\n## Acceptance Criteria\n## Test Plan",
      sections: ["## Context", "## Acceptance Criteria", "## Test Plan"],
      types_source: "local",
      types: [
        {
          type: "epic",
          sections: ["## Context", "## Success Criteria", "## Test Plan"],
          overridden: false,
        },
        {
          type: "decision",
          sections: ["## Context", "## Decision"],
          overridden: true,
        },
        {
          type: "chore",
          sections: ["## Context", "## Acceptance Criteria", "## Test Plan"],
          overridden: false,
        },
        // A type whose override supplies no sections and exempts every
        // universal one — the only way to reach an empty contract, and the
        // reason the formatter has a "(none)" branch at all.
        { type: "note", sections: [], overridden: true },
      ],
    });
    expect(out).toContain("Effective sections per type (overrides: local)");
    expect(out).toMatch(/epic\s+## Context, ## Success Criteria, ## Test Plan/);
    expect(out).toMatch(/decision\s+\*\s+## Context, ## Decision/);
    expect(out).toContain("(none)");
    expect(out).toContain(
      "* overridden by template.required-sections-by-type config",
    );
  });

  it("formatTemplateSet reports the layer, path, and sections", () => {
    const out = formatTemplateSet({
      layer: "global",
      path: "/x/config.json",
      sections: ["## Context", "## Test Plan"],
    });
    expect(out).toContain("global config (/x/config.json)");
    expect(out).toContain("## Context, ## Test Plan");
  });

  it("formatTemplateUnset distinguishes removed vs nothing-to-remove", () => {
    expect(formatTemplateUnset({ layer: "global", removed: true })).toContain(
      "Removed issue template",
    );
    expect(formatTemplateUnset({ layer: "global", removed: false })).toContain(
      "No issue template set",
    );
  });
});

describe("template show", () => {
  it("shows the built-in default when nothing is configured", async () => {
    await createProgram().parseAsync(["node", "t", "template", "show"]);
    const r = lastResult<TemplateShowResult>();
    expect(r.source).toBe("default");
    expect(r.sections).toEqual([
      "## Context",
      "## Acceptance Criteria",
      "## Test Plan",
    ]);
  });

  it("shows a configured global template + its parsed sections", async () => {
    vi.mocked(getConfig).mockReturnValue({
      key: "template.create",
      value: "## Summary\n\n<!-- one line -->\n## Plan",
      found: true,
      source: "global",
    });
    await createProgram().parseAsync(["node", "t", "template", "show"]);
    const r = lastResult<TemplateShowResult>();
    expect(r.source).toBe("global");
    expect(r.sections).toEqual(["## Summary", "## Plan"]);
  });

  it("lists the effective contract for every core type", async () => {
    await createProgram().parseAsync(["node", "t", "template", "show"]);
    const r = lastResult<TemplateShowResult>();
    expect(r.types_source).toBe("default");
    const byType = Object.fromEntries(r.types.map((t) => [t.type, t.sections]));
    expect(byType.epic).toEqual([
      "## Context",
      "## Success Criteria",
      "## Test Plan",
    ]);
    expect(byType.chore).toEqual([
      "## Context",
      "## Acceptance Criteria",
      "## Test Plan",
    ]);
    expect(r.types.every((t) => t.overridden === false)).toBe(true);
  });

  it("marks a config-overridden type and shows its effective sections", async () => {
    vi.mocked(getConfig).mockImplementation((key: string) => {
      if (key === "template.required-sections-by-type") {
        return {
          key,
          value: JSON.stringify({
            decision: {
              sections: ["## Decision", "## Consequences"],
              exempt: ["## Test Plan"],
            },
          }),
          found: true,
          source: "local",
        };
      }
      return { key, value: null, found: false, source: "default" };
    });
    await createProgram().parseAsync(["node", "t", "template", "show"]);
    const r = lastResult<TemplateShowResult>();
    expect(r.types_source).toBe("local");
    const decision = r.types.find((t) => t.type === "decision");
    expect(decision).toEqual({
      type: "decision",
      sections: ["## Context", "## Decision", "## Consequences"],
      overridden: true,
    });
    // Untouched types keep their built-in block.
    expect(r.types.find((t) => t.type === "epic")?.overridden).toBe(false);
  });
});

describe("template set", () => {
  it("--from-default writes the built-in template to the global layer", async () => {
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "set",
      "--from-default",
    ]);
    expect(setConfig).toHaveBeenCalledWith(
      "template.create",
      DEFAULT_CREATE_TEMPLATE,
      { layer: "global" },
    );
    expect(lastResult<TemplateSetResult>().sections).toEqual([
      "## Context",
      "## Acceptance Criteria",
      "## Test Plan",
    ]);
  });

  it("--stdin stores the piped body and parses its headings", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("## A\n## B");
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "set",
      "--stdin",
    ]);
    expect(setConfig).toHaveBeenCalledWith("template.create", "## A\n## B", {
      layer: "global",
    });
    expect(lastResult<TemplateSetResult>().sections).toEqual(["## A", "## B"]);
  });

  it("--local writes to the per-repo layer", async () => {
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "set",
      "--from-default",
      "--local",
    ]);
    expect(setConfig).toHaveBeenCalledWith(
      "template.create",
      expect.any(String),
      { layer: "local" },
    );
  });

  it("rejects a heading-free template (would disable the gate)", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("just prose, no headings");
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "set",
      "--stdin",
    ]);
    expect(setConfig).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("requires a source", async () => {
    await createProgram().parseAsync(["node", "t", "template", "set"]);
    expect(setConfig).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("rejects two competing sources", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("## A");
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "set",
      "--stdin",
      "--from-default",
    ]);
    expect(setConfig).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("template set --type (per-type block)", () => {
  const KEY = "template.required-sections-by-type";

  it("seeds one type's block from the CLI's built-in for that type", async () => {
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "set",
      "--type",
      "decision",
      "--from-default",
    ]);
    const [key, value] = vi.mocked(setConfig).mock.calls[0];
    expect(key).toBe(KEY);
    expect(JSON.parse(value as string).decision.sections).toEqual([
      {
        heading: "## Decision",
        hint: "One sentence, imperative: what was decided",
      },
      {
        heading: "## Consequences",
        hint: "What gets easier, what gets harder, and what this defers",
      },
      {
        heading: "## Alternatives",
        hint: "Each option considered and why it was not chosen, one line each",
      },
      {
        heading: "## Revisit when",
        hint: "The concrete trigger that reopens this decision",
      },
    ]);
  });

  it("authors a block from markdown headings and hints", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      "## Checklist\n\n<!-- one line each -->\n\n## Rollback",
    );
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "set",
      "--type",
      "chore",
      "--stdin",
    ]);
    const [, value] = vi.mocked(setConfig).mock.calls[0];
    expect(JSON.parse(value as string)).toEqual({
      chore: {
        sections: [
          { heading: "## Checklist", hint: "one line each" },
          "## Rollback",
        ],
      },
    });
  });

  it("leaves every other type's block alone", async () => {
    vi.mocked(readAll).mockReturnValue({
      [KEY]: JSON.stringify({ epic: ["## Outcomes"] }),
    });
    vi.mocked(fs.readFileSync).mockReturnValue("## Checklist");
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "set",
      "--type",
      "chore",
      "--stdin",
    ]);
    const [, value] = vi.mocked(setConfig).mock.calls[0];
    expect(Object.keys(JSON.parse(value as string)).sort()).toEqual([
      "chore",
      "epic",
    ]);
  });

  it("does not touch the universal template", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("## Checklist");
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "set",
      "--type",
      "chore",
      "--stdin",
    ]);
    expect(setConfig).not.toHaveBeenCalledWith(
      "template.create",
      expect.anything(),
      expect.anything(),
    );
  });

  it("refuses --from-default for a type it has no built-in block for", async () => {
    // Seeding nothing would write "this type requires no sections", which is a
    // real contract and never what a typo meant.
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "set",
      "--type",
      "typoo",
      "--from-default",
    ]);
    expect(setConfig).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("refuses a blank --type instead of writing the universal template", async () => {
    // A blank type is a caller naming a type and failing. Falling through to
    // the untyped branch would overwrite every type's framing with one type's
    // block, which is the most destructive thing this command can do.
    vi.mocked(fs.readFileSync).mockReturnValue("## Checklist");
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "set",
      "--type",
      "   ",
      "--stdin",
    ]);
    // Both branches write through setConfig, so one assertion covers the
    // universal key and the per-type key alike.
    expect(setConfig).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("template unset --type (per-type block)", () => {
  const KEY = "template.required-sections-by-type";

  it("removes one type and keeps the rest", async () => {
    vi.mocked(readAll).mockReturnValue({
      [KEY]: JSON.stringify({ chore: ["## Checklist"], epic: ["## Outcomes"] }),
    });
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "unset",
      "--type",
      "chore",
    ]);
    const [key, value] = vi.mocked(setConfig).mock.calls[0];
    expect(key).toBe(KEY);
    expect(JSON.parse(value as string)).toEqual({
      epic: { sections: ["## Outcomes"] },
    });
    expect(lastResult<TemplateUnsetResult>().removed).toBe(true);
  });

  it("drops the whole key once its last entry goes", async () => {
    // An emptied override must leave no `{}` behind suggesting a contract
    // that is not there.
    vi.mocked(readAll).mockReturnValue({
      [KEY]: JSON.stringify({ chore: ["## Checklist"] }),
    });
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "unset",
      "--type",
      "chore",
    ]);
    expect(setConfig).not.toHaveBeenCalled();
    expect(unsetConfig).toHaveBeenCalledWith(KEY, { layer: "global" });
  });

  it("reports nothing removed when the type has no override", async () => {
    await createProgram().parseAsync([
      "node",
      "t",
      "template",
      "unset",
      "--type",
      "chore",
    ]);
    expect(lastResult<TemplateUnsetResult>().removed).toBe(false);
    expect(setConfig).not.toHaveBeenCalled();
    expect(unsetConfig).not.toHaveBeenCalled();
  });
});

describe("template unset / path", () => {
  it("unset removes the key from the global layer", async () => {
    await createProgram().parseAsync(["node", "t", "template", "unset"]);
    expect(unsetConfig).toHaveBeenCalledWith("template.create", {
      layer: "global",
    });
    expect(lastResult<TemplateUnsetResult>().removed).toBe(true);
  });

  it("unset reports when there was nothing to remove", async () => {
    vi.mocked(unsetConfig).mockReturnValue(false);
    await createProgram().parseAsync(["node", "t", "template", "unset"]);
    expect(lastResult<TemplateUnsetResult>().removed).toBe(false);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("path prints the backing config file for the layer", async () => {
    await createProgram().parseAsync(["node", "t", "template", "path"]);
    expect(lastResult<{ path: string }>().path).toBe(
      "/fake/global/config.json",
    );
  });
});
