//
// Format tests for `linear todo list`. Renders a flat (no-tree) list,
// two-space indent, padded id + title columns, priority chip after the
// title, then state.name. Footer: "Total: N TODOs".

import { describe, expect, it } from "vitest";
import { formatTodoList } from "../../../src/commands/todo.js";

type Row = {
  identifier: string;
  title: string;
  priority: number;
  state: { type: string; name: string };
};

function row(o: Partial<Row> = {}): Row {
  return {
    identifier: "TES-1",
    title: "todo",
    priority: 2,
    state: { type: "backlog", name: "Backlog" },
    ...o,
  };
}

describe("formatTodoList", () => {
  it("renders the empty case with the 'No TODOs found.' banner", () => {
    expect(formatTodoList([])).toBe("\nNo TODOs found.\n\n");
  });

  it("renders one row per todo with status icon, padded id, padded title, priority, state.name", () => {
    const out = formatTodoList([
      row({ identifier: "TES-1", title: "first", priority: 2 }),
      row({ identifier: "TES-2", title: "second", priority: 3 }),
    ]);
    const lines = out.split("\n");
    expect(lines[0]).toBe("  ○ TES-1  first   ● P2  Backlog");
    expect(lines[1]).toBe("  ○ TES-2  second  ● P3  Backlog");
  });

  it("uses statusIcon — ◐ for started, ✓ for completed", () => {
    const out = formatTodoList([
      row({
        identifier: "TES-3",
        state: { type: "started", name: "In Progress" },
      }),
      row({
        identifier: "TES-4",
        state: { type: "completed", name: "Done" },
      }),
    ]);
    expect(out).toContain("  ◐ TES-3");
    expect(out).toContain("  ✓ TES-4");
  });

  it("renders state.name (Linear workspace state), not the type token", () => {
    const out = formatTodoList([
      row({ state: { type: "started", name: "In Review" } }),
    ]);
    expect(out).toContain("In Review");
    expect(out).not.toContain("started");
  });

  it("omits the priority chip (just blank padding) when priority is 0", () => {
    const out = formatTodoList([
      row({ identifier: "TES-5", priority: 0, title: "untriaged" }),
    ]);
    const line = out.split("\n")[0];
    expect(line).toContain("  ○ TES-5");
    // No `●` priority bullet when priority is 0; the two-space pad in its
    // place keeps the state column aligned with priority-bearing rows.
    expect(line).not.toContain("●");
  });

  it("appends a footer `Total: N TODOs` with one blank line above it", () => {
    const out = formatTodoList([row({}), row({ identifier: "TES-9" })]);
    const lines = out.split("\n");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe("Total: 2 TODOs");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatTodoList([row({})]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("preserves caller order (the service sorts by priority+identifier)", () => {
    const out = formatTodoList([
      row({ identifier: "TES-9", priority: 1 }),
      row({ identifier: "TES-1", priority: 1 }),
    ]);
    const lines = out.split("\n");
    expect(lines[0]).toContain("TES-9");
    expect(lines[1]).toContain("TES-1");
  });
});
