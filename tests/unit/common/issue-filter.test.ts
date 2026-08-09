import { describe, expect, it } from "vitest";
import {
  logicalStatusAliases,
  mapLogicalStatus,
  parseCommaSeparated,
  validateDateRange,
  validateEstimate,
  validateFilterDependencies,
  validatePriority,
} from "../../../src/common/issue-filter.js";

describe("validatePriority", () => {
  it("accepts valid priorities 0-4", () => {
    for (const p of [0, 1, 2, 3, 4]) {
      expect(() => validatePriority(p)).not.toThrow();
    }
  });

  it("rejects priority below 0", () => {
    expect(() => validatePriority(-1)).toThrow("priority");
  });

  it("rejects priority above 4", () => {
    expect(() => validatePriority(5)).toThrow("priority");
  });

  it("rejects non-integer priority", () => {
    expect(() => validatePriority(1.5)).toThrow("priority");
  });
});

describe("validateEstimate", () => {
  it("accepts non-negative integers", () => {
    expect(() => validateEstimate(0)).not.toThrow();
    expect(() => validateEstimate(8)).not.toThrow();
  });

  it("rejects negative estimate", () => {
    expect(() => validateEstimate(-1)).toThrow("estimate");
  });

  it("rejects non-integer estimate", () => {
    expect(() => validateEstimate(2.5)).toThrow("estimate");
  });
});

describe("validateDateRange", () => {
  it("accepts valid range where after < before", () => {
    expect(() =>
      validateDateRange("2025-01-01", "2025-12-31", "due date"),
    ).not.toThrow();
  });

  it("rejects contradictory range where after >= before", () => {
    expect(() =>
      validateDateRange("2025-12-31", "2025-01-01", "due date"),
    ).toThrow("due date");
  });

  it("does nothing when only one bound is set", () => {
    expect(() =>
      validateDateRange("2025-01-01", undefined, "due date"),
    ).not.toThrow();
    expect(() =>
      validateDateRange(undefined, "2025-12-31", "due date"),
    ).not.toThrow();
  });

  it("does nothing when neither bound is set", () => {
    expect(() =>
      validateDateRange(undefined, undefined, "due date"),
    ).not.toThrow();
  });
});

describe("validateFilterDependencies", () => {
  it("throws when --status used without --team", () => {
    expect(() => validateFilterDependencies({ status: "In Progress" })).toThrow(
      "--team",
    );
  });

  it("allows --status with --team", () => {
    expect(() =>
      validateFilterDependencies({ status: "In Progress", team: "ENG" }),
    ).not.toThrow();
  });

  it("allows --status UUID without --team", () => {
    expect(() =>
      validateFilterDependencies({
        status: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).not.toThrow();
  });

  it("allows --status logical alias without --team (lin-zst6)", () => {
    expect(() => validateFilterDependencies({ status: "open" })).not.toThrow();
    expect(() =>
      validateFilterDependencies({ status: "closed" }),
    ).not.toThrow();
    expect(() =>
      validateFilterDependencies({ status: "in_progress" }),
    ).not.toThrow();
  });

  it("allows comma-separated logical aliases without --team (lin-zst6)", () => {
    expect(() =>
      validateFilterDependencies({ status: "open,active" }),
    ).not.toThrow();
  });

  it("requires --team when mixing a logical alias with a team-specific name (lin-zst6)", () => {
    expect(() =>
      validateFilterDependencies({ status: "open,Backlog" }),
    ).toThrow("--team");
  });

  it("throws when --cycle used without --team", () => {
    expect(() => validateFilterDependencies({ cycle: "Sprint 1" })).toThrow(
      "--team",
    );
  });

  it("allows --cycle with --team", () => {
    expect(() =>
      validateFilterDependencies({ cycle: "Sprint 1", team: "ENG" }),
    ).not.toThrow();
  });

  it("allows --cycle UUID without --team", () => {
    expect(() =>
      validateFilterDependencies({
        cycle: "550e8400-e29b-41d4-a716-446655440001",
      }),
    ).not.toThrow();
  });

  it("throws when --milestone used without --project", () => {
    expect(() => validateFilterDependencies({ milestone: "v1.0" })).toThrow(
      "--project",
    );
  });

  it("allows --milestone with --project", () => {
    expect(() =>
      validateFilterDependencies({ milestone: "v1.0", project: "MyProject" }),
    ).not.toThrow();
  });

  it("allows --milestone UUID without --project", () => {
    expect(() =>
      validateFilterDependencies({
        milestone: "550e8400-e29b-41d4-a716-446655440002",
      }),
    ).not.toThrow();
  });

  it("does nothing with no dependency flags", () => {
    expect(() => validateFilterDependencies({ team: "ENG" })).not.toThrow();
  });
});

describe("parseCommaSeparated", () => {
  it("splits comma-separated values and trims whitespace", () => {
    expect(parseCommaSeparated("a, b , c")).toEqual(["a", "b", "c"]);
  });

  it("returns single value as array", () => {
    expect(parseCommaSeparated("done")).toEqual(["done"]);
  });

  it("throws on empty segments", () => {
    expect(() => parseCommaSeparated("a,,b")).toThrow("empty");
  });

  it("throws on empty string", () => {
    expect(() => parseCommaSeparated("")).toThrow("empty");
  });

  it("throws on only whitespace segment", () => {
    expect(() => parseCommaSeparated("a, ,b")).toThrow("empty");
  });
});

describe("mapLogicalStatus (lin-zst6)", () => {
  it("maps open to the to-do bucket, separate from in_progress", () => {
    expect(mapLogicalStatus("open")).toEqual([
      "triage",
      "backlog",
      "unstarted",
    ]);
  });

  it("maps closed to every terminal type including duplicate", () => {
    expect(mapLogicalStatus("closed")).toEqual([
      "completed",
      "canceled",
      "duplicate",
    ]);
  });

  it("maps active and in_progress to started", () => {
    expect(mapLogicalStatus("active")).toEqual(["started"]);
    expect(mapLogicalStatus("in_progress")).toEqual(["started"]);
  });

  it("is case-insensitive", () => {
    expect(mapLogicalStatus("OPEN")).toEqual(mapLogicalStatus("open"));
    expect(mapLogicalStatus("In_Progress")).toEqual(["started"]);
  });

  it("returns null for unknown / team-specific names", () => {
    expect(mapLogicalStatus("Todo")).toBeNull();
    expect(mapLogicalStatus("Backlog")).toBeNull();
    expect(mapLogicalStatus("Done")).toBeNull();
    expect(mapLogicalStatus("In Progress")).toBeNull();
  });

  it("enumerates known aliases sorted", () => {
    expect(logicalStatusAliases()).toEqual([
      "active",
      "all",
      "closed",
      "in_progress",
      "open",
    ]);
  });
});
