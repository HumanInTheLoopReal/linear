//
// Format tests for the kv suite (set/get/list/clear). Each formatter
// renders a stable byte-exact shape suitable for shell scripting:
//
//   set             → `Set <key> = <value>`
//   get             → `<value>` (raw, pipeable)
//   list (empty)    → `No key-value pairs set`
//   list (populated) → blank line + `Key-Value Store:` + indented entries
//   clear           → `Cleared <key>`

import { describe, expect, it } from "vitest";
import {
  formatKvClear,
  formatKvGet,
  formatKvList,
  formatKvSet,
} from "../../../src/commands/kv.js";

describe("formatKvSet", () => {
  it("renders `Set <key> = <value>` byte-exact", () => {
    const out = formatKvSet({ key: "foo", value: "bar" });
    expect(out).toBe("Set foo = bar\n");
  });

  it("treats set and updated identically", () => {
    // Service layer reports action="set"|"updated"; the echo is the
    // same for both, so the formatter doesn't read .action.
    const first = formatKvSet({ key: "k", value: "v" });
    const second = formatKvSet({ key: "k", value: "v2" });
    expect(first.startsWith("Set ")).toBe(true);
    expect(second.startsWith("Set ")).toBe(true);
  });

  it("preserves spaces and special characters in the value", () => {
    const out = formatKvSet({ key: "msg", value: "hello world!" });
    expect(out).toBe("Set msg = hello world!\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatKvSet({ key: "k", value: "v" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatKvGet", () => {
  it("emits ONLY the value (no key, no decoration)", () => {
    // Pipeable: `VALUE=$(linear kv get foo)` style use.
    const out = formatKvGet({ value: "the stored value" });
    expect(out).toBe("the stored value\n");
  });

  it("renders empty string when value is null (defensive — action throws first)", () => {
    const out = formatKvGet({ value: null });
    expect(out).toBe("\n");
  });

  it("preserves multiline values verbatim", () => {
    const out = formatKvGet({ value: "line1\nline2" });
    expect(out).toBe("line1\nline2\n");
  });
});

describe("formatKvList", () => {
  it("renders the empty-state hint byte-exact", () => {
    expect(formatKvList({})).toBe("No key-value pairs set\n");
  });

  it("renders a leading blank line, `Key-Value Store:` header, then indented rows", () => {
    const out = formatKvList({ foo: "bar", baz: "qux" });
    expect(out.startsWith("\nKey-Value Store:\n")).toBe(true);
    expect(out).toContain("  foo = bar\n");
    expect(out).toContain("  baz = qux\n");
  });

  it("uses ` = ` (spaces around equals)", () => {
    const out = formatKvList({ k: "v" });
    expect(out).toContain("  k = v\n");
  });

  it("preserves caller key ordering (service sorts before calling)", () => {
    // Service already calls Object.keys.sort(); formatter must not re-sort.
    const out = formatKvList({ b: "b val", a: "a val" });
    const bIdx = out.indexOf("  b = ");
    const aIdx = out.indexOf("  a = ");
    expect(bIdx).toBeLessThan(aIdx);
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatKvList({ k: "v" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatKvClear", () => {
  it("renders `Cleared <key>` byte-exact", () => {
    expect(formatKvClear({ key: "foo" })).toBe("Cleared foo\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatKvClear({ key: "k" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
