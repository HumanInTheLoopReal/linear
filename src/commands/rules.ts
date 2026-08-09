import type { Command } from "commander";
import { getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { runRulesAudit } from "../services/rules-audit-service.js";

/**
 * Rules audit is local-only (parses `.claude/rules/*.md`). The output is
 * a summary header + per-finding blocks. A structured JSON envelope is
 * available via --json for tooling.
 *
 *   audit (clean)   → summary + `✓ No contradictions or merge candidates found.`
 *   audit (issues)  → summary + Contradictions section + Merge candidates section
 */

interface ContradictionShape {
  rule_a: string;
  rule_b: string;
  tension: string;
  do_line_a: string;
  dont_line_b: string;
  scope_score: number;
}

interface MergeCandidateShape {
  group_label: string;
  rules: string[];
  score: number;
}

interface RulesAuditResultShape {
  total_rules: number;
  token_estimate: number;
  contradictions: ContradictionShape[];
  merge_candidates: MergeCandidateShape[];
}

export function formatRulesAudit(result: RulesAuditResultShape): string {
  const lines: string[] = [
    "📋 Rules audit:",
    `  Total rules:    ${result.total_rules}`,
    `  Token estimate: ${result.token_estimate.toLocaleString("en-US")}`,
  ];
  if (
    result.contradictions.length === 0 &&
    result.merge_candidates.length === 0
  ) {
    lines.push("");
    lines.push("✓ No contradictions or merge candidates found.");
    return `${lines.join("\n")}\n`;
  }
  if (result.contradictions.length > 0) {
    lines.push("");
    lines.push(`Contradictions (${result.contradictions.length}):`);
    for (const c of result.contradictions) {
      lines.push(
        `  ⚠ ${c.rule_a} vs ${c.rule_b}  (scope ${c.scope_score.toFixed(2)})`,
      );
      lines.push(`    DO   : ${c.do_line_a}`);
      lines.push(`    DON'T: ${c.dont_line_b}`);
      if (c.tension) lines.push(`    tension: ${c.tension}`);
    }
  }
  if (result.merge_candidates.length > 0) {
    lines.push("");
    lines.push(`Merge candidates (${result.merge_candidates.length}):`);
    for (const m of result.merge_candidates) {
      lines.push(`  ◇ ${m.group_label}  (score ${m.score.toFixed(2)})`);
      lines.push(`    rules: ${m.rules.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export const RULES_META: DomainMeta = {
  name: "rules",
  summary:
    "audit `.claude/rules/*.md` files for contradictions and merge candidates",
  context: [
    "Local-only: parses Claude rule markdown files and reports tensions",
    "between rules (opposing Do/Don't directives across rules sharing",
    "scope) plus clusters of rules that could be merged to reduce agent",
    "token overhead. No Linear API is involved.",
    "",
    "Output shape is a stable structured envelope for agent consumption.",
    "",
    "Subcommands: `audit`. `compact` is on the roadmap.",
  ].join("\n"),
  arguments: {},
  seeAlso: [],
};

export function setupRulesCommands(program: Command): void {
  const rules = program
    .command("rules")
    .description("audit and (eventually) compact Claude rule files");

  rules.action(() => rules.help());

  rules
    .command("audit")
    .description(
      "scan `.claude/rules/*.md` for contradictions and merge candidates",
    )
    .option(
      "--path <dir>",
      "path to the rules directory (default `.claude/rules/`)",
    )
    .option(
      "--threshold <f>",
      "Jaccard similarity threshold for merge clustering (default 0.6)",
      (v) => Number.parseFloat(v),
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          { path?: string; threshold?: number },
          Command,
        ];
        if (
          options.threshold !== undefined &&
          (!Number.isFinite(options.threshold) ||
            options.threshold < 0 ||
            options.threshold > 1)
        ) {
          throw new Error(
            `--threshold must be a number in [0, 1] (got ${options.threshold})`,
          );
        }
        const rootOpts = getRootOpts(command);
        const result = runRulesAudit({
          rulesDir: options.path,
          threshold: options.threshold,
        });
        outputResult(result, formatRulesAudit, rootOpts);
      }),
    );

  rules
    .command("usage")
    .description("show detailed usage for rules")
    .action(() => {
      console.log(formatDomainUsage(rules, RULES_META));
    });
}
