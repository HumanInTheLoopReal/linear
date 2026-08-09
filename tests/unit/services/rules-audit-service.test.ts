import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectContradictions,
  extractKeywords,
  findMergeCandidates,
  jaccardSimilarity,
  parseRuleFile,
  runRulesAudit,
} from "../../../src/services/rules-audit-service.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "linear-rules-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeRule(name: string, body: string): string {
  const fp = path.join(tmp, `${name}.md`);
  fs.writeFileSync(fp, body);
  return fp;
}

describe("extractKeywords", () => {
  it("lowercases, drops stop words and short tokens, dedupes, sorts", () => {
    const kws = extractKeywords([
      "Always block parallel work",
      "block and proceed are antonyms",
    ]);
    expect(kws).toEqual(["antonyms", "block", "parallel", "proceed", "work"]);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 0 for two empty sets", () => {
    expect(jaccardSimilarity([], [])).toBe(0);
  });
  it("returns 1 for identical sets", () => {
    expect(jaccardSimilarity(["a", "b"], ["a", "b"])).toBe(1);
  });
  it("computes |A ∩ B| / |A ∪ B|", () => {
    // {a,b,c} vs {b,c,d} → intersection={b,c}=2, union={a,b,c,d}=4 → 0.5
    expect(jaccardSimilarity(["a", "b", "c"], ["b", "c", "d"])).toBe(0.5);
  });
});

describe("parseRuleFile", () => {
  it("extracts title, do/dont lines, keywords, and token estimate", () => {
    const fp = writeRule(
      "test-rule",
      [
        "# Test Rule",
        "",
        "Some intro text.",
        "",
        "**Do:** spawn subagents for parallel research",
        "- always reuse contexts when possible",
        "",
        "**Don't:** block on synchronous waits",
        "- never suppress error logs",
      ].join("\n"),
    );
    const rf = parseRuleFile(fp);
    expect(rf.name).toBe("test-rule");
    expect(rf.title).toBe("Test Rule");
    expect(rf.do_lines).toEqual([
      "spawn subagents for parallel research",
      "always reuse contexts when possible",
    ]);
    expect(rf.dont_lines).toEqual([
      "block on synchronous waits",
      "never suppress error logs",
    ]);
    expect(rf.keywords).toContain("spawn");
    expect(rf.keywords).toContain("reuse");
    expect(rf.tokens).toBeGreaterThan(0);
  });

  it("falls back to body keywords when no Do/Don't block exists", () => {
    const fp = writeRule(
      "freeform",
      "# Freeform\n\nThis is just plain prose, no directives.",
    );
    const rf = parseRuleFile(fp);
    expect(rf.do_lines).toEqual([]);
    expect(rf.dont_lines).toEqual([]);
    expect(rf.keywords.length).toBeGreaterThan(0);
  });

  it("falls back name → title when no heading is present", () => {
    const fp = writeRule("no-heading", "**Do:** something useful\n");
    const rf = parseRuleFile(fp);
    expect(rf.title).toBe("no-heading");
  });
});

describe("detectContradictions", () => {
  it("flags a direct contradiction: A.Do verb appears in B.Don't", () => {
    const a = parseRuleFile(
      writeRule(
        "block-rule",
        "# Block\n**Do:** block parallel agents on shared state",
      ),
    );
    const b = parseRuleFile(
      writeRule(
        "no-block-rule",
        "# No Block\n**Don't:** block parallel agents waiting for events",
      ),
    );
    const reports = detectContradictions([a, b], 0.3);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.rule_a).toBe("block-rule.md");
    expect(reports[0]?.rule_b).toBe("no-block-rule.md");
    expect(reports[0]?.scope_score).toBeGreaterThan(0);
  });

  it("flags antonym contradictions when both rules use opposing Do verbs", () => {
    const a = parseRuleFile(
      writeRule(
        "verbose-rule",
        "# Verbose\n**Do:** verbose logging for parallel work",
      ),
    );
    const b = parseRuleFile(
      writeRule(
        "concise-rule",
        "# Concise\n**Do:** concise logging for parallel work",
      ),
    );
    const reports = detectContradictions([a, b], 0.3);
    expect(reports.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores rules below the scope threshold", () => {
    const a = parseRuleFile(
      writeRule("alpha", "# A\n**Do:** measure cpu utilisation per node"),
    );
    const b = parseRuleFile(
      writeRule("beta", "# B\n**Don't:** edit unrelated documentation files"),
    );
    // These two have basically zero overlap → no contradictions reported.
    expect(detectContradictions([a, b], 0.3)).toEqual([]);
  });
});

describe("findMergeCandidates", () => {
  it("clusters rules that share enough keyword overlap (single-linkage)", () => {
    const r1 = parseRuleFile(
      writeRule("auth-1", "# Auth 1\n**Do:** validate token expiry strictly"),
    );
    const r2 = parseRuleFile(
      writeRule(
        "auth-2",
        "# Auth 2\n**Do:** validate token signature strictly",
      ),
    );
    const r3 = parseRuleFile(
      writeRule(
        "unrelated",
        "# Unrelated\n**Do:** measure bandwidth between services",
      ),
    );
    const candidates = findMergeCandidates([r1, r2, r3], 0.4);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.rules).toEqual(
      expect.arrayContaining(["auth-1.md", "auth-2.md"]),
    );
    expect(candidates[0]?.score).toBeGreaterThanOrEqual(0.4);
  });

  it("returns [] when fewer than 2 rules are above threshold", () => {
    const r1 = parseRuleFile(
      writeRule("solo", "# Solo\n**Do:** be alone and unique"),
    );
    expect(findMergeCandidates([r1], 0.6)).toEqual([]);
  });
});

describe("runRulesAudit", () => {
  it("returns an empty result when the directory does not exist", () => {
    const result = runRulesAudit({
      rulesDir: path.join(tmp, "no-such-dir"),
    });
    expect(result).toEqual({
      total_rules: 0,
      token_estimate: 0,
      contradictions: [],
      merge_candidates: [],
      rules: [],
    });
  });

  it("aggregates rules + token estimate + contradictions + merge candidates", () => {
    writeRule(
      "block-rule",
      "# Block\n**Do:** block parallel work on shared state",
    );
    writeRule(
      "no-block-rule",
      "# No Block\n**Don't:** block parallel work waiting on events",
    );
    writeRule(
      "auth-1",
      "# Auth 1\n**Do:** validate token signature for sessions",
    );
    writeRule("auth-2", "# Auth 2\n**Do:** validate token expiry for sessions");
    const result = runRulesAudit({ rulesDir: tmp, threshold: 0.4 });
    expect(result.total_rules).toBe(4);
    expect(result.token_estimate).toBeGreaterThan(0);
    expect(result.contradictions.length).toBeGreaterThanOrEqual(1);
    expect(result.merge_candidates.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores subdirectories and non-md files", () => {
    fs.mkdirSync(path.join(tmp, "subdir"));
    fs.writeFileSync(path.join(tmp, "readme.txt"), "not a rule");
    writeRule("real", "# Real\n**Do:** be a real rule");
    const result = runRulesAudit({ rulesDir: tmp });
    expect(result.total_rules).toBe(1);
    expect(result.rules[0]?.name).toBe("real");
  });
});
