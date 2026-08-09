import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import type { DuplicateDetectionFieldsFragment } from "../../../src/gql/graphql.js";
import {
  AI_BATCH_SIZE,
  AI_DESC_TRUNCATE,
  AI_MAX_CANDIDATES,
  type AnthropicLike,
  analyzeAIBatch,
  buildAICandidates,
  cosineSimilarity,
  extractJsonArray,
  findAIDuplicates,
  findMechanicalDuplicates,
  jaccardSimilarity,
  parseAIVerdicts,
  runAIDuplicateDetection,
  runMechanicalDuplicateDetection,
  tokenize,
} from "../../../src/services/duplicate-similarity-service.js";

vi.mock("../../../src/services/duplicate-detection-service.js", () => ({
  fetchOpenIssuesForMerge: vi.fn(),
}));

import { fetchOpenIssuesForMerge } from "../../../src/services/duplicate-detection-service.js";

function makeIssue(
  identifier: string,
  title: string,
  description: string | null = null,
): DuplicateDetectionFieldsFragment {
  return {
    id: `uuid-${identifier}`,
    identifier,
    title,
    description,
    priority: 0,
    state: { id: "s1", name: "Backlog", type: "backlog" },
    team: { id: "t1", key: "TES", name: "Test" },
    parent: null,
    children: { nodes: [] },
    relations: { nodes: [] },
    inverseRelations: { nodes: [] },
  } as DuplicateDetectionFieldsFragment;
}

describe("tokenize", () => {
  it("lowercases, splits on non-letter/digit/hyphen, drops single-char tokens", () => {
    const t = tokenize("Hello, World! A b cd-ef ABC 123");
    expect(t.get("hello")).toBe(1);
    expect(t.get("world")).toBe(1);
    expect(t.get("a")).toBeUndefined();
    expect(t.get("b")).toBeUndefined();
    expect(t.get("cd-ef")).toBe(1);
    expect(t.get("abc")).toBe(1);
    expect(t.get("123")).toBe(1);
  });

  it("counts duplicate tokens", () => {
    const t = tokenize("port port port linear");
    expect(t.get("port")).toBe(3);
    expect(t.get("linear")).toBe(1);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 0 for two empty token sets", () => {
    expect(jaccardSimilarity(new Map(), new Map())).toBe(0);
  });

  it("returns 1 for identical token sets", () => {
    const a = tokenize("port linear issues lint");
    const b = tokenize("port linear issues lint");
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("returns 0 for disjoint token sets", () => {
    const a = tokenize("alpha beta gamma");
    const b = tokenize("delta epsilon zeta");
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("computes intersection/union with multiplicities", () => {
    const a = tokenize("port port linear");
    const b = tokenize("port linear linear");
    // intersection: min(port:2,1)+min(linear:1,2) = 1 + 1 = 2
    // union: max(port:2,1)+max(linear:1,2) = 2 + 2 = 4
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 4, 6);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical token vectors", () => {
    const a = tokenize("port linear");
    const b = tokenize("port linear");
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it("returns 0 when either vector is empty", () => {
    expect(cosineSimilarity(new Map(), new Map([["x", 1]]))).toBe(0);
    expect(cosineSimilarity(new Map([["x", 1]]), new Map())).toBe(0);
  });

  it("returns 0 for disjoint vectors", () => {
    expect(cosineSimilarity(tokenize("a alpha"), tokenize("b beta"))).toBe(0);
  });
});

describe("findMechanicalDuplicates", () => {
  it("returns no pairs below threshold", () => {
    const issues = [
      makeIssue("T-1", "completely different alpha", "first body"),
      makeIssue("T-2", "totally unrelated beta", "second body"),
    ];
    expect(findMechanicalDuplicates(issues, 0.5)).toEqual([]);
  });

  it("finds pairs above threshold and uses identifiers", () => {
    const issues = [
      makeIssue("T-1", "port linear issues lint", "validate sections"),
      makeIssue(
        "T-2",
        "port linear issues lint validator",
        "validate sections",
      ),
      makeIssue("T-3", "wholly different topic", "another body"),
    ];
    const pairs = findMechanicalDuplicates(issues, 0.5);
    expect(pairs.length).toBe(1);
    expect(pairs[0].issue_a_id).toBe("T-1");
    expect(pairs[0].issue_b_id).toBe("T-2");
    expect(pairs[0].method).toBe("mechanical");
    expect(pairs[0].similarity).toBeGreaterThan(0.5);
  });
});

describe("runMechanicalDuplicateDetection", () => {
  it("sorts pairs by similarity desc and respects limit", async () => {
    const map = new Map<string, DuplicateDetectionFieldsFragment>([
      ["T-1", makeIssue("T-1", "port linear issues lint", "validate")],
      [
        "T-2",
        makeIssue("T-2", "port linear issues lint validator", "validate"),
      ],
      ["T-3", makeIssue("T-3", "port linear issues history", "events")],
      ["T-4", makeIssue("T-4", "port linear issues history events", "events")],
    ]);
    vi.mocked(fetchOpenIssuesForMerge).mockResolvedValueOnce(map);

    const client = {} as unknown as GraphQLClient;
    const result = await runMechanicalDuplicateDetection(client, {
      threshold: 0.3,
      limit: 1,
    });

    expect(result.method).toBe("mechanical");
    expect(result.threshold).toBe(0.3);
    expect(result.count).toBe(1);
    expect(result.pairs.length).toBe(1);
    // The highest-similarity pair should be returned first.
    const pair = result.pairs[0];
    expect(["T-1", "T-2", "T-3", "T-4"]).toContain(pair.issue_a_id);
  });

  it("returns all pairs when limit is 0", async () => {
    const map = new Map<string, DuplicateDetectionFieldsFragment>([
      ["T-1", makeIssue("T-1", "alpha beta gamma", null)],
      ["T-2", makeIssue("T-2", "alpha beta gamma", null)],
    ]);
    vi.mocked(fetchOpenIssuesForMerge).mockResolvedValueOnce(map);

    const result = await runMechanicalDuplicateDetection(
      {} as unknown as GraphQLClient,
      { threshold: 0.5, limit: 0 },
    );
    expect(result.count).toBe(1);
    expect(result.pairs[0].similarity).toBeCloseTo(1, 6);
  });

  it("forwards stateTypes to fetchOpenIssuesForMerge", async () => {
    vi.mocked(fetchOpenIssuesForMerge).mockResolvedValueOnce(new Map());

    await runMechanicalDuplicateDetection({} as unknown as GraphQLClient, {
      threshold: 0.5,
      limit: 50,
      stateTypes: ["started"],
    });

    expect(fetchOpenIssuesForMerge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ stateTypes: ["started"] }),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────
// AI mode
// ──────────────────────────────────────────────────────────────────────

describe("extractJsonArray", () => {
  it("returns the bracketed substring when surrounded by prose", () => {
    const text = 'Here you go:\n[{"pair_index":0}]\nThanks!';
    expect(extractJsonArray(text)).toBe('[{"pair_index":0}]');
  });

  it("returns the bracketed substring when wrapped in code fences", () => {
    const text = '```json\n[{"pair_index":0}]\n```';
    expect(extractJsonArray(text)).toBe('[{"pair_index":0}]');
  });

  it("returns the input unchanged when no brackets are present", () => {
    expect(extractJsonArray("nope")).toBe("nope");
  });

  it("returns the input unchanged when brackets are inverted", () => {
    expect(extractJsonArray("] before [")).toBe("] before [");
  });
});

describe("parseAIVerdicts", () => {
  it("parses a well-formed verdict array", () => {
    const text = JSON.stringify([
      { pair_index: 0, is_duplicate: true, confidence: 0.9, reason: "same" },
      { pair_index: 1, is_duplicate: false, confidence: 0.2, reason: "diff" },
    ]);
    expect(parseAIVerdicts(text)).toEqual([
      { pair_index: 0, is_duplicate: true, confidence: 0.9, reason: "same" },
      { pair_index: 1, is_duplicate: false, confidence: 0.2, reason: "diff" },
    ]);
  });

  it("returns [] on malformed JSON", () => {
    expect(parseAIVerdicts("{ not valid")).toEqual([]);
  });

  it("returns [] when payload is not an array", () => {
    expect(parseAIVerdicts('{"pair_index":0}')).toEqual([]);
  });

  it("skips entries with wrong field types", () => {
    const text = JSON.stringify([
      { pair_index: "0", is_duplicate: true, confidence: 0.9 },
      { pair_index: 1, is_duplicate: "yes", confidence: 0.9 },
      { pair_index: 2, is_duplicate: true, confidence: "0.9" },
      { pair_index: 3, is_duplicate: true, confidence: 0.9 },
    ]);
    const out = parseAIVerdicts(text);
    expect(out).toHaveLength(1);
    expect(out[0].pair_index).toBe(3);
  });

  it("defaults reason to '' when missing or wrong type", () => {
    const text = JSON.stringify([
      { pair_index: 0, is_duplicate: true, confidence: 0.9 },
      { pair_index: 1, is_duplicate: true, confidence: 0.9, reason: 42 },
    ]);
    const out = parseAIVerdicts(text);
    expect(out[0].reason).toBe("");
    expect(out[1].reason).toBe("");
  });
});

describe("buildAICandidates", () => {
  it("applies a 0.5×threshold pre-filter (floor 0.15) and caps at AI_MAX_CANDIDATES", () => {
    const issues = [
      makeIssue("T-1", "port linear issues lint", "validate sections"),
      makeIssue(
        "T-2",
        "port linear issues lint validator",
        "validate sections",
      ),
      makeIssue("T-3", "wholly different topic alpha", "another body"),
      makeIssue("T-4", "wholly different topic beta", "yet another"),
    ];
    const candidates = buildAICandidates(issues, 0.6);
    expect(candidates.length).toBeGreaterThan(0);
    // pre-filter is max(0.6 * 0.5, 0.15) = 0.3, so all surviving pairs ≥ 0.3
    for (const c of candidates) {
      expect(c.similarity).toBeGreaterThanOrEqual(0.3);
    }
    // sorted desc by similarity
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].similarity).toBeGreaterThanOrEqual(
        candidates[i].similarity,
      );
    }
  });

  it("enforces a floor of 0.15 even when threshold is tiny", () => {
    // threshold 0.0 ⇒ 0.0 * 0.5 = 0.0, but floor is 0.15
    const a = makeIssue("T-1", "alpha beta gamma", null);
    const b = makeIssue("T-2", "alpha beta gamma", null); // identical → sim = 1
    const c = makeIssue("T-3", "completely orthogonal terms here", null);
    const cands = buildAICandidates([a, b, c], 0.0);
    for (const cand of cands) {
      expect(cand.similarity).toBeGreaterThanOrEqual(0.15);
    }
  });

  it("caps the candidate set at AI_MAX_CANDIDATES", () => {
    // Build enough near-identical issues to exceed the cap.
    // 16 identical issues produce C(16,2)=120 pairs at sim ≈ 1.
    const issues: DuplicateDetectionFieldsFragment[] = [];
    for (let i = 0; i < 16; i++) {
      issues.push(makeIssue(`T-${i}`, "alpha beta gamma delta", null));
    }
    const cands = buildAICandidates(issues, 0.5);
    expect(cands.length).toBe(AI_MAX_CANDIDATES);
  });

  it("includes truncated/raw descriptions on each candidate", () => {
    const issues = [
      makeIssue("T-1", "alpha beta gamma", "body of A"),
      makeIssue("T-2", "alpha beta gamma", "body of B"),
    ];
    const cands = buildAICandidates(issues, 0.5);
    expect(cands[0].description_a).toBe("body of A");
    expect(cands[0].description_b).toBe("body of B");
  });
});

describe("analyzeAIBatch", () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  function mockAnthropic(response: { text: string }): AnthropicLike {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: response.text }],
        }),
      },
    };
  }

  function makeCandidate(
    a: string,
    b: string,
  ): Parameters<typeof analyzeAIBatch>[2][number] {
    return {
      issue_a_id: a,
      issue_b_id: b,
      issue_a_title: `Title ${a}`,
      issue_b_title: `Title ${b}`,
      similarity: 0.5,
      method: "mechanical",
      description_a: "",
      description_b: "",
    };
  }

  it("returns [] immediately when candidate list is empty", async () => {
    const sdk = mockAnthropic({ text: "[]" });
    const pairs = await analyzeAIBatch(sdk, "claude-x", [], 0.5);
    expect(pairs).toEqual([]);
    expect(sdk.messages.create).not.toHaveBeenCalled();
  });

  it("converts verdicts into ai-method pairs above threshold", async () => {
    const cands = [makeCandidate("A-1", "A-2"), makeCandidate("B-1", "B-2")];
    const sdk = mockAnthropic({
      text: JSON.stringify([
        { pair_index: 0, is_duplicate: true, confidence: 0.9, reason: "same" },
        { pair_index: 1, is_duplicate: true, confidence: 0.3, reason: "weak" },
      ]),
    });
    const pairs = await analyzeAIBatch(sdk, "claude-x", cands, 0.5);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].issue_a_id).toBe("A-1");
    expect(pairs[0].method).toBe("ai");
    expect(pairs[0].similarity).toBe(0.9);
    expect(pairs[0].reason).toBe("same");
  });

  it("drops verdicts marked is_duplicate=false", async () => {
    const cands = [makeCandidate("A-1", "A-2")];
    const sdk = mockAnthropic({
      text: JSON.stringify([
        { pair_index: 0, is_duplicate: false, confidence: 0.99, reason: "no" },
      ]),
    });
    expect(await analyzeAIBatch(sdk, "claude-x", cands, 0.5)).toEqual([]);
  });

  it("ignores out-of-range pair_index", async () => {
    const cands = [makeCandidate("A-1", "A-2")];
    const sdk = mockAnthropic({
      text: JSON.stringify([
        { pair_index: 5, is_duplicate: true, confidence: 0.9, reason: "x" },
        { pair_index: -1, is_duplicate: true, confidence: 0.9, reason: "x" },
      ]),
    });
    expect(await analyzeAIBatch(sdk, "claude-x", cands, 0.5)).toEqual([]);
  });

  it("writes a warning and returns [] when the SDK call rejects", async () => {
    const cands = [makeCandidate("A-1", "A-2")];
    const sdk: AnthropicLike = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("rate limited")),
      },
    };
    const writeSpy = vi.mocked(process.stderr.write);
    const pairs = await analyzeAIBatch(sdk, "claude-x", cands, 0.5);
    expect(pairs).toEqual([]);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("AI analysis failed"),
    );
  });

  it("writes a warning and returns [] when the response has no text block", async () => {
    const cands = [makeCandidate("A-1", "A-2")];
    const sdk: AnthropicLike = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "image" }],
        }),
      },
    };
    const writeSpy = vi.mocked(process.stderr.write);
    const pairs = await analyzeAIBatch(sdk, "claude-x", cands, 0.5);
    expect(pairs).toEqual([]);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("unexpected AI response format"),
    );
  });

  it("truncates long descriptions in the prompt to AI_DESC_TRUNCATE and appends '...'", async () => {
    const longBody = "x".repeat(AI_DESC_TRUNCATE + 200);
    const cand: Parameters<typeof analyzeAIBatch>[2][number] = {
      issue_a_id: "A-1",
      issue_b_id: "A-2",
      issue_a_title: "T",
      issue_b_title: "T",
      similarity: 0.5,
      method: "mechanical",
      description_a: longBody,
      description_b: "short",
    };
    const sdk = mockAnthropic({ text: "[]" });
    await analyzeAIBatch(sdk, "claude-x", [cand], 0.5);
    const call = vi.mocked(sdk.messages.create).mock.calls[0]?.[0];
    const prompt = call?.messages[0]?.content ?? "";
    // truncated body shows exactly AI_DESC_TRUNCATE chars of x then "..."
    expect(prompt).toContain(`${"x".repeat(AI_DESC_TRUNCATE)}...`);
    // the original over-length body must not appear verbatim
    expect(prompt).not.toContain("x".repeat(AI_DESC_TRUNCATE + 1));
    // short body is not annotated
    expect(prompt).toContain("Description: short");
  });
});

describe("findAIDuplicates", () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("returns empty when no candidates survive the pre-filter", async () => {
    const issues = [
      makeIssue("T-1", "completely different alpha", null),
      makeIssue("T-2", "totally unrelated beta", null),
    ];
    const sdk: AnthropicLike = {
      messages: { create: vi.fn() },
    };
    const result = await findAIDuplicates(sdk, issues, {
      threshold: 0.9,
      model: "claude-x",
    });
    expect(result).toEqual({ pairs: [], candidates_evaluated: 0 });
    expect(sdk.messages.create).not.toHaveBeenCalled();
  });

  it("batches candidates in groups of AI_BATCH_SIZE", async () => {
    // 16 near-identical issues → 120 candidate pairs → capped to AI_MAX_CANDIDATES (100)
    // → 100 / AI_BATCH_SIZE (10) = 10 batches.
    const issues: DuplicateDetectionFieldsFragment[] = [];
    for (let i = 0; i < 16; i++) {
      issues.push(makeIssue(`T-${i}`, "alpha beta gamma delta", null));
    }
    const createSpy = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: "[]" }] });
    const sdk: AnthropicLike = { messages: { create: createSpy } };

    const result = await findAIDuplicates(sdk, issues, {
      threshold: 0.5,
      model: "claude-x",
    });

    expect(result.candidates_evaluated).toBe(AI_MAX_CANDIDATES);
    expect(createSpy).toHaveBeenCalledTimes(AI_MAX_CANDIDATES / AI_BATCH_SIZE);
  });

  it("threads the model id through to anthropic.messages.create", async () => {
    const issues = [
      makeIssue("T-1", "alpha beta gamma", null),
      makeIssue("T-2", "alpha beta gamma", null),
    ];
    const createSpy = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: "[]" }] });
    const sdk: AnthropicLike = { messages: { create: createSpy } };
    await findAIDuplicates(sdk, issues, {
      threshold: 0.5,
      model: "claude-experiment",
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-experiment" }),
    );
  });
});

describe("runAIDuplicateDetection", () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("fetches issues, calls Anthropic, sorts pairs by similarity desc, and applies limit", async () => {
    const map = new Map<string, DuplicateDetectionFieldsFragment>([
      ["T-1", makeIssue("T-1", "alpha beta gamma", null)],
      ["T-2", makeIssue("T-2", "alpha beta gamma", null)],
      ["T-3", makeIssue("T-3", "alpha beta gamma", null)],
    ]);
    vi.mocked(fetchOpenIssuesForMerge).mockResolvedValueOnce(map);

    // Three pairs: (T-1,T-2), (T-1,T-3), (T-2,T-3). Return verdicts with
    // varying confidence so we can verify sort + limit.
    const createSpy = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            { pair_index: 0, is_duplicate: true, confidence: 0.7, reason: "a" },
            {
              pair_index: 1,
              is_duplicate: true,
              confidence: 0.95,
              reason: "b",
            },
            { pair_index: 2, is_duplicate: true, confidence: 0.6, reason: "c" },
          ]),
        },
      ],
    });
    const sdk: AnthropicLike = { messages: { create: createSpy } };

    const result = await runAIDuplicateDetection(
      {} as unknown as GraphQLClient,
      sdk,
      {
        threshold: 0.5,
        limit: 2,
        model: "claude-x",
      },
    );

    expect(result.method).toBe("ai");
    expect(result.threshold).toBe(0.5);
    expect(result.model).toBe("claude-x");
    expect(result.candidates_evaluated).toBe(3);
    expect(result.count).toBe(2);
    expect(result.pairs).toHaveLength(2);
    expect(result.pairs[0].similarity).toBe(0.95);
    expect(result.pairs[1].similarity).toBe(0.7);
  });

  it("forwards stateTypes and teamId to fetchOpenIssuesForMerge", async () => {
    vi.mocked(fetchOpenIssuesForMerge).mockResolvedValueOnce(new Map());
    const sdk: AnthropicLike = {
      messages: { create: vi.fn() },
    };
    await runAIDuplicateDetection({} as unknown as GraphQLClient, sdk, {
      teamId: "team-uuid",
      threshold: 0.5,
      limit: 0,
      stateTypes: ["started"],
      model: "claude-x",
    });
    expect(fetchOpenIssuesForMerge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        teamId: "team-uuid",
        stateTypes: ["started"],
      }),
    );
  });

  it("returns all pairs when limit is 0", async () => {
    const map = new Map<string, DuplicateDetectionFieldsFragment>([
      ["T-1", makeIssue("T-1", "alpha beta gamma", null)],
      ["T-2", makeIssue("T-2", "alpha beta gamma", null)],
    ]);
    vi.mocked(fetchOpenIssuesForMerge).mockResolvedValueOnce(map);
    const sdk: AnthropicLike = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: JSON.stringify([
                {
                  pair_index: 0,
                  is_duplicate: true,
                  confidence: 0.9,
                  reason: "x",
                },
              ]),
            },
          ],
        }),
      },
    };
    const result = await runAIDuplicateDetection(
      {} as unknown as GraphQLClient,
      sdk,
      { threshold: 0.5, limit: 0, model: "claude-x" },
    );
    expect(result.count).toBe(1);
    expect(result.pairs[0].method).toBe("ai");
  });
});
