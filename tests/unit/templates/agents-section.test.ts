//
// Unit tests for AGENTS.md managed-block rendering. Covers:
//   - profile body selection (minimal vs full)
//   - marker parsing (versioned, legacy unversioned, malformed)
//   - upsert outcomes (created/appended/replaced/current/preserved)
//   - profile-preservation rule (full + minimal request → full preserved)

import { describe, expect, it } from "vitest";
import {
  AGENTS_MARKER_VERSION,
  computeHash,
  currentHash,
  findSection,
  parseMarker,
  profileBody,
  renderSection,
  upsertSection,
} from "../../../src/templates/agents-section.js";

describe("profileBody", () => {
  it("minimal profile body is the pointer template", () => {
    const body = profileBody("minimal");
    expect(body).toContain("Linear Issue Tracker");
    expect(body).toContain("linear prime");
  });

  it("full profile body inlines the command reference", () => {
    const body = profileBody("full");
    expect(body).toContain("Issue Tracking with linear");
    expect(body).toContain("linear next");
    expect(body).toContain("linear depends add");
  });

  it("hash is stable for unchanged body", () => {
    expect(computeHash("hello")).toBe(computeHash("hello"));
  });

  it("hash differs across profiles", () => {
    expect(currentHash("minimal")).not.toBe(currentHash("full"));
  });
});

describe("renderSection / parseMarker", () => {
  it("renders a section with v: profile: hash: marker", () => {
    const rendered = renderSection("minimal");
    expect(rendered.startsWith("<!-- BEGIN LINEAR INTEGRATION v:")).toBe(true);
    expect(rendered.endsWith("<!-- END LINEAR INTEGRATION -->\n")).toBe(true);
    expect(rendered).toContain(`v:${AGENTS_MARKER_VERSION}`);
    expect(rendered).toContain("profile:minimal");
  });

  it("parseMarker extracts version, profile, and hash", () => {
    const line =
      "<!-- BEGIN LINEAR INTEGRATION v:1 profile:full hash:abc12345 -->";
    const meta = parseMarker(line);
    expect(meta).toEqual({ version: 1, profile: "full", hash: "abc12345" });
  });

  it("parseMarker returns empty meta for legacy unversioned marker", () => {
    const meta = parseMarker("<!-- BEGIN LINEAR INTEGRATION -->");
    expect(meta).toEqual({});
  });

  it("parseMarker returns null for non-marker lines", () => {
    expect(parseMarker("# hello")).toBeNull();
    expect(parseMarker("<!-- BEGIN OTHER INTEGRATION -->")).toBeNull();
  });
});

describe("findSection", () => {
  it("returns null when no section is present", () => {
    expect(findSection("# my agents file\n")).toBeNull();
  });

  it("locates BEGIN/END bounds", () => {
    const content = `# preamble
<!-- BEGIN LINEAR INTEGRATION v:1 profile:minimal hash:abc -->
body
<!-- END LINEAR INTEGRATION -->
# trailing
`;
    const bounds = findSection(content);
    expect(bounds).not.toBeNull();
    expect(content.slice(bounds!.begin, bounds!.end)).toContain("body");
  });
});

describe("upsertSection", () => {
  it("creates a fresh file when content is null", () => {
    const r = upsertSection(null, "minimal");
    expect(r.action).toBe("created");
    expect(r.profile).toBe("minimal");
    expect(r.next).toContain("BEGIN LINEAR INTEGRATION");
  });

  it("appends to a file without our markers", () => {
    const r = upsertSection("# my existing agents file\n", "minimal");
    expect(r.action).toBe("appended");
    expect(r.next.startsWith("# my existing agents file\n")).toBe(true);
    expect(r.next).toContain("BEGIN LINEAR INTEGRATION");
  });

  it("reports current when content is already up to date", () => {
    const fresh = renderSection("minimal");
    const r = upsertSection(fresh, "minimal");
    expect(r.action).toBe("current");
    expect(r.next).toBe(fresh);
  });

  it("replaces a stale block (different hash)", () => {
    const stale =
      "<!-- BEGIN LINEAR INTEGRATION v:1 profile:minimal hash:deadbeef -->\nold body\n<!-- END LINEAR INTEGRATION -->\n";
    const r = upsertSection(stale, "minimal");
    expect(r.action).toBe("replaced");
    expect(r.next).toContain(`hash:${currentHash("minimal")}`);
    expect(r.next).not.toContain("old body");
  });

  it("preserves full profile across minimal re-run (no information loss)", () => {
    const full = renderSection("full");
    const r = upsertSection(full, "minimal");
    expect(r.profile).toBe("full");
    // Already current with full body → "current" since effective profile
    // unchanged AND hash matches.
    expect(["current", "preserved"]).toContain(r.action);
    expect(r.next).toContain("profile:full");
    expect(r.next).not.toContain("profile:minimal");
  });

  it("upgrades minimal block to full when full is explicitly requested", () => {
    const minimal = renderSection("minimal");
    const r = upsertSection(minimal, "full");
    expect(r.action).toBe("replaced");
    expect(r.profile).toBe("full");
    expect(r.next).toContain("profile:full");
  });
});
