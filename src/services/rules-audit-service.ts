/**
 * Local-only rules auditor. Reads `.claude/rules/*.md` files, parses each
 * into a `Do:` / `Don't:` rule with a keyword bag, and reports
 * contradictions (opposing directives across rules sharing scope) and
 * merge candidates (rule clusters that could be combined to save tokens).
 *
 * No Linear API is involved. Emits a stable `AuditResult` JSON shape for
 * `linear rules audit --json` consumers.
 */

import fs from "node:fs";
import path from "node:path";

export interface RuleFile {
  path: string;
  name: string;
  title: string;
  do_lines: string[];
  dont_lines: string[];
  body: string;
  keywords: string[];
  tokens: number;
}

export interface ContradictionReport {
  rule_a: string;
  rule_b: string;
  tension: string;
  do_line_a: string;
  dont_line_b: string;
  scope_score: number;
}

export interface MergeCandidate {
  group_label: string;
  rules: string[];
  score: number;
}

export interface AuditResult {
  total_rules: number;
  token_estimate: number;
  contradictions: ContradictionReport[];
  merge_candidates: MergeCandidate[];
  rules: RuleFile[];
}

/**
 * Standard English closed-class words, alphabetized, plus the modal and
 * temporal verbs that appear in nearly every rule sentence ("must",
 * "always", "before") and so carry no signal when comparing one rule to
 * another. Membership is all that matters here; the order is for humans
 * editing the list.
 */
const STOP_WORDS = new Set([
  "a",
  "after",
  "always",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "being",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "don't",
  "each",
  "for",
  "from",
  "had",
  "has",
  "have",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "may",
  "might",
  "must",
  "never",
  "no",
  "nor",
  "not",
  "of",
  "on",
  "only",
  "or",
  "other",
  "out",
  "over",
  "same",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "use",
  "very",
  "was",
  "were",
  "when",
  "which",
  "while",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/**
 * Directive verbs that cannot both be obeyed. Two rules covering the same
 * scope are flagged as contradictory when one uses a word listed under the
 * other. Alphabetized, and every entry has a matching reverse entry so the
 * lookup works whichever rule is read first.
 */
const ANTONYM_PAIRS: Record<string, string[]> = {
  block: ["parallel", "proceed"],
  concise: ["verbose"],
  log: ["suppress"],
  minimize: ["verbose"],
  parallel: ["block"],
  proceed: ["block"],
  reuse: ["spawn"],
  skip: ["wait"],
  spawn: ["reuse"],
  suppress: ["log"],
  verbose: ["concise", "minimize"],
  wait: ["skip"],
};

const HEADING_RE = /^#\s+(.+)/m;
const DO_RE = /^\*\*Do:?\*\*:?\s*(.*)/i;
const DONT_RE = /^\*\*Don'?t:?\*\*:?\s*(.*)/i;

/** Tokenize text into bare alphanumeric+apostrophe words. */
export function tokenizeWords(s: string): string[] {
  return s.split(/[^\p{L}\p{N}']+/u).filter((w) => w.length > 0);
}

export function extractKeywords(lines: string[]): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const line of lines) {
    for (const raw of tokenizeWords(line)) {
      const w = raw.toLowerCase();
      if (w.length < 2) continue;
      if (STOP_WORDS.has(w)) continue;
      if (!seen.has(w)) {
        seen.add(w);
        keywords.push(w);
      }
    }
  }
  keywords.sort();
  return keywords;
}

/**
 * Parse a single `.md` file into `Do:` / `Don't:` lines + keywords.
 * Continuation rules: bullet-points and plain-text lines continue the
 * active block; blank/heading/`**...**` lines close it. `Don't` is
 * matched before `Do` because the literal substring "Do" appears inside
 * "Don't".
 */
function extractAllDirectives(content: string): {
  doLines: string[];
  dontLines: string[];
} {
  const doLines: string[] = [];
  const dontLines: string[] = [];
  let blockType: 0 | 1 | 2 = 0;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const dontMatch = line.match(DONT_RE);
    if (dontMatch) {
      blockType = 2;
      const text = (dontMatch[1] ?? "").trim();
      if (text) dontLines.push(text);
      continue;
    }
    const doMatch = line.match(DO_RE);
    if (doMatch) {
      blockType = 1;
      const text = (doMatch[1] ?? "").trim();
      if (text) doLines.push(text);
      continue;
    }
    if (blockType === 0) continue;
    if (
      trimmed.startsWith("-") ||
      (trimmed.startsWith("*") && !trimmed.startsWith("**"))
    ) {
      const text = trimmed.replace(/^[-*\s]+/, "");
      if (text) {
        if (blockType === 1) doLines.push(text);
        else dontLines.push(text);
      }
    } else if (
      trimmed === "" ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("**")
    ) {
      blockType = 0;
    } else {
      if (blockType === 1) doLines.push(trimmed);
      else dontLines.push(trimmed);
    }
  }
  return { doLines, dontLines };
}

export function parseRuleFile(filePath: string): RuleFile {
  const data = fs.readFileSync(filePath, "utf8");
  const name = path.basename(filePath, ".md");
  const headingMatch = data.match(HEADING_RE);
  const title = headingMatch ? (headingMatch[1] ?? "").trim() : name;
  const { doLines, dontLines } = extractAllDirectives(data);
  const allDirectives = [...doLines, ...dontLines];
  const keywords =
    allDirectives.length > 0
      ? extractKeywords(allDirectives)
      : extractKeywords([data]);
  return {
    path: filePath,
    name,
    title,
    do_lines: doLines,
    dont_lines: dontLines,
    body: data,
    keywords,
    // Rough token estimate: 1 token ~ 4 chars.
    tokens: Math.floor(data.length / 4),
  };
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection += 1;
  let union = setA.size;
  for (const w of setB) if (!setA.has(w)) union += 1;
  return union === 0 ? 0 : intersection / union;
}

function extractActionWords(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines) {
    for (const raw of tokenizeWords(line)) {
      const w = raw.toLowerCase();
      if (w.length < 2 || STOP_WORDS.has(w)) continue;
      if (!out.has(w)) out.set(w, line);
    }
  }
  return out;
}

function summarizeLine(line: string): string {
  return line.length > 40 ? `${line.slice(0, 37)}...` : line;
}

function truncateTension(s: string): string {
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

function findDirectContradiction(
  a: RuleFile,
  b: RuleFile,
  scopeScore: number,
): ContradictionReport | null {
  const aDo = extractActionWords(a.do_lines);
  const bDont = extractActionWords(b.dont_lines);
  for (const [word, doLine] of aDo) {
    const dontLine = bDont.get(word);
    if (dontLine !== undefined) {
      return {
        rule_a: `${a.name}.md`,
        rule_b: `${b.name}.md`,
        tension: truncateTension(
          `"${summarizeLine(doLine)}" vs "${summarizeLine(dontLine)}"`,
        ),
        do_line_a: doLine,
        dont_line_b: dontLine,
        scope_score: scopeScore,
      };
    }
  }
  return null;
}

function findAntonymContradiction(
  a: RuleFile,
  b: RuleFile,
  scopeScore: number,
): ContradictionReport | null {
  const aDo = extractActionWords(a.do_lines);
  const bDo = extractActionWords(b.do_lines);
  for (const [wordA, lineA] of aDo) {
    const antonyms = ANTONYM_PAIRS[wordA];
    if (!antonyms) continue;
    for (const ant of antonyms) {
      const lineB = bDo.get(ant);
      if (lineB !== undefined) {
        return {
          rule_a: `${a.name}.md`,
          rule_b: `${b.name}.md`,
          tension: truncateTension(
            `"${summarizeLine(lineA)}" vs "${summarizeLine(lineB)}"`,
          ),
          do_line_a: lineA,
          dont_line_b: lineB,
          scope_score: scopeScore,
        };
      }
    }
  }
  return null;
}

export function detectContradictions(
  rules: RuleFile[],
  scopeThreshold: number,
): ContradictionReport[] {
  const reports: ContradictionReport[] = [];
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const a = rules[i];
      const b = rules[j];
      if (!a || !b) continue;
      const score = jaccardSimilarity(a.keywords, b.keywords);
      if (score < scopeThreshold) continue;
      const direct = findDirectContradiction(a, b, score);
      if (direct) {
        reports.push(direct);
        continue;
      }
      const reverse = findDirectContradiction(b, a, score);
      if (reverse) {
        // Swap labels so RuleA stays as the original ordering.
        reverse.rule_a = `${a.name}.md`;
        reverse.rule_b = `${b.name}.md`;
        reports.push(reverse);
        continue;
      }
      const antonym = findAntonymContradiction(a, b, score);
      if (antonym) reports.push(antonym);
    }
  }
  return reports;
}

function findGroupLabel(rules: RuleFile[], indices: number[]): string {
  const freq = new Map<string, number>();
  for (const idx of indices) {
    const r = rules[idx];
    if (!r) continue;
    for (const kw of r.keywords) {
      freq.set(kw, (freq.get(kw) ?? 0) + 1);
    }
  }
  let bestWord = "rules";
  let bestCount = 0;
  for (const [w, c] of freq) {
    if (c > bestCount || (c === bestCount && w < bestWord)) {
      bestWord = w;
      bestCount = c;
    }
  }
  return bestWord;
}

function roundTo2(f: number): number {
  return Math.round(f * 100) / 100;
}

export function findMergeCandidates(
  rules: RuleFile[],
  threshold: number,
): MergeCandidate[] {
  const n = rules.length;
  if (n < 2) return [];

  type Pair = { i: number; j: number; score: number };
  const pairs: Pair[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = rules[i];
      const b = rules[j];
      if (!a || !b) continue;
      const score = jaccardSimilarity(a.keywords, b.keywords);
      if (score >= threshold) pairs.push({ i, j, score });
    }
  }
  if (pairs.length === 0) return [];

  // Union-find / single-linkage clustering.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    if (parent[x] !== x) {
      parent[x] = find(parent[x] ?? x);
    }
    return parent[x] ?? x;
  };
  const union = (x: number, y: number): void => {
    const px = find(x);
    const py = find(y);
    if (px !== py) parent[px] = py;
  };
  for (const p of pairs) union(p.i, p.j);

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    const arr = groups.get(root) ?? [];
    arr.push(i);
    groups.set(root, arr);
  }

  const candidates: MergeCandidate[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let totalScore = 0;
    let pairCount = 0;
    for (let mi = 0; mi < members.length; mi += 1) {
      for (let mj = mi + 1; mj < members.length; mj += 1) {
        const ia = members[mi];
        const ib = members[mj];
        if (ia === undefined || ib === undefined) continue;
        const a = rules[ia];
        const b = rules[ib];
        if (!a || !b) continue;
        totalScore += jaccardSimilarity(a.keywords, b.keywords);
        pairCount += 1;
      }
    }
    const avg = pairCount > 0 ? totalScore / pairCount : 0;
    const ruleNames = members
      .map((idx) => {
        const r = rules[idx];
        return r ? `${r.name}.md` : "";
      })
      .filter((s) => s.length > 0)
      .sort();
    candidates.push({
      group_label: findGroupLabel(rules, members),
      rules: ruleNames,
      score: roundTo2(avg),
    });
  }

  candidates.sort((x, y) => y.score - x.score);
  return candidates;
}

const DEFAULT_RULES_PATH = ".claude/rules/";
const DEFAULT_AUDIT_THRESHOLD = 0.6;
const CONTRADICTION_SCOPE_THRESHOLD = 0.3;

/**
 * Top-level orchestrator for `linear rules audit`. Walks the directory
 * for `*.md` files, parses each, and runs contradiction + merge-candidate
 * detection. Missing directories return an empty AuditResult rather than
 * an error, keeping the JSON shape stable.
 */
export function runRulesAudit(opts: {
  rulesDir?: string;
  threshold?: number;
}): AuditResult {
  const rulesDir = opts.rulesDir ?? DEFAULT_RULES_PATH;
  const threshold = opts.threshold ?? DEFAULT_AUDIT_THRESHOLD;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rulesDir, { withFileTypes: true });
  } catch (e) {
    if (
      typeof e === "object" &&
      e !== null &&
      (e as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return {
        total_rules: 0,
        token_estimate: 0,
        contradictions: [],
        merge_candidates: [],
        rules: [],
      };
    }
    throw e;
  }

  const rules: RuleFile[] = [];
  let totalTokens = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (!entry.name.endsWith(".md")) continue;
    const fp = path.join(rulesDir, entry.name);
    try {
      const rf = parseRuleFile(fp);
      rules.push(rf);
      totalTokens += rf.tokens;
    } catch (e) {
      // Warn on stderr, skip the file.
      process.stderr.write(
        `Warning: skipping ${entry.name}: ${(e as Error).message}\n`,
      );
    }
  }

  const result: AuditResult = {
    total_rules: rules.length,
    token_estimate: totalTokens,
    contradictions: [],
    merge_candidates: [],
    rules,
  };

  if (rules.length < 2) return result;

  result.contradictions = detectContradictions(
    rules,
    CONTRADICTION_SCOPE_THRESHOLD,
  );
  result.merge_candidates = findMergeCandidates(rules, threshold);
  return result;
}
