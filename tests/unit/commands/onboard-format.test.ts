//
// Format tests for `linear onboard`. Text-default in linear (was JSON-default,
// flipped under lin-zxgm). The text output wraps the snippet in paste markers
// + a how-it-works footer.

import { describe, expect, it } from "vitest";
import { formatOnboard } from "../../../src/commands/onboard.js";

describe("formatOnboard", () => {
  function makeResult() {
    return { snippet: "## Issue Tracking\n\nUse linear.\n" };
  }

  it("renders the linear onboarding header", () => {
    const out = formatOnboard(makeResult());
    expect(out.startsWith("linear onboarding\n")).toBe(true);
  });

  it("wraps the snippet in paste markers", () => {
    const out = formatOnboard(makeResult());
    expect(out).toContain("--- BEGIN AGENTS.MD CONTENT ---\n");
    expect(out).toContain("## Issue Tracking");
    expect(out).toContain("Use linear.");
    expect(out).toContain("--- END AGENTS.MD CONTENT ---\n");
  });

  it("includes the GitHub Copilot pointer", () => {
    const out = formatOnboard(makeResult());
    expect(out).toContain(".github/copilot-instructions.md");
  });

  it("includes the how-it-works footer", () => {
    const out = formatOnboard(makeResult());
    expect(out).toContain("How it works:\n");
    expect(out).toContain("linear prime provides dynamic workflow context");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatOnboard(makeResult());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
