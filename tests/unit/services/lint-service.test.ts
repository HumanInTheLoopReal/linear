import { beforeEach, describe, expect, it, vi } from "vitest";

// The section contract is composed from the active create template, which is
// read through config-store. Mock it so these tests never depend on the
// developer's `~/.linear/config.json` or a repo-local `.linear/config.json`.
vi.mock("../../../src/common/config-store.js", () => ({
  getConfig: vi.fn(() => ({
    key: "template.create",
    value: null,
    found: false,
    source: "default",
  })),
}));

import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { getConfig } from "../../../src/common/config-store.js";
import type { IssueLintFieldsFragment } from "../../../src/gql/graphql.js";
import {
  appendMissingSections,
  buildLintFixes,
  buildLintSummary,
  deriveTypeFromLabels,
  getIssueForLint,
  lintIssue,
  REQUIRED_SECTIONS_BY_TYPE,
  resolveRequiredSections,
  resolveTypeRequirements,
  sectionsForType,
} from "../../../src/services/lint-service.js";

/**
 * Drive the two config keys the contract is composed from: the universal
 * template and the per-type overrides. `null` leaves a key unset.
 */
function setConfig(opts: { template?: string | null; types?: unknown }) {
  const { template = null, types = null } = opts;
  vi.mocked(getConfig).mockImplementation((key: string) => {
    if (key === "template.create" && template !== null) {
      return { key, value: template, found: true, source: "local" };
    }
    if (key === "template.required-sections-by-type" && types !== null) {
      return {
        key,
        value: typeof types === "string" ? types : JSON.stringify(types),
        found: true,
        source: "local",
      };
    }
    return { key, value: null, found: false, source: "default" };
  });
}

function setTemplate(template: string | null) {
  setConfig({ template });
}

function makeIssue(
  type: string | null,
  description: string,
  overrides: Partial<IssueLintFieldsFragment> = {},
): IssueLintFieldsFragment {
  const labels = type
    ? { nodes: [{ id: `l-${type}`, name: `type:${type}` }] }
    : { nodes: [] };
  return {
    id: "issue-1",
    identifier: "TES-1",
    title: "example",
    description,
    labels,
    ...overrides,
  };
}

const headings = (type: string | null) =>
  resolveRequiredSections(type).map((s) => s.heading);

beforeEach(() => {
  vi.clearAllMocks();
  setTemplate(null); // unset -> built-in default template
});

describe("deriveTypeFromLabels", () => {
  it("returns the suffix after the first type: label", () => {
    expect(deriveTypeFromLabels([{ name: "type:bug" }])).toBe("bug");
    expect(
      deriveTypeFromLabels([{ name: "other" }, { name: "type:feature" }]),
    ).toBe("feature");
  });

  it("returns null when no type:* label is present", () => {
    expect(deriveTypeFromLabels([{ name: "other" }])).toBeNull();
    expect(deriveTypeFromLabels([])).toBeNull();
  });
});

describe("resolveRequiredSections — the shared contract", () => {
  // The table the create gate and the lint both answer to. The template owns
  // the universal sections (## Context / ## Test Plan) and the type-specific
  // block is substituted for the template's slot (## Acceptance Criteria).
  const TABLE: Record<string, string[]> = {
    epic: ["## Context", "## Success Criteria", "## Test Plan"],
    task: ["## Context", "## Acceptance Criteria", "## Test Plan"],
    feature: ["## Context", "## Acceptance Criteria", "## Test Plan"],
    story: ["## Context", "## Acceptance Criteria", "## Test Plan"],
    bug: [
      "## Context",
      "## Steps to Reproduce",
      "## Acceptance Criteria",
      "## Test Plan",
    ],
    chore: ["## Context", "## Acceptance Criteria", "## Test Plan"],
    decision: [
      "## Context",
      "## Decision",
      "## Consequences",
      "## Alternatives",
      "## Revisit when",
      "## Test Plan",
    ],
    spike: ["## Context", "## Goal", "## Findings", "## Test Plan"],
  };

  it("no built-in type block names a universal heading", () => {
    // The template owns ## Context and the verification section. If a built-in
    // block named either, a repo could not rename them by editing its template.
    for (const [type, spec] of Object.entries(REQUIRED_SECTIONS_BY_TYPE)) {
      for (const section of spec.sections) {
        expect(
          ["## Context", "## Test Plan"],
          `${type} must not name a universal section`,
        ).not.toContain(section.heading);
      }
      expect(
        spec.exempt,
        `${type} must not hardcode a universal heading`,
      ).toBeUndefined();
    }
  });

  for (const [type, expected] of Object.entries(TABLE)) {
    it(`${type} requires ${expected.join(" · ")}`, () => {
      expect(headings(type)).toEqual(expected);
    });
  }

  it("holds an untyped issue to the template verbatim", () => {
    expect(headings(null)).toEqual([
      "## Context",
      "## Acceptance Criteria",
      "## Test Plan",
    ]);
  });

  it("gives an unknown type the universal sections only", () => {
    expect(headings("custom-thing")).toEqual(["## Context", "## Test Plan"]);
  });

  it("carries the type-specific hints through", () => {
    expect(resolveRequiredSections("epic")).toContainEqual({
      heading: "## Success Criteria",
      hint: "The outcome this area delivers, one level above its children. Every child task moves one of these; none of them completes it alone",
    });
  });

  it("substitutes the slot wherever the template puts it", () => {
    setTemplate("## Test Plan\n## Acceptance Criteria\n## Context");
    expect(headings("epic")).toEqual([
      "## Test Plan",
      "## Success Criteria",
      "## Context",
    ]);
  });

  it("appends the type block when the template has no type slot", () => {
    setTemplate("## Context\n## Test Plan");
    expect(headings("epic")).toEqual([
      "## Context",
      "## Test Plan",
      "## Success Criteria",
    ]);
  });

  it("keeps a verification section a type is not exempt from", () => {
    setTemplate("## Context\n## Acceptance Criteria\n## Verification");
    expect(headings("spike")).toEqual([
      "## Context",
      "## Goal",
      "## Findings",
      "## Verification",
    ]);
  });
});

describe("resolveRequiredSections — per-type config overrides", () => {
  // The six-section ADR shape a repo may run instead of the CLI's generic
  // decision block: `## Test` (not `## Test Plan`) plus an exemption from the
  // template's verification section.
  const ADR = {
    decision: {
      sections: [
        { heading: "## Decision", hint: "one sentence, imperative" },
        "## Consequences",
        "## Alternatives",
        "## Revisit when",
        "## Test",
      ],
      exempt: ["## Test Plan"],
    },
  };

  it("composes an override with the universal template sections", () => {
    setConfig({ types: ADR });
    expect(headings("decision")).toEqual([
      "## Context",
      "## Decision",
      "## Consequences",
      "## Alternatives",
      "## Revisit when",
      "## Test",
    ]);
  });

  it("does not leak the override into any other type", () => {
    setConfig({ types: ADR });
    expect(headings("epic")).toEqual([
      "## Context",
      "## Success Criteria",
      "## Test Plan",
    ]);
    expect(headings("task")).toEqual([
      "## Context",
      "## Acceptance Criteria",
      "## Test Plan",
    ]);
    expect(headings("spike")).toEqual([
      "## Context",
      "## Goal",
      "## Findings",
      "## Test Plan",
    ]);
    expect(headings("chore")).toEqual([
      "## Context",
      "## Acceptance Criteria",
      "## Test Plan",
    ]);
    expect(headings(null)).toEqual([
      "## Context",
      "## Acceptance Criteria",
      "## Test Plan",
    ]);
  });

  it("replaces the built-in block outright, exemptions included", () => {
    // An override with no `exempt` keeps every universal section.
    setConfig({ types: { decision: ["## Decision"] } });
    expect(headings("decision")).toEqual([
      "## Context",
      "## Decision",
      "## Test Plan",
    ]);
  });

  it("carries override hints into the resolved sections", () => {
    setConfig({ types: ADR });
    expect(resolveRequiredSections("decision")).toContainEqual({
      heading: "## Decision",
      hint: "one sentence, imperative",
    });
  });

  it("can add a contract for a type the CLI has no built-in block for", () => {
    setConfig({ types: { experiment: ["## Checklist"] } });
    expect(headings("experiment")).toEqual([
      "## Context",
      "## Checklist",
      "## Test Plan",
    ]);
  });

  it("can empty a type's block so only the universal sections remain", () => {
    setConfig({ types: { epic: [] } });
    expect(headings("epic")).toEqual(["## Context", "## Test Plan"]);
  });

  it("composes an override against a custom universal template", () => {
    setConfig({
      template: "## Background\n## Acceptance Criteria\n## Verification",
      types: { decision: ["## Decision", "## Consequences"] },
    });
    expect(headings("decision")).toEqual([
      "## Background",
      "## Decision",
      "## Consequences",
      "## Verification",
    ]);
  });

  it("ignores a malformed override rather than changing the contract", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    setConfig({ types: "{not json" });
    expect(headings("decision")).toEqual([
      "## Context",
      "## Decision",
      "## Consequences",
      "## Alternatives",
      "## Revisit when",
      "## Test Plan",
    ]);
  });
});

describe("renaming a universal section in the template", () => {
  // A repo standardizing on `## Test` instead of `## Test Plan` edits its
  // template markdown only: nothing per-type mentions the verification section,
  // so every type follows automatically.
  const TEMPLATE = "## Context\n## Acceptance Criteria\n## Test";

  it("propagates to every type with no per-type override", () => {
    setTemplate(TEMPLATE);
    expect(headings("epic")).toEqual([
      "## Context",
      "## Success Criteria",
      "## Test",
    ]);
    expect(headings("task")).toEqual([
      "## Context",
      "## Acceptance Criteria",
      "## Test",
    ]);
    expect(headings("bug")).toEqual([
      "## Context",
      "## Steps to Reproduce",
      "## Acceptance Criteria",
      "## Test",
    ]);
    expect(headings("chore")).toEqual([
      "## Context",
      "## Acceptance Criteria",
      "## Test",
    ]);
    expect(headings("spike")).toEqual([
      "## Context",
      "## Goal",
      "## Findings",
      "## Test",
    ]);
  });

  it("stops demanding the old heading anywhere", () => {
    setTemplate(TEMPLATE);
    for (const type of Object.keys(REQUIRED_SECTIONS_BY_TYPE)) {
      expect(headings(type)).not.toContain("## Test Plan");
    }
  });

  it("lints a body that uses the renamed heading", () => {
    setTemplate(TEMPLATE);
    expect(
      lintIssue(
        makeIssue(
          "epic",
          "## Context\nc\n## Success Criteria\n- ships\n## Test\nnpm test",
        ),
      ),
    ).toBeNull();
  });

  it("composes the rename with a per-type override (six-section ADR)", () => {
    setConfig({
      template: TEMPLATE,
      types: {
        decision: [
          "## Decision",
          "## Consequences",
          "## Alternatives",
          "## Revisit when",
        ],
      },
    });
    expect(headings("decision")).toEqual([
      "## Context",
      "## Decision",
      "## Consequences",
      "## Alternatives",
      "## Revisit when",
      "## Test",
    ]);
  });
});

describe("resolveTypeRequirements", () => {
  it("reports the effective contract and marks overridden types", () => {
    setConfig({ types: { decision: ["## Decision"] } });
    const rows = resolveTypeRequirements(["epic", "decision"]);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          type: "epic",
          sections: ["## Context", "## Success Criteria", "## Test Plan"],
          overridden: false,
        },
        {
          type: "decision",
          sections: ["## Context", "## Decision", "## Test Plan"],
          overridden: true,
        },
      ]),
    );
  });

  it("includes override-only types the caller did not list", () => {
    setConfig({ types: { adr: ["## Decision"] } });
    expect(resolveTypeRequirements(["task"]).map((r) => r.type)).toContain(
      "adr",
    );
  });
});

describe("lintIssue", () => {
  it("flags an epic missing ## Success Criteria", () => {
    const r = lintIssue(
      makeIssue("epic", "## Context\nc\n## Test Plan\nnpm test"),
    );
    expect(r?.missing).toEqual(["## Success Criteria"]);
    expect(r?.warnings).toBe(1);
    expect(r?.type).toBe("epic");
  });

  it("passes an epic body that satisfies the epic contract", () => {
    expect(
      lintIssue(
        makeIssue(
          "epic",
          "## Context\nc\n## Success Criteria\n- ships\n## Test Plan\nnpm test",
        ),
      ),
    ).toBeNull();
  });

  it("does NOT ask an epic for ## Acceptance Criteria", () => {
    const r = lintIssue(makeIssue("epic", "body"));
    expect(r?.missing).not.toContain("## Acceptance Criteria");
  });

  it("flags a bug for both of its type-specific sections", () => {
    const r = lintIssue(
      makeIssue("bug", "## Context\nc\n## Test Plan\nnpm test"),
    );
    expect(r?.missing).toEqual([
      "## Steps to Reproduce",
      "## Acceptance Criteria",
    ]);
  });

  it("matches headings via substring (not strict markdown)", () => {
    const r = lintIssue(
      makeIssue(
        "bug",
        "Context: x. Steps to reproduce: open the form. Acceptance criteria: it works. Test plan: run it.",
      ),
    );
    expect(r).toBeNull();
  });

  for (const type of ["task", "feature", "story"]) {
    it(`flags missing 'Acceptance Criteria' for ${type}`, () => {
      const r = lintIssue(
        makeIssue(type, "## Context\nc\n## Test Plan\nnpm test"),
      );
      expect(r?.missing).toEqual(["## Acceptance Criteria"]);
    });
  }

  it("decision requires Decision / Consequences / Alternatives / Revisit when", () => {
    expect(lintIssue(makeIssue("decision", "## Context\nc"))?.missing).toEqual([
      "## Decision",
      "## Consequences",
      "## Alternatives",
      "## Revisit when",
      "## Test Plan",
    ]);
  });

  it("spike requires Goal / Findings", () => {
    expect(lintIssue(makeIssue("spike", "## Context\nc"))?.missing).toEqual([
      "## Goal",
      "## Findings",
      "## Test Plan",
    ]);
  });

  it("holds a chore to the same criteria section a task gets", () => {
    // Maintenance work has observable outcomes exactly like feature work does;
    // a type that asks for none produces tickets nobody can grade.
    expect(lintIssue(makeIssue("chore", "anything"))?.missing).toEqual([
      "## Context",
      "## Acceptance Criteria",
      "## Test Plan",
    ]);
    expect(
      lintIssue(
        makeIssue(
          "chore",
          "## Context\nc\n## Acceptance Criteria\n- [ ] done\n## Test Plan\nnpm test",
        ),
      ),
    ).toBeNull();
  });

  it("returns null when no type:* label is set", () => {
    expect(lintIssue(makeIssue(null, "anything"))).toBeNull();
  });
});

describe("buildLintSummary", () => {
  const FULL =
    "## Context\nc\n## Acceptance Criteria\n- [ ] done\n## Test Plan\nnpm test";

  it("aggregates total warnings across issues", () => {
    const summary = buildLintSummary([
      makeIssue("bug", FULL, { id: "a", identifier: "T-1" }),
      makeIssue("task", FULL, { id: "b", identifier: "T-2" }),
      makeIssue("chore", FULL, { id: "c", identifier: "T-3" }),
    ]);
    expect(summary.total).toBe(1); // 1 (bug: Steps to Reproduce) + 0 + 0
    expect(summary.issues).toBe(1);
    expect(summary.results.map((r) => r.id).sort()).toEqual(["a"]);
  });

  it("returns total=0 when all issues pass", () => {
    const summary = buildLintSummary([
      makeIssue("chore", FULL),
      makeIssue(null, "anything"),
    ]);
    expect(summary).toEqual({ total: 0, issues: 0, results: [] });
  });
});

describe("sectionsForType", () => {
  it("maps missing headings back to their RequiredSection (with hint)", () => {
    expect(sectionsForType("bug", ["## Steps to Reproduce"])).toEqual([
      {
        heading: "## Steps to Reproduce",
        hint: "The shortest path to seeing the failure, starting from a state a reader can reach",
      },
    ]);
  });

  it("resolves universal headings too, with the template's hints", () => {
    expect(sectionsForType("epic", ["## Test Plan"])).toEqual([
      {
        heading: "## Test Plan",
        hint: "The command that must go green, or a named human action. Never 'verify it works'",
      },
    ]);
  });

  it("ignores headings not required for the type", () => {
    expect(sectionsForType("task", ["## Nonexistent"])).toEqual([]);
    expect(sectionsForType("epic", ["## Acceptance Criteria"])).toEqual([]);
  });
});

describe("appendMissingSections", () => {
  it("appends placeholder sections while preserving existing content", () => {
    const out = appendMissingSections("Original body.", [
      { heading: "## Acceptance Criteria", hint: "verify it" },
    ]);
    expect(out).toContain("Original body.");
    expect(out).toContain("## Acceptance Criteria");
    expect(out).toContain("<!-- verify it -->");
  });

  it("is idempotent for a heading that already exists", () => {
    const existing = "## Acceptance Criteria\n\nalready here";
    const out = appendMissingSections(existing, [
      { heading: "## Acceptance Criteria", hint: "verify it" },
    ]);
    // replaceSection swaps the body, but the heading is not duplicated.
    expect(out.match(/## Acceptance Criteria/g)?.length).toBe(1);
  });
});

describe("buildLintFixes", () => {
  it("injects the per-type sections and satisfies a re-lint", () => {
    const fixes = buildLintFixes([
      makeIssue("bug", "no sections here"),
      makeIssue(
        "task",
        "## Context\nc\n## Acceptance Criteria\ndone\n## Test Plan\nnpm test",
      ), // already complete -> skipped
    ]);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].type).toBe("bug");
    expect(fixes[0].added).toEqual([
      "## Context",
      "## Steps to Reproduce",
      "## Acceptance Criteria",
      "## Test Plan",
    ]);
    // Every heading is now present, so nothing is MISSING. What remains is
    // that the skeleton has no content in it — which is the honest report,
    // because appending a heading is a prompt to write, not a fix.
    const relint = lintIssue(makeIssue("bug", fixes[0].description));
    expect(relint?.missing).toEqual([]);
    expect(relint?.empty).toEqual(fixes[0].added);
  });

  it("injects ## Success Criteria (never ## Acceptance Criteria) for an epic", () => {
    const fixes = buildLintFixes([makeIssue("epic", "just prose")]);
    expect(fixes[0].added).toEqual([
      "## Context",
      "## Success Criteria",
      "## Test Plan",
    ]);
    const relint = lintIssue(makeIssue("epic", fixes[0].description));
    expect(relint?.missing).toEqual([]);
    expect(relint?.empty).toEqual(fixes[0].added);
  });

  it("returns an empty list when nothing needs fixing", () => {
    expect(buildLintFixes([makeIssue(null, "untyped")])).toEqual([]);
  });

  it("injects the OVERRIDDEN sections, with their hints, not the built-ins", () => {
    setConfig({
      types: {
        decision: {
          sections: [
            { heading: "## Decision", hint: "one sentence, imperative" },
            "## Consequences",
          ],
          exempt: ["## Test Plan"],
        },
      },
    });
    const fixes = buildLintFixes([makeIssue("decision", "just prose")]);
    expect(fixes[0].added).toEqual([
      "## Context",
      "## Decision",
      "## Consequences",
    ]);
    expect(fixes[0].description).toContain("<!-- one sentence, imperative -->");
    expect(fixes[0].description).not.toContain("## Rationale");
    expect(fixes[0].description).not.toContain("## Test Plan");
    const relint = lintIssue(makeIssue("decision", fixes[0].description));
    expect(relint?.missing).toEqual([]);
    expect(relint?.empty).toEqual(fixes[0].added);
  });
});

describe("lint under an override", () => {
  const ADR_BODY =
    "## Context\nc\n## Decision\nd\n## Consequences\nx\n## Alternatives\ny\n## Revisit when\nz\n## Test\nstubs";

  beforeEach(() => {
    setConfig({
      types: {
        decision: {
          sections: [
            "## Decision",
            "## Consequences",
            "## Alternatives",
            "## Revisit when",
            "## Test",
          ],
          exempt: ["## Test Plan"],
        },
      },
    });
  });

  it("passes a body in the repo's shape that the built-in block would reject", () => {
    expect(lintIssue(makeIssue("decision", ADR_BODY))).toBeNull();
  });

  it("still flags a decision missing one of the overridden sections", () => {
    const r = lintIssue(
      makeIssue("decision", ADR_BODY.replace("## Revisit when\nz\n", "")),
    );
    expect(r?.missing).toEqual(["## Revisit when"]);
  });

  it("sectionsForType resolves the overridden headings", () => {
    expect(sectionsForType("decision", ["## Consequences"])).toEqual([
      { heading: "## Consequences", hint: "" },
    ]);
    expect(sectionsForType("decision", ["## Rationale"])).toEqual([]);
  });
});

describe("getIssueForLint", () => {
  it("fetches a pre-resolved issue UUID", async () => {
    const expected = makeIssue("task", "body");
    const client = {
      request: vi.fn().mockResolvedValue({ issue: expected }),
    } as unknown as GraphQLClient;

    const result = await getIssueForLint(client, "issue-1");

    expect(result).toEqual(expected);
    expect(client.request).toHaveBeenCalledWith(expect.anything(), {
      id: "issue-1",
    });
  });

  it("throws when the issue UUID does not exist", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ issue: null }),
    } as unknown as GraphQLClient;

    await expect(getIssueForLint(client, "missing-uuid")).rejects.toThrow(
      "issue not found: missing-uuid",
    );
  });
});
