//
// Format tests for `linear rules audit`. Local-only — no Linear API.
// Shape: summary header + per-finding blocks.
//
//   audit (clean)   → summary + `✓ No contradictions or merge candidates found.`
//   audit (issues)  → summary + `Contradictions (N):` + `Merge candidates (N):`

import { describe, expect, it } from "vitest";
import { formatRulesAudit } from "../../../src/commands/rules.js";

describe("formatRulesAudit", () => {
  function makeResult(
    overrides: Partial<Parameters<typeof formatRulesAudit>[0]> = {},
  ) {
    return {
      total_rules: 12,
      token_estimate: 3450,
      contradictions: [],
      merge_candidates: [],
      ...overrides,
    };
  }

  it("renders the summary header with locale-formatted token count", () => {
    const out = formatRulesAudit(makeResult());
    expect(out).toContain("📋 Rules audit:\n");
    expect(out).toContain("  Total rules:    12\n");
    expect(out).toContain("  Token estimate: 3,450\n");
  });

  it("renders the clean-pass message when both lists are empty", () => {
    const out = formatRulesAudit(makeResult());
    expect(out).toContain("✓ No contradictions or merge candidates found.\n");
  });

  it("renders Contradictions section with per-finding block", () => {
    const out = formatRulesAudit(
      makeResult({
        contradictions: [
          {
            rule_a: "auth-flow.md",
            rule_b: "session-tokens.md",
            tension: "session-storage policy",
            do_line_a: "Always rotate tokens on login",
            dont_line_b: "Never invalidate active sessions",
            scope_score: 0.75,
          },
        ],
      }),
    );
    expect(out).toContain("Contradictions (1):\n");
    expect(out).toContain(
      "  ⚠ auth-flow.md vs session-tokens.md  (scope 0.75)\n",
    );
    expect(out).toContain("    DO   : Always rotate tokens on login\n");
    expect(out).toContain("    DON'T: Never invalidate active sessions\n");
    expect(out).toContain("    tension: session-storage policy\n");
  });

  it("omits tension line when empty string", () => {
    const out = formatRulesAudit(
      makeResult({
        contradictions: [
          {
            rule_a: "a.md",
            rule_b: "b.md",
            tension: "",
            do_line_a: "Do X",
            dont_line_b: "Don't X",
            scope_score: 0.5,
          },
        ],
      }),
    );
    expect(out).not.toContain("tension:");
  });

  it("renders Merge candidates section with rules list", () => {
    const out = formatRulesAudit(
      makeResult({
        merge_candidates: [
          {
            group_label: "auth",
            rules: ["a.md", "b.md", "c.md"],
            score: 0.72,
          },
        ],
      }),
    );
    expect(out).toContain("Merge candidates (1):\n");
    expect(out).toContain("  ◇ auth  (score 0.72)\n");
    expect(out).toContain("    rules: a.md, b.md, c.md\n");
  });

  it("renders both sections together when both have entries", () => {
    const out = formatRulesAudit(
      makeResult({
        contradictions: [
          {
            rule_a: "a.md",
            rule_b: "b.md",
            tension: "x",
            do_line_a: "Do",
            dont_line_b: "Don't",
            scope_score: 0.6,
          },
        ],
        merge_candidates: [
          { group_label: "g", rules: ["a.md", "b.md"], score: 0.8 },
        ],
      }),
    );
    expect(out).toContain("Contradictions (1):\n");
    expect(out).toContain("Merge candidates (1):\n");
    expect(out).not.toContain("No contradictions");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatRulesAudit(makeResult());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
