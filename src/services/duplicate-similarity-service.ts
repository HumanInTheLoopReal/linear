/**
 * Token-based and AI-based duplicate detection for
 * `linear issues find-duplicates --method {mechanical|ai}`.
 *
 * Mechanical mode: Jaccard + cosine similarity over a tokenized
 * title+description. Linear has no native similarity ranking, so we
 * fetch the candidate issue set client-side and do the O(N²) comparison
 * locally. Documented scale limit: slow above ~10K issues.
 *
 * AI mode: mechanical pre-filter at 0.5×threshold (floor 0.15) caps the
 * candidate set to the top 100 most-similar pairs, then batches of 10
 * are sent to Claude with the title + first 500 chars of each
 * description. The model returns a JSON array of per-pair verdicts
 * (is_duplicate / confidence / reason); pairs with confidence ≥ threshold
 * become AI-method DuplicatePair entries with a `reason` string. A
 * single batch failure logs to stderr and falls back to the mechanical
 * scores for that batch.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import type { DuplicateDetectionFieldsFragment } from "../gql/graphql.js";
import { fetchOpenIssuesForMerge } from "./duplicate-detection-service.js";

export type DuplicateMethod = "mechanical" | "ai";

export interface DuplicatePair {
  issue_a_id: string;
  issue_b_id: string;
  issue_a_title: string;
  issue_b_title: string;
  similarity: number;
  method: DuplicateMethod;
  /** AI mode only — the model's brief justification for the verdict. */
  reason?: string;
}

export interface MechanicalResult {
  pairs: DuplicatePair[];
  count: number;
  method: "mechanical";
  threshold: number;
}

export interface AIResult {
  pairs: DuplicatePair[];
  count: number;
  method: "ai";
  threshold: number;
  candidates_evaluated: number;
  model: string;
}

const TOKEN_SPLIT = /[^\p{L}\p{N}-]+/u;

export function tokenize(text: string): Map<string, number> {
  const tokens = new Map<string, number>();
  for (const word of text.toLowerCase().split(TOKEN_SPLIT)) {
    if (word.length > 1) {
      tokens.set(word, (tokens.get(word) ?? 0) + 1);
    }
  }
  return tokens;
}

export function jaccardSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  let union = 0;
  for (const [token, countA] of a) {
    const countB = b.get(token);
    if (countB !== undefined) {
      intersection += Math.min(countA, countB);
      union += Math.max(countA, countB);
    } else {
      union += countA;
    }
  }
  for (const [token, countB] of b) {
    if (!a.has(token)) union += countB;
  }
  return union === 0 ? 0 : intersection / union;
}

export function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const [token, countA] of a) {
    magA += countA * countA;
    const countB = b.get(token);
    if (countB !== undefined) dot += countA * countB;
  }
  for (const countB of b.values()) {
    magB += countB * countB;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function issueText(issue: {
  title: string;
  description?: string | null;
}): string {
  const parts = [issue.title];
  if (issue.description) parts.push(issue.description);
  return parts.join(" ");
}

export function findMechanicalDuplicates(
  issues: Array<DuplicateDetectionFieldsFragment>,
  threshold: number,
): DuplicatePair[] {
  const items = issues.map((issue) => ({
    issue,
    tokens: tokenize(issueText(issue)),
  }));

  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const jaccard = jaccardSimilarity(items[i].tokens, items[j].tokens);
      const cosine = cosineSimilarity(items[i].tokens, items[j].tokens);
      const similarity = (jaccard + cosine) / 2;
      if (similarity >= threshold) {
        pairs.push({
          issue_a_id: items[i].issue.identifier,
          issue_b_id: items[j].issue.identifier,
          issue_a_title: items[i].issue.title,
          issue_b_title: items[j].issue.title,
          similarity,
          method: "mechanical",
        });
      }
    }
  }
  return pairs;
}

export async function runMechanicalDuplicateDetection(
  client: GraphQLClient,
  options: {
    teamId?: string;
    threshold: number;
    limit: number;
    stateTypes?: string[] | null;
  },
): Promise<MechanicalResult> {
  const issueMap = await fetchOpenIssuesForMerge(client, {
    teamId: options.teamId,
    stateTypes: options.stateTypes,
  });
  const issues = Array.from(issueMap.values());
  const pairs = findMechanicalDuplicates(issues, options.threshold);
  pairs.sort((a, b) => b.similarity - a.similarity);
  const limited = options.limit > 0 ? pairs.slice(0, options.limit) : pairs;
  return {
    pairs: limited,
    count: limited.length,
    method: "mechanical",
    threshold: options.threshold,
  };
}

// ──────────────────────────────────────────────────────────────────────
// AI mode: pre-filter mechanically, then send batches to Claude.
// ──────────────────────────────────────────────────────────────────────

export const AI_DEFAULT_MODEL = "claude-sonnet-4-5";
export const AI_MAX_CANDIDATES = 100;
export const AI_BATCH_SIZE = 10;
export const AI_DESC_TRUNCATE = 500;
const AI_MAX_TOKENS = 2048;

/** Subset of the Anthropic SDK shape we use — easy to mock in tests. */
export interface AnthropicLike {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: "user"; content: string }>;
    }): Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

interface AIPairVerdict {
  pair_index: number;
  is_duplicate: boolean;
  confidence: number;
  reason: string;
}

/**
 * Shared instruction block for both prompt builders. The output contract
 * (a bare JSON array, one object per pair, with these four fields) is what
 * `parseAIResponse` expects, so keep them in step.
 */
const AI_PROMPT_INSTRUCTIONS: readonly string[] = [
  "Below are pairs of issues from a tracker. Judge whether the two issues in each pair are the same work recorded twice.",
  "Treat them as the same when closing one would leave the other with nothing left to do, even if the wording differs.",
  "Return a JSON array holding one object per pair, in the order the pairs appear, with these fields:",
  "  - pair_index (int): which pair the verdict is for, counting from 0",
  "  - is_duplicate (bool): true when the pair is the same work",
  "  - confidence (float): between 0.0 and 1.0",
  "  - reason (string): one short sentence explaining the call",
  "",
  "Return the JSON array on its own, with no surrounding prose or code fences.",
  "",
];

export function buildAIPrompt(candidates: DuplicatePair[]): string {
  const lines: string[] = [...AI_PROMPT_INSTRUCTIONS];
  candidates.forEach((c, i) => {
    lines.push(`--- Pair ${i} ---`);
    lines.push(`Issue A [${c.issue_a_id}]: ${c.issue_a_title}`);
    lines.push(`Issue B [${c.issue_b_id}]: ${c.issue_b_title}`);
    lines.push("");
  });
  return lines.join("\n");
}

/** Extract `[ ... ]` substring even if surrounded by prose or fences. */
export function extractJsonArray(text: string): string {
  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first === -1 || last === -1 || first > last) return text;
  return text.slice(first, last + 1);
}

export function parseAIVerdicts(text: string): AIPairVerdict[] {
  const raw = extractJsonArray(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: AIPairVerdict[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o.pair_index !== "number" ||
      typeof o.is_duplicate !== "boolean" ||
      typeof o.confidence !== "number"
    ) {
      continue;
    }
    out.push({
      pair_index: o.pair_index,
      is_duplicate: o.is_duplicate,
      confidence: o.confidence,
      reason: typeof o.reason === "string" ? o.reason : "",
    });
  }
  return out;
}

/**
 * Build the candidate set for AI analysis from a pool of issues.
 *
 * Pre-filter with mechanical at 0.5×threshold (floor 0.15), keep top-100
 * by mechanical similarity. Each candidate keeps its full issue context
 * (title + description for the prompt).
 */
export function buildAICandidates(
  issues: Array<DuplicateDetectionFieldsFragment>,
  threshold: number,
): Array<DuplicatePair & { description_a: string; description_b: string }> {
  const preFilter = Math.max(threshold * 0.5, 0.15);
  const items = issues.map((issue) => ({
    issue,
    tokens: tokenize(issueText(issue)),
  }));
  const pairs: Array<
    DuplicatePair & { description_a: string; description_b: string }
  > = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const jaccard = jaccardSimilarity(items[i].tokens, items[j].tokens);
      const cosine = cosineSimilarity(items[i].tokens, items[j].tokens);
      const similarity = (jaccard + cosine) / 2;
      if (similarity >= preFilter) {
        pairs.push({
          issue_a_id: items[i].issue.identifier,
          issue_b_id: items[j].issue.identifier,
          issue_a_title: items[i].issue.title,
          issue_b_title: items[j].issue.title,
          similarity,
          method: "mechanical",
          description_a: items[i].issue.description ?? "",
          description_b: items[j].issue.description ?? "",
        });
      }
    }
  }
  pairs.sort((a, b) => b.similarity - a.similarity);
  return pairs.slice(0, AI_MAX_CANDIDATES);
}

/** Truncate a description body for the prompt; appends "..." when cut. */
function truncateBody(text: string): string {
  if (text.length <= AI_DESC_TRUNCATE) return text;
  return `${text.slice(0, AI_DESC_TRUNCATE)}...`;
}

function buildPromptWithBodies(
  candidates: Array<
    DuplicatePair & { description_a: string; description_b: string }
  >,
): string {
  const lines: string[] = [...AI_PROMPT_INSTRUCTIONS];
  candidates.forEach((c, i) => {
    lines.push(`--- Pair ${i} ---`);
    lines.push(`Issue A [${c.issue_a_id}]: ${c.issue_a_title}`);
    if (c.description_a) {
      lines.push(`  Description: ${truncateBody(c.description_a)}`);
    }
    lines.push(`Issue B [${c.issue_b_id}]: ${c.issue_b_title}`);
    if (c.description_b) {
      lines.push(`  Description: ${truncateBody(c.description_b)}`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

export async function analyzeAIBatch(
  anthropic: AnthropicLike,
  model: string,
  candidates: Array<
    DuplicatePair & { description_a: string; description_b: string }
  >,
  threshold: number,
): Promise<DuplicatePair[]> {
  if (candidates.length === 0) return [];

  let response: Awaited<ReturnType<AnthropicLike["messages"]["create"]>>;
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: AI_MAX_TOKENS,
      messages: [{ role: "user", content: buildPromptWithBodies(candidates) }],
    });
  } catch (e) {
    process.stderr.write(
      `Warning: AI analysis failed: ${(e as Error).message}\n`,
    );
    return [];
  }

  const block = response.content.find((c) => c.type === "text" && c.text);
  if (!block?.text) {
    process.stderr.write("Warning: unexpected AI response format\n");
    return [];
  }

  const verdicts = parseAIVerdicts(block.text);
  const pairs: DuplicatePair[] = [];
  for (const v of verdicts) {
    if (v.pair_index < 0 || v.pair_index >= candidates.length) continue;
    if (!v.is_duplicate) continue;
    if (v.confidence < threshold) continue;
    const c = candidates[v.pair_index];
    pairs.push({
      issue_a_id: c.issue_a_id,
      issue_b_id: c.issue_b_id,
      issue_a_title: c.issue_a_title,
      issue_b_title: c.issue_b_title,
      similarity: v.confidence,
      method: "ai",
      reason: v.reason,
    });
  }
  return pairs;
}

export async function findAIDuplicates(
  anthropic: AnthropicLike,
  issues: Array<DuplicateDetectionFieldsFragment>,
  options: { threshold: number; model: string },
): Promise<{ pairs: DuplicatePair[]; candidates_evaluated: number }> {
  const candidates = buildAICandidates(issues, options.threshold);
  if (candidates.length === 0) {
    return { pairs: [], candidates_evaluated: 0 };
  }
  process.stderr.write(
    `Analyzing ${candidates.length} candidate pairs with AI...\n`,
  );
  const out: DuplicatePair[] = [];
  for (let i = 0; i < candidates.length; i += AI_BATCH_SIZE) {
    const batch = candidates.slice(i, i + AI_BATCH_SIZE);
    const batchPairs = await analyzeAIBatch(
      anthropic,
      options.model,
      batch,
      options.threshold,
    );
    out.push(...batchPairs);
  }
  return { pairs: out, candidates_evaluated: candidates.length };
}

export async function runAIDuplicateDetection(
  client: GraphQLClient,
  anthropic: AnthropicLike,
  options: {
    teamId?: string;
    threshold: number;
    limit: number;
    stateTypes?: string[] | null;
    model: string;
  },
): Promise<AIResult> {
  const issueMap = await fetchOpenIssuesForMerge(client, {
    teamId: options.teamId,
    stateTypes: options.stateTypes,
  });
  const issues = Array.from(issueMap.values());
  const { pairs, candidates_evaluated } = await findAIDuplicates(
    anthropic,
    issues,
    {
      threshold: options.threshold,
      model: options.model,
    },
  );
  pairs.sort((a, b) => b.similarity - a.similarity);
  const limited = options.limit > 0 ? pairs.slice(0, options.limit) : pairs;
  return {
    pairs: limited,
    count: limited.length,
    method: "ai",
    threshold: options.threshold,
    candidates_evaluated,
    model: options.model,
  };
}
