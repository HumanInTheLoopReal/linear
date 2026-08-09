//
// Format tests for the config suite (get/set/unset/set-many/list/show).
// Each formatter renders a stable byte-exact shape:
//
//   get             → `<value>` (raw, pipeable)
//   set             → `Set <key> = <value>`
//   unset           → `Unset <key>`
//   set-many        → one `Set <k> = <v>` line per pair
//   list (empty)    → `No configuration set`
//   list (populated) → blank line + `Configuration:` + indented rows + tip
//   show (empty)    → `No configuration set`
//   show (populated) → aligned key/value/source columns

import { describe, expect, it } from "vitest";
import {
  formatConfigGet,
  formatConfigList,
  formatConfigSet,
  formatConfigSetMany,
  formatConfigShow,
  formatConfigUnset,
} from "../../../src/commands/config.js";

describe("formatConfigGet", () => {
  it("emits ONLY the value (no key, no decoration)", () => {
    // Pipeable: `VAL=$(linear config get linear.endpoint)` style use.
    const out = formatConfigGet({ value: "https://api.linear.app/graphql" });
    expect(out).toBe("https://api.linear.app/graphql\n");
  });

  it("emits empty string when value is null (defensive — action throws first)", () => {
    const out = formatConfigGet({ value: null });
    expect(out).toBe("\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatConfigGet({ value: "x" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatConfigSet", () => {
  it("renders `Set <key> = <value>` byte-exact", () => {
    const out = formatConfigSet({
      key: "linear.endpoint",
      value: "https://api.linear.app/graphql",
    });
    expect(out).toBe("Set linear.endpoint = https://api.linear.app/graphql\n");
  });

  it("preserves spaces and special characters in the value", () => {
    const out = formatConfigSet({ key: "msg", value: "hello world!" });
    expect(out).toBe("Set msg = hello world!\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatConfigSet({ key: "k", value: "v" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatConfigUnset", () => {
  it("renders `Unset <key>` byte-exact", () => {
    expect(formatConfigUnset({ key: "linear.endpoint" })).toBe(
      "Unset linear.endpoint\n",
    );
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatConfigUnset({ key: "k" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatConfigSetMany", () => {
  it("renders one `Set <k> = <v>` line per pair", () => {
    const out = formatConfigSetMany({
      set: [
        { key: "a", value: "1" },
        { key: "b", value: "2" },
        { key: "c", value: "3" },
      ],
    });
    expect(out).toBe("Set a = 1\nSet b = 2\nSet c = 3\n");
  });

  it("returns empty string for an empty pair list", () => {
    expect(formatConfigSetMany({ set: [] })).toBe("");
  });

  it("ends with exactly one trailing newline when populated", () => {
    const out = formatConfigSetMany({ set: [{ key: "k", value: "v" }] });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatConfigList", () => {
  it("renders the empty-state hint", () => {
    expect(formatConfigList({})).toBe("No configuration set\n");
  });

  it("renders leading blank line + `Configuration:` header + indented rows + tip", () => {
    const out = formatConfigList({ "linear.endpoint": "https://x", k: "v" });
    expect(out.startsWith("\nConfiguration:\n")).toBe(true);
    expect(out).toContain("  linear.endpoint = https://x\n");
    expect(out).toContain("  k = v\n");
    expect(out).toContain(
      "Tip: Run 'linear config show' for all effective config with provenance.\n",
    );
  });

  it("uses ` = ` (spaces around equals)", () => {
    const out = formatConfigList({ k: "v" });
    expect(out).toContain("  k = v\n");
  });

  it("preserves caller key ordering (service sorts before calling)", () => {
    const out = formatConfigList({ b: "b val", a: "a val" });
    const bIdx = out.indexOf("  b = ");
    const aIdx = out.indexOf("  a = ");
    expect(bIdx).toBeLessThan(aIdx);
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatConfigList({ k: "v" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatConfigShow", () => {
  it("renders the empty-state hint", () => {
    expect(formatConfigShow([])).toBe("No configuration set\n");
  });

  it("renders aligned 3-column rows with source in parens", () => {
    const out = formatConfigShow([
      {
        key: "linear.endpoint",
        value: "https://api.linear.app",
        source: "global",
      },
      { key: "team.default", value: "TES", source: "env" },
    ]);
    // 2-space indent; key padded to 41 chars; `= ` separator; value padded to
    // 38 chars; `(source)`. Then newline per row.
    expect(out).toContain(
      "  linear.endpoint                          = https://api.linear.app                (global)\n",
    );
    expect(out).toContain(
      "  team.default                             = TES                                   (env)\n",
    );
  });

  it("tolerates a null value by rendering an empty cell", () => {
    const out = formatConfigShow([
      { key: "k", value: null as unknown as string, source: "default" },
    ]);
    expect(out).toContain(
      "  k                                        =                                       (default)\n",
    );
  });

  it("preserves caller row ordering (service sorts before calling)", () => {
    const out = formatConfigShow([
      { key: "b", value: "y", source: "global" },
      { key: "a", value: "x", source: "global" },
    ]);
    const bIdx = out.indexOf("  b");
    const aIdx = out.indexOf("  a");
    expect(bIdx).toBeLessThan(aIdx);
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatConfigShow([{ key: "k", value: "v", source: "global" }]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
