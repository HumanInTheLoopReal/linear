//
// Format tests for the linear memory suite (remember/recall/list/forget).
// Each echo renders a stable byte-exact shape:
//
//   remember (new)     → `Remembered [<key>]: <value>`
//   remember (upsert)  → `Updated [<key>]: <value>`
//   recall             → `<value>` (raw, no decoration — pipeable)
//   list (empty)       → `No memories stored. Use 'linear remember "insight"' to add one.`
//   list (populated)   → `Memories (N):\n\n  <key>\n    <value>\n\n` per entry
//   forget             → `Forgot [<key>]: <value>`

import { describe, expect, it } from "vitest";
import {
  formatMemoryForget,
  formatMemoryList,
  formatMemoryRecall,
  formatMemoryRemember,
} from "../../../src/commands/memory.js";

describe("formatMemoryRemember", () => {
  it("uses 'Remembered' verb on first write", () => {
    const out = formatMemoryRemember({
      key: "scratch",
      value: "test value",
      action: "remembered",
    });
    expect(out).toBe("Remembered [scratch]: test value\n");
  });

  it("uses 'Updated' verb on upsert", () => {
    const out = formatMemoryRemember({
      key: "scratch",
      value: "new value",
      action: "updated",
    });
    expect(out).toBe("Updated [scratch]: new value\n");
  });

  it("wraps the key in straight square brackets (no smart quotes)", () => {
    const out = formatMemoryRemember({
      key: "x",
      value: "y",
      action: "remembered",
    });
    expect(out).toContain("[x]");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatMemoryRemember({
      key: "k",
      value: "v",
      action: "remembered",
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatMemoryRecall", () => {
  it("emits ONLY the value (no key, no decoration)", () => {
    // Recall is pipeable. Adding any prefix breaks
    // `linear recall agent-rules | xargs ...` style usage.
    const out = formatMemoryRecall({ value: "the stored insight" });
    expect(out).toBe("the stored insight\n");
  });

  it("preserves multiline values verbatim", () => {
    const out = formatMemoryRecall({ value: "line1\nline2\nline3" });
    expect(out).toBe("line1\nline2\nline3\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatMemoryRecall({ value: "x" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatMemoryList", () => {
  it("renders the empty-state hint pointing at `linear remember`", () => {
    const out = formatMemoryList({});
    expect(out).toBe(
      "No memories stored. Use 'linear remember \"insight\"' to add one.\n",
    );
  });

  it("renders `Memories (N):` header followed by blank line + indented entries", () => {
    const out = formatMemoryList({
      first: "first value",
      second: "second value",
    });
    expect(out.startsWith("Memories (2):\n\n")).toBe(true);
    expect(out).toContain("  first\n    first value\n");
    expect(out).toContain("  second\n    second value\n");
  });

  it("uses two-space key indent + four-space value indent", () => {
    const out = formatMemoryList({ k: "v" });
    expect(out).toContain("  k\n    v\n");
  });

  it("preserves caller key ordering (action sorts before calling)", () => {
    // The action layer sorts before calling, so the formatter must not
    // re-sort — and it must not assume any particular order.
    const out = formatMemoryList({ b: "b val", a: "a val" });
    const bIdx = out.indexOf("  b\n");
    const aIdx = out.indexOf("  a\n");
    expect(bIdx).toBeLessThan(aIdx);
  });

  it("ends with exactly one trailing newline (even in populated case)", () => {
    const out = formatMemoryList({ k: "v" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n\n")).toBe(false);
  });
});

describe("formatMemoryForget", () => {
  it("renders `Forgot [<key>]: <value>` byte-exact", () => {
    const out = formatMemoryForget({ key: "scratch", value: "test value" });
    expect(out).toBe("Forgot [scratch]: test value\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatMemoryForget({ key: "k", value: "v" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
