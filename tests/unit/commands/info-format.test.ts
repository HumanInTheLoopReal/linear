//
// Format tests for `linear info`. Section layout —
// top-line banner + Workspace + Viewer + Counts + optional What's new
// + Errors.

import { describe, expect, it } from "vitest";
import { formatInfo } from "../../../src/commands/info.js";

describe("formatInfo", () => {
  function makeResult(
    overrides: Partial<Parameters<typeof formatInfo>[0]> = {},
  ) {
    return {
      cli_version: "2026.4.9",
      platform: { key: "linear" },
      workspace: { name: "Acme Inc", url_key: "acme" },
      viewer: { name: "Alex Doe", email: "alex@acme.com" },
      counts: { open: 42, open_saturated: false },
      ...overrides,
    };
  }

  it("renders the top banner with version + platform", () => {
    const out = formatInfo(makeResult());
    expect(out.startsWith("linear 2026.4.9  (linear)\n")).toBe(true);
  });

  it("renders Workspace block with Name + URL", () => {
    const out = formatInfo(makeResult());
    expect(out).toContain("Workspace:\n");
    expect(out).toContain("  Name: Acme Inc\n");
    expect(out).toContain("  URL:  https://linear.app/acme\n");
  });

  it("renders Workspace placeholder when unresolved", () => {
    const out = formatInfo(makeResult({ workspace: null }));
    expect(out).toContain("  (unresolved — check auth)\n");
  });

  it("renders Viewer block with name + email", () => {
    const out = formatInfo(makeResult());
    expect(out).toContain("Viewer:\n");
    expect(out).toContain("  Alex Doe <alex@acme.com>\n");
  });

  it("renders Viewer placeholder when unresolved", () => {
    const out = formatInfo(makeResult({ viewer: null }));
    expect(out).toContain("Viewer:\n  (unresolved)\n");
  });

  it("renders the open issue count", () => {
    const out = formatInfo(makeResult());
    expect(out).toContain("Counts:\n  Open issues: 42\n");
  });

  it("appends + when open count saturates the pagination guard", () => {
    const out = formatInfo(
      makeResult({ counts: { open: 1000, open_saturated: true } }),
    );
    expect(out).toContain("Open issues: 1000+\n");
  });

  it("renders What's new block when present, preserving newlines", () => {
    const out = formatInfo(
      makeResult({ whats_new: "Notable items:\n  • cycles ported" }),
    );
    expect(out).toContain("What's new:\n");
    expect(out).toContain("  Notable items:\n");
    expect(out).toContain("    • cycles ported\n");
  });

  it("omits What's new when undefined", () => {
    const out = formatInfo(makeResult());
    expect(out).not.toContain("What's new:");
  });

  it("renders Errors block when errors[] is non-empty", () => {
    const out = formatInfo(
      makeResult({ errors: ["viewer query failed", "counts timeout"] }),
    );
    expect(out).toContain("Errors (2):\n");
    expect(out).toContain("  ⚠ viewer query failed\n");
    expect(out).toContain("  ⚠ counts timeout\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatInfo(makeResult());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
