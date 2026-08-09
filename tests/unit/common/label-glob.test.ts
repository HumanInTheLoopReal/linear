import { describe, expect, it } from "vitest";
import {
  globToLabelFilter,
  isLabelGlob,
  LabelGlobError,
} from "../../../src/common/label-glob.js";

describe("isLabelGlob", () => {
  it("detects `*` and `?` wildcards", () => {
    expect(isLabelGlob("type:*")).toBe(true);
    expect(isLabelGlob("*-debt")).toBe(true);
    expect(isLabelGlob("a?b")).toBe(true);
  });

  it("treats plain label names as non-globs", () => {
    expect(isLabelGlob("type:bug")).toBe(false);
    expect(isLabelGlob("deferred")).toBe(false);
  });
});

describe("globToLabelFilter (lin-ym1m)", () => {
  it("maps a trailing-star prefix glob to server-side startsWith via `some`", () => {
    expect(globToLabelFilter("type:*")).toEqual({
      labels: { some: { name: { startsWith: "type:" } } },
    });
  });

  it("maps a leading-star suffix glob to endsWith", () => {
    expect(globToLabelFilter("*-debt")).toEqual({
      labels: { some: { name: { endsWith: "-debt" } } },
    });
  });

  it("maps a both-ends glob to contains", () => {
    expect(globToLabelFilter("*debt*")).toEqual({
      labels: { some: { name: { contains: "debt" } } },
    });
  });

  it("negates a prefix glob to `every` + notStartsWith (set complement, zero-label issues pass)", () => {
    expect(globToLabelFilter("type:*", true)).toEqual({
      labels: { every: { name: { notStartsWith: "type:" } } },
    });
  });

  it("negates suffix and contains globs to notEndsWith / notContains under `every`", () => {
    expect(globToLabelFilter("*-debt", true)).toEqual({
      labels: { every: { name: { notEndsWith: "-debt" } } },
    });
    expect(globToLabelFilter("*debt*", true)).toEqual({
      labels: { every: { name: { notContains: "debt" } } },
    });
  });

  it("rejects the single-char `?` wildcard (no Linear equivalent)", () => {
    expect(() => globToLabelFilter("type:?")).toThrow(LabelGlobError);
    expect(() => globToLabelFilter("a?b")).toThrow(/has no Linear equivalent/);
  });

  it("rejects interior and multi-star globs", () => {
    expect(() => globToLabelFilter("a*b")).toThrow(LabelGlobError);
    expect(() => globToLabelFilter("*a*b*")).toThrow(/interior or multi/);
    expect(() => globToLabelFilter("a*b*c")).toThrow(LabelGlobError);
  });

  it("rejects an empty pattern (bare `*` / `**`)", () => {
    expect(() => globToLabelFilter("*")).toThrow(/empty pattern|prefix/);
    expect(() => globToLabelFilter("**")).toThrow(/empty pattern/);
  });
});
