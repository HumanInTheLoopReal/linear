//
// Format tests for `linear edit`. Two result shapes from the edit
// action — no-op (user didn't change content) and changed (user saved
// new content):
//
//   changed=false → `· No change to <field> on <id>`
//   changed=true  → `✓ Updated <field> on <id> — <title>`
//
// The echo shape is designed to read naturally alongside the other
// mutation echoes (✓ icon for write, · bullet for no-op).

import { describe, expect, it } from "vitest";
import {
  type EditResultShape,
  formatEdit,
} from "../../../src/commands/edit.js";

describe("formatEdit", () => {
  it("renders a `✓ Updated` line with field, identifier, and title when changed=true", () => {
    const out = formatEdit(
      {
        id: "uuid-here",
        field: "description",
        changed: true,
        issue: { identifier: "TES-1", title: "Fix auth" },
      },
      "TES-1",
    );
    expect(out).toBe("✓ Updated description on TES-1 — Fix auth\n");
  });

  it("renders a `· No change` line when changed=false (uses the typed ref)", () => {
    const out = formatEdit(
      { id: "uuid-here", field: "description", changed: false },
      "TES-2",
    );
    expect(out).toBe("· No change to description on TES-2\n");
  });

  it("prefers the issue.identifier over the typedRef when available", () => {
    // User types a UUID; result carries the canonical identifier. Echo
    // the canonical identifier so the operator sees TES-N, not the UUID.
    const out = formatEdit(
      {
        id: "abc-uuid",
        field: "title",
        changed: true,
        issue: { identifier: "TES-9", title: "x" },
      },
      "abc-uuid",
    );
    expect(out).toContain("TES-9");
    expect(out).not.toContain("abc-uuid");
  });

  it("falls back to typedRef when issue payload is absent (no-op path)", () => {
    // The no-op path doesn't carry the issue payload — we have nothing
    // to look up the identifier from, so we echo whatever the user typed.
    const out = formatEdit(
      { id: "abc-uuid", field: "notes", changed: false },
      "TES-3",
    );
    expect(out).toContain("TES-3");
    expect(out).not.toContain("abc-uuid");
  });

  it("renders all 5 editable fields verbatim in the echo", () => {
    const fields: EditResultShape["field"][] = [
      "title",
      "description",
      "design",
      "notes",
      "acceptance",
    ];
    for (const field of fields) {
      const out = formatEdit(
        {
          id: "uuid",
          field,
          changed: true,
          issue: { identifier: "TES-1", title: "x" },
        },
        "TES-1",
      );
      expect(out).toContain(` ${field} `);
    }
  });

  it("uses · (middle-dot) for no-op so the line visually distinguishes from ✓ writes", () => {
    const out = formatEdit(
      { id: "uuid", field: "description", changed: false },
      "TES-1",
    );
    expect(out.startsWith("·")).toBe(true);
    expect(out.startsWith("✓")).toBe(false);
  });

  it("handles an empty title gracefully when changed=true", () => {
    const out = formatEdit(
      {
        id: "uuid",
        field: "title",
        changed: true,
        issue: { identifier: "TES-1", title: "" },
      },
      "TES-1",
    );
    // Trailing em-dash + space + empty title is a little ugly but
    // unambiguous; the alternative is to drop the dash, but that would
    // diverge from the close/reopen/priority echoes that always include
    // the title field.
    expect(out).toBe("✓ Updated title on TES-1 — \n");
  });

  it("ends with exactly one trailing newline", () => {
    for (const changed of [true, false]) {
      const out = formatEdit(
        {
          id: "uuid",
          field: "description",
          changed,
          issue: { identifier: "TES-1", title: "x" },
        },
        "TES-1",
      );
      expect(out.endsWith("\n")).toBe(true);
      expect(out.endsWith("\n\n")).toBe(false);
    }
  });
});
