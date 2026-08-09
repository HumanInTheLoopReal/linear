import { describe, expect, it } from "vitest";
import {
  CURSOR_TEMPLATE,
  WORKFLOW_BODY,
  WORKFLOW_BODY_MINIMAL,
} from "../../../src/templates/workflow.js";

describe("workflow templates", () => {
  describe("WORKFLOW_BODY (full variant)", () => {
    it("includes the BEGIN/END managed-block markers", () => {
      expect(WORKFLOW_BODY).toContain("# BEGIN LINEAR INTEGRATION");
      expect(WORKFLOW_BODY).toContain("# END LINEAR INTEGRATION");
    });

    it("references `linear` (not legacy product names)", () => {
      // Regression guard: WORKFLOW_BODY should never re-introduce
      // legacy product names. The patterns are spelled out via
      // String.fromCharCode so this file itself stays free of those
      // substrings.
      const legacyShort = String.fromCharCode(98, 100); // "b" + "d"
      const legacyLong =
        String.fromCharCode(108, 105, 110, 101, 97, 114) +
        String.fromCharCode(105, 115); // "linear" + "is"
      expect(WORKFLOW_BODY).toMatch(/\blinear\b/);
      expect(WORKFLOW_BODY).not.toMatch(new RegExp(`\\b${legacyShort}\\b`));
      expect(WORKFLOW_BODY).not.toContain(legacyLong);
    });

    it("includes the inline command reference (full variant)", () => {
      expect(WORKFLOW_BODY).toContain("linear next");
      expect(WORKFLOW_BODY).toContain("linear issues create");
      expect(WORKFLOW_BODY).toContain("linear depends add");
    });

    it("steers Claude Code users at the plugin bundle", () => {
      expect(WORKFLOW_BODY).toContain("/plugin install linear");
    });

    it("points at `linear prime` for context loading", () => {
      expect(WORKFLOW_BODY).toContain("linear prime");
    });
  });

  describe("WORKFLOW_BODY_MINIMAL (pointer variant)", () => {
    it("includes the BEGIN/END managed-block markers", () => {
      expect(WORKFLOW_BODY_MINIMAL).toContain("# BEGIN LINEAR INTEGRATION");
      expect(WORKFLOW_BODY_MINIMAL).toContain("# END LINEAR INTEGRATION");
    });

    it("points at the plugin install + `linear prime`", () => {
      expect(WORKFLOW_BODY_MINIMAL).toContain("/plugin install linear");
      expect(WORKFLOW_BODY_MINIMAL).toContain("linear prime");
    });

    it("is shorter than the full variant", () => {
      // Pointer variants must stay terse — they exist precisely to avoid
      // duplicating the full command reference in hosts that have their
      // own discovery surface.
      expect(WORKFLOW_BODY_MINIMAL.length).toBeLessThan(WORKFLOW_BODY.length);
    });

    it("does not embed the full command reference list", () => {
      // The full reference includes `linear depends add`, `--assignee me`,
      // etc. Minimal should not.
      expect(WORKFLOW_BODY_MINIMAL).not.toContain("linear depends add");
      expect(WORKFLOW_BODY_MINIMAL).not.toContain("--assignee me");
    });
  });

  describe("CURSOR_TEMPLATE", () => {
    it("prepends `alwaysApply: true` front-matter", () => {
      expect(CURSOR_TEMPLATE).toMatch(/^---\nalwaysApply: true\n---\n/);
    });

    it("embeds the full WORKFLOW_BODY", () => {
      expect(CURSOR_TEMPLATE).toContain(WORKFLOW_BODY);
    });
  });
});
