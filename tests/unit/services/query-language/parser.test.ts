import { describe, expect, it } from "vitest";
import {
  astToString,
  hasExplicitStatusFilter,
  parseQuery,
} from "../../../../src/services/query-language/parser.js";

describe("parser", () => {
  it("parses a simple comparison", () => {
    const ast = parseQuery("status=open");
    expect(ast).toMatchObject({
      kind: "comparison",
      field: "status",
      op: "=",
      value: "open",
    });
  });

  it("parses ANDed comparisons left-associative", () => {
    const ast = parseQuery("status=open AND priority<2");
    expect(astToString(ast)).toBe("(status=open AND priority<2)");
  });

  it("OR has lower precedence than AND", () => {
    // status=open AND priority<2 OR type=bug
    // should parse as ((status=open AND priority<2) OR type=bug)
    const ast = parseQuery("status=open AND priority<2 OR type=bug");
    expect(astToString(ast)).toBe("((status=open AND priority<2) OR type=bug)");
  });

  it("parens override precedence", () => {
    const ast = parseQuery("(status=open OR status=blocked) AND priority<2");
    expect(astToString(ast)).toBe(
      "((status=open OR status=blocked) AND priority<2)",
    );
  });

  it("NOT is right-associative and binds tighter than AND/OR", () => {
    const ast = parseQuery("NOT status=closed AND priority=0");
    expect(astToString(ast)).toBe("(NOT status=closed AND priority=0)");
  });

  it("rejects empty query", () => {
    expect(() => parseQuery("")).toThrow(/empty query/);
  });

  it("rejects missing operator", () => {
    expect(() => parseQuery("status open")).toThrow(
      /expected comparison operator/,
    );
  });

  it("rejects unbalanced parens", () => {
    expect(() => parseQuery("(status=open")).toThrow(/expected '\)'/);
  });

  it("lowercases field names but preserves value casing", () => {
    const ast = parseQuery("STATUS=Open");
    expect(ast).toMatchObject({ field: "status", value: "Open" });
  });

  it("hasExplicitStatusFilter recurses through compound nodes", () => {
    expect(hasExplicitStatusFilter(parseQuery("priority>1"))).toBe(false);
    expect(
      hasExplicitStatusFilter(parseQuery("priority>1 AND status=open")),
    ).toBe(true);
    expect(
      hasExplicitStatusFilter(
        parseQuery("(priority<2 OR type=bug) AND NOT status=closed"),
      ),
    ).toBe(true);
  });
});
