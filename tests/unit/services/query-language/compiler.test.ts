import { describe, expect, it } from "vitest";
import {
  compile,
  UnsupportedFieldError,
  UnsupportedQueryError,
} from "../../../../src/services/query-language/compiler.js";
import { parseQuery } from "../../../../src/services/query-language/parser.js";

const FIXED_NOW = new Date("2026-05-12T00:00:00.000Z");

function compileExpr(expr: string) {
  return compile(parseQuery(expr), FIXED_NOW).filter;
}

describe("compiler — status mapping", () => {
  it("maps status=open to state.type IN [triage,backlog,unstarted]", () => {
    expect(compileExpr("status=open")).toEqual({
      state: { type: { in: ["triage", "backlog", "unstarted"] } },
    });
  });

  it("maps status=in_progress to state.type=started", () => {
    expect(compileExpr("status=in_progress")).toEqual({
      state: { type: { in: ["started"] } },
    });
  });

  it("maps status=closed to all terminal types", () => {
    expect(compileExpr("status=closed")).toEqual({
      state: { type: { in: ["completed", "canceled", "duplicate"] } },
    });
  });

  it("maps status=blocked to hasBlockedByRelations.eq=true", () => {
    expect(compileExpr("status=blocked")).toEqual({
      hasBlockedByRelations: { eq: true },
    });
  });

  it("maps status=deferred to label match (Linear-Hack)", () => {
    expect(compileExpr("status=deferred")).toEqual({
      labels: { name: { eq: "deferred" } },
    });
  });

  it("inverts with !=", () => {
    expect(compileExpr("status!=open")).toEqual({
      state: { type: { nin: ["triage", "backlog", "unstarted"] } },
    });
  });
});

describe("compiler — priority", () => {
  it("maps priority comparisons to NullableNumberComparator", () => {
    expect(compileExpr("priority=1")).toEqual({ priority: { eq: 1 } });
    expect(compileExpr("priority!=2")).toEqual({ priority: { neq: 2 } });
    expect(compileExpr("priority<2")).toEqual({ priority: { lt: 2 } });
    expect(compileExpr("priority<=2")).toEqual({ priority: { lte: 2 } });
    expect(compileExpr("priority>1")).toEqual({ priority: { gt: 1 } });
    expect(compileExpr("priority>=1")).toEqual({ priority: { gte: 1 } });
  });
});

describe("compiler — type, label, assignee", () => {
  it("type compiles to type:<value> label (Linear-Hack)", () => {
    expect(compileExpr("type=bug")).toEqual({
      labels: { name: { eq: "type:bug" } },
    });
  });

  it("label=none maps to labels.length.eq=0", () => {
    expect(compileExpr("label=none")).toEqual({
      labels: { length: { eq: 0 } },
    });
  });

  it("label=type:* compiles to a server-side startsWith glob (lin-ym1m)", () => {
    expect(compileExpr("label=type:*")).toEqual({
      labels: { some: { name: { startsWith: "type:" } } },
    });
  });

  it("label!=type:* negates via every/notStartsWith (lin-ym1m)", () => {
    expect(compileExpr("label!=type:*")).toEqual({
      labels: { every: { name: { notStartsWith: "type:" } } },
    });
  });

  it("label=*-debt and label=*debt* map to endsWith / contains (lin-ym1m)", () => {
    expect(compileExpr("label=*-debt")).toEqual({
      labels: { some: { name: { endsWith: "-debt" } } },
    });
    expect(compileExpr("label=*debt*")).toEqual({
      labels: { some: { name: { contains: "debt" } } },
    });
  });

  it("rejects an interior/complex label glob with a query error (lin-ym1m)", () => {
    expect(() => compileExpr("label=a*b")).toThrow(/interior or multi/);
  });

  it("assignee=none maps to assignee.null=true", () => {
    expect(compileExpr("assignee=none")).toEqual({
      assignee: { null: true },
    });
  });

  it("assignee=Alice maps to assignee.displayName.eq", () => {
    expect(compileExpr("assignee=Alice")).toEqual({
      assignee: { displayName: { eq: "Alice" } },
    });
  });
});

describe("compiler — title, id, parent", () => {
  it("title compiles to containsIgnoreCase", () => {
    expect(compileExpr("title=auth")).toEqual({
      title: { containsIgnoreCase: "auth" },
    });
  });

  it("id compiles to id.eq", () => {
    expect(compileExpr("id=ABC-123")).toEqual({
      id: { eq: "ABC-123" },
    });
  });

  it("parent compiles to parent.id.eq", () => {
    expect(compileExpr("parent=ABC-1")).toEqual({
      parent: { id: { eq: "ABC-1" } },
    });
  });
});

describe("compiler — description=none (lin-97ar)", () => {
  // An empty description matches `(IS NULL OR = '')`. The Linear
  // compiler must mirror BOTH halves, not just the null check, or blank
  // bodies silently slip through.
  it("description=none matches null OR empty string", () => {
    expect(compileExpr("description=none")).toEqual({
      or: [{ description: { null: true } }, { description: { eq: "" } }],
    });
  });

  it("description!=none matches non-null AND non-empty", () => {
    expect(compileExpr("description!=none")).toEqual({
      and: [{ description: { null: false } }, { description: { neq: "" } }],
    });
  });

  it("a non-'none' description value still compiles to containsIgnoreCase", () => {
    expect(compileExpr("description=auth")).toEqual({
      description: { containsIgnoreCase: "auth" },
    });
  });
});

describe("compiler — dates", () => {
  it("translates duration to gte ISO timestamp", () => {
    const filter = compileExpr("updated>7d") as {
      updatedAt: { gte: string };
    };
    const expected = new Date(
      FIXED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(filter.updatedAt.gte).toBe(expected);
  });

  it("translates absolute date (quoted) to gte/lte", () => {
    expect(compileExpr('created>="2026-01-15"')).toEqual({
      createdAt: { gte: "2026-01-15T00:00:00.000Z" },
    });
  });
});

describe("compiler — boolean combinators", () => {
  it("AND compiles to filter.and array", () => {
    expect(compileExpr("status=open AND priority=1")).toEqual({
      and: [
        { state: { type: { in: ["triage", "backlog", "unstarted"] } } },
        { priority: { eq: 1 } },
      ],
    });
  });

  it("OR compiles to filter.or array", () => {
    const filter = compileExpr("status=open OR status=blocked");
    expect(filter).toEqual({
      or: [
        { state: { type: { in: ["triage", "backlog", "unstarted"] } } },
        { hasBlockedByRelations: { eq: true } },
      ],
    });
  });

  it("NOT on a leaf comparison inverts the operator", () => {
    expect(compileExpr("NOT status=closed")).toEqual({
      state: {
        type: { nin: ["completed", "canceled", "duplicate"] },
      },
    });
  });

  it("NOT on compound nodes is unsupported", () => {
    expect(() => compileExpr("NOT (status=open AND priority=1)")).toThrow(
      UnsupportedQueryError,
    );
  });
});

describe("compiler — metadata.<key> client-side filter (lin-ov30.1)", () => {
  function compileFull(expr: string) {
    return compile(parseQuery(expr), FIXED_NOW);
  }
  function desc(metadata: Record<string, unknown> | null): string {
    const body = "## Context\nbody";
    if (!metadata) return body;
    return `${body}\n\n\`\`\`metadata\n${JSON.stringify(metadata)}\n\`\`\``;
  }

  it("strips a bare metadata leaf to an empty server filter + one predicate", () => {
    const { filter, metadataPredicates } = compileFull("metadata.sprint=12");
    expect(filter).toEqual({});
    expect(metadataPredicates).toHaveLength(1);
  });

  it("matches a value stored as a number OR a string (stringified compare)", () => {
    const [p] = compileFull("metadata.sprint=12").metadataPredicates;
    expect(p(desc({ sprint: 12 }))).toBe(true);
    expect(p(desc({ sprint: "12" }))).toBe(true);
    expect(p(desc({ sprint: 13 }))).toBe(false);
    expect(p(desc(null))).toBe(false);
  });

  it("!= inverts the match (and matches issues lacking the key)", () => {
    const [p] = compileFull("metadata.sprint!=12").metadataPredicates;
    expect(p(desc({ sprint: 12 }))).toBe(false);
    expect(p(desc({ sprint: 13 }))).toBe(true);
    expect(p(desc(null))).toBe(true);
  });

  it("=* tests key existence; =none tests key absence", () => {
    const [exists] = compileFull("metadata.run=*").metadataPredicates;
    expect(exists(desc({ run: "abc" }))).toBe(true);
    expect(exists(desc({ other: 1 }))).toBe(false);
    const [absent] = compileFull("metadata.run=none").metadataPredicates;
    expect(absent(desc({ other: 1 }))).toBe(true);
    expect(absent(desc({ run: "abc" }))).toBe(false);
  });

  it("preserves the original case of the metadata key", () => {
    const [p] = compileFull("metadata.agentRunId=x").metadataPredicates;
    expect(p(desc({ agentRunId: "x" }))).toBe(true);
    expect(p(desc({ agentrunid: "x" }))).toBe(false); // case-sensitive
  });

  it("combines with a server filter under AND (filter compiles, predicate kept)", () => {
    const { filter, metadataPredicates } = compileFull(
      "status=open AND metadata.sprint=12",
    );
    expect(filter).toEqual({
      state: { type: { in: ["triage", "backlog", "unstarted"] } },
    });
    expect(metadataPredicates).toHaveLength(1);
  });

  it("supports leaf-NOT via predicate inversion", () => {
    const [p] = compileFull("NOT metadata.sprint=12").metadataPredicates;
    expect(p(desc({ sprint: 12 }))).toBe(false);
    expect(p(desc({ sprint: 13 }))).toBe(true);
  });

  it("rejects metadata combined with OR", () => {
    expect(() => compileFull("status=open OR metadata.sprint=12")).toThrow(
      UnsupportedQueryError,
    );
  });

  it("rejects ordering operators on a metadata field", () => {
    expect(() => compileFull("metadata.sprint>12")).toThrow(
      UnsupportedQueryError,
    );
  });
});

describe("compiler — error surfaces", () => {
  it("rejects unsupported fields", () => {
    expect(() => compileExpr("owner=alice")).toThrow(UnsupportedFieldError);
    expect(() => compileExpr("notes=foo")).toThrow(UnsupportedFieldError);
    expect(() => compileExpr("pinned=true")).toThrow(UnsupportedFieldError);
  });

  it("rejects unknown fields", () => {
    expect(() => compileExpr("nope=1")).toThrow(UnsupportedFieldError);
  });

  it("rejects non-equality on equality-only fields", () => {
    expect(() => compileExpr("status<open")).toThrow(UnsupportedQueryError);
    expect(() => compileExpr("type>bug")).toThrow(UnsupportedQueryError);
  });
});
