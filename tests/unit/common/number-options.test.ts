import { describe, expect, it } from "vitest";
import {
  parseEstimateOption,
  parsePriorityOption,
} from "../../../src/common/number-options.js";

describe("parsePriorityOption", () => {
  it("parses valid priorities", () => {
    expect(parsePriorityOption("1")).toBe(1);
    expect(parsePriorityOption("4")).toBe(4);
  });

  it("parses P1-P4 shorthand by stripping the prefix", () => {
    expect(parsePriorityOption("P1")).toBe(1);
    expect(parsePriorityOption("p4")).toBe(4);
  });

  it("rejects P0 because Linear's 0 means 'No priority'", () => {
    expect(() => parsePriorityOption("P0")).toThrow(
      "Invalid --priority: must be 1-4 (or P1-P4); Linear's 0 means 'No priority' and is set by omitting --priority",
    );
  });

  it("throws for non-numeric priority", () => {
    expect(() => parsePriorityOption("abc")).toThrow(
      "Invalid --priority: must be 1-4 (or P1-P4); Linear's 0 means 'No priority' and is set by omitting --priority",
    );
  });

  it("throws for out-of-range priority", () => {
    expect(() => parsePriorityOption("0")).toThrow(
      "Invalid --priority: must be 1-4 (or P1-P4); Linear's 0 means 'No priority' and is set by omitting --priority",
    );
    expect(() => parsePriorityOption("5")).toThrow(
      "Invalid --priority: must be 1-4 (or P1-P4); Linear's 0 means 'No priority' and is set by omitting --priority",
    );
  });

  it("throws for malformed priority values", () => {
    expect(() => parsePriorityOption("1abc")).toThrow(
      "Invalid --priority: must be 1-4 (or P1-P4); Linear's 0 means 'No priority' and is set by omitting --priority",
    );
    expect(() => parsePriorityOption("1.5")).toThrow(
      "Invalid --priority: must be 1-4 (or P1-P4); Linear's 0 means 'No priority' and is set by omitting --priority",
    );
  });
});

describe("parseEstimateOption", () => {
  it("parses valid estimates", () => {
    expect(parseEstimateOption("0")).toBe(0);
    expect(parseEstimateOption("3")).toBe(3);
  });

  it("throws for non-numeric estimate", () => {
    expect(() => parseEstimateOption("abc")).toThrow(
      "Invalid --estimate: must be a non-negative integer",
    );
  });

  it("throws for negative estimate", () => {
    expect(() => parseEstimateOption("-1")).toThrow(
      "Invalid --estimate: must be a non-negative integer",
    );
  });

  it("throws for malformed estimate values", () => {
    expect(() => parseEstimateOption("3days")).toThrow(
      "Invalid --estimate: must be a non-negative integer",
    );
    expect(() => parseEstimateOption("2.0")).toThrow(
      "Invalid --estimate: must be a non-negative integer",
    );
  });
});
