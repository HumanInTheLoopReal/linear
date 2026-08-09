import { describe, expect, it } from "vitest";
import {
  isRefLabel,
  REF_LABEL_PREFIX,
  refLabelName,
  refValue,
} from "../../../src/common/external-ref.js";

describe("external-ref helpers (lin-qev5)", () => {
  it("builds a ref:<value> label name, trimming whitespace", () => {
    expect(refLabelName("gh-123")).toBe("ref:gh-123");
    expect(refLabelName("  jira-9  ")).toBe("ref:jira-9");
  });

  it("recognizes ref labels by prefix", () => {
    expect(isRefLabel("ref:gh-123")).toBe(true);
    expect(isRefLabel(REF_LABEL_PREFIX)).toBe(true);
    expect(isRefLabel("type:bug")).toBe(false);
    expect(isRefLabel("deferred-until:2026-06-01")).toBe(false);
  });

  it("extracts the reference value, or null for non-ref labels", () => {
    expect(refValue("ref:gh-123")).toBe("gh-123");
    expect(refValue("ref:")).toBe("");
    expect(refValue("area:api")).toBeNull();
  });
});
