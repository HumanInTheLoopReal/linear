//
// Format tests for `users list`. Format:
//
//   empty       → `No users found.`
//   populated   → `  <email-padded>  <name>  [active|inactive]` rows
//                  + blank line + `Total: N users`

import { describe, expect, it } from "vitest";
import { formatUserList } from "../../../src/commands/users.js";

describe("formatUserList", () => {
  it("renders the empty-state hint", () => {
    expect(formatUserList({ nodes: [] })).toBe("No users found.\n");
  });

  it("renders one row per user with email, name, state", () => {
    const out = formatUserList({
      nodes: [
        { id: "u-1", email: "alice@example.com", name: "Alice", active: true },
      ],
    });
    expect(out).toContain("  alice@example.com  Alice  [active]\n");
  });

  it("uses [inactive] for users with active=false", () => {
    const out = formatUserList({
      nodes: [
        { id: "u-1", email: "bob@example.com", name: "Bob", active: false },
      ],
    });
    expect(out).toContain("  bob@example.com  Bob  [inactive]\n");
  });

  it("treats null/undefined active as inactive", () => {
    const out = formatUserList({
      nodes: [
        { id: "u-1", email: "x@example.com", name: "X", active: null },
        { id: "u-2", email: "y@example.com", name: "Y" },
      ],
    });
    expect(out).toContain("[inactive]");
    expect(out).not.toContain("[active]");
  });

  it("pads emails to a common column width so name/state align", () => {
    const out = formatUserList({
      nodes: [
        { id: "u-1", email: "a@x.io", name: "A", active: true }, // 6 chars
        { id: "u-2", email: "longername@example.com", name: "B", active: true }, // 22
      ],
    });
    // Both rows should have name beginning at the same column.
    const lines = out.split("\n").filter((l) => l.startsWith("  "));
    const aPosA = lines[0].indexOf("A", 2);
    const bPosB = lines[1].indexOf("B", 2);
    expect(aPosA).toBe(bPosB);
  });

  it("falls back to (no email) / (no name) when fields are missing", () => {
    const out = formatUserList({
      nodes: [{ id: "u-1", email: null, name: null, active: true }],
    });
    expect(out).toContain("(no email)");
    expect(out).toContain("(no name)");
  });

  it("appends `Total: N users` footer with a blank-line separator", () => {
    const out = formatUserList({
      nodes: [
        { id: "u-1", email: "a@x.io", name: "A", active: true },
        { id: "u-2", email: "b@x.io", name: "B", active: false },
      ],
    });
    expect(out).toContain("\nTotal: 2 users\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatUserList({
      nodes: [{ id: "u-1", email: "a@x.io", name: "A", active: true }],
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
