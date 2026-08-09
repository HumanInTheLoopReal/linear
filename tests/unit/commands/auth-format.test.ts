//
// Format tests for `linear auth status` and `linear auth logout`. The
// echoes are simple single-line confirmations:
//
//   status authenticated   → `✓ Authenticated as <name> (<email>) via <source>`
//   status unauthenticated → `✗ <message>`
//   logout clean           → `✓ Authentication token removed.`
//   logout warning         → `✓ Authentication token removed.\n⚠ <warning>`
//
// `linear auth login` is not formatted here — it's an interactive flow
// that streams progress to stderr directly via console.error, not via
// outputResult. Tests for `login` live in tests/unit/commands/auth.test.ts.

import { describe, expect, it } from "vitest";
import {
  formatAuthLogout,
  formatAuthStatus,
} from "../../../src/commands/auth.js";

describe("formatAuthStatus", () => {
  it("renders ✓ Authenticated line with name, email, and source", () => {
    const out = formatAuthStatus({
      authenticated: true,
      source: "~/linear/token",
      user: { id: "u", name: "Fahad", email: "f@example.com" },
    });
    expect(out).toBe(
      "✓ Authenticated as Fahad (f@example.com) via ~/linear/token\n",
    );
  });

  it("omits the `via <source>` suffix when source is absent", () => {
    const out = formatAuthStatus({
      authenticated: true,
      user: { id: "u", name: "Fahad", email: "f@example.com" },
    });
    expect(out).toBe("✓ Authenticated as Fahad (f@example.com)\n");
  });

  it("renders ✗ + message when authenticated=false (no token found)", () => {
    const out = formatAuthStatus({
      authenticated: false,
      message: "No API token found. Run 'linear auth login' to authenticate.",
    });
    expect(out).toBe(
      "✗ No API token found. Run 'linear auth login' to authenticate.\n",
    );
  });

  it("renders ✗ + message when token exists but failed validation", () => {
    const out = formatAuthStatus({
      authenticated: false,
      source: "LINEAR_API_TOKEN env var",
      message:
        "Token is invalid or expired. Run 'linear auth login' to reauthenticate.",
    });
    expect(out).toContain("✗");
    expect(out).toContain("invalid or expired");
  });

  it("falls back to 'Not authenticated.' when no message provided (defensive)", () => {
    const out = formatAuthStatus({ authenticated: false });
    expect(out).toBe("✗ Not authenticated.\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatAuthStatus({
      authenticated: true,
      source: "x",
      user: { id: "u", name: "n", email: "e" },
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatAuthLogout", () => {
  it("renders a single ✓ line when no other token source remains", () => {
    const out = formatAuthLogout({ message: "Authentication token removed." });
    expect(out).toBe("✓ Authentication token removed.\n");
  });

  it("appends a ⚠ warning line when another source is still active", () => {
    const out = formatAuthLogout({
      message: "Authentication token removed.",
      warning: "A token is still active via LINEAR_API_TOKEN env var.",
    });
    expect(out).toBe(
      "✓ Authentication token removed.\n⚠ A token is still active via LINEAR_API_TOKEN env var.\n",
    );
  });

  it("ends with exactly one trailing newline whether warning is present or not", () => {
    for (const result of [{ message: "x" }, { message: "x", warning: "y" }]) {
      const out = formatAuthLogout(result);
      expect(out.endsWith("\n")).toBe(true);
      expect(out.endsWith("\n\n")).toBe(false);
    }
  });
});
