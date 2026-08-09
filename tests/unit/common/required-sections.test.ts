import { describe, expect, it } from "vitest";
import {
  headingNeedle,
  REQUIRED_CREATE_SECTIONS,
  renderCreateValidationError,
  renderSkeleton,
  validateCreateDescription,
} from "../../../src/common/required-sections.js";

describe("headingNeedle", () => {
  it("strips the heading prefix at any depth and lower-cases", () => {
    expect(headingNeedle("## Context")).toBe("context");
    expect(headingNeedle("# Context")).toBe("context");
    expect(headingNeedle("###### Deep Heading")).toBe("deep heading");
  });
});

describe("validateCreateDescription", () => {
  it("flags every section of the default contract when empty", () => {
    expect(validateCreateDescription("")).toEqual([
      "## Context",
      "## Acceptance Criteria",
      "## Test Plan",
    ]);
  });

  it("passes when all sections are present (case-insensitive)", () => {
    const desc = "## context\nx\n## Acceptance Criteria\ny\n## TEST PLAN\nz";
    expect(validateCreateDescription(desc)).toEqual([]);
  });

  it("matches heading text as a substring, not a strict markdown parse", () => {
    const desc = "Context: why. Acceptance criteria: it works. Test plan: run.";
    expect(validateCreateDescription(desc)).toEqual([]);
  });

  it("checks only the sections it is given", () => {
    expect(
      validateCreateDescription("## Goal\n\nanswer X", [
        { heading: "## Goal", hint: "" },
      ]),
    ).toEqual([]);
  });
});

describe("renderSkeleton", () => {
  it("renders heading + hint comment for a custom section list", () => {
    const out = renderSkeleton([
      { heading: "## Goal", hint: "what question?" },
    ]);
    expect(out).toBe("## Goal\n\n<!-- what question? -->");
  });

  it("defaults to the built-in create sections", () => {
    const out = renderSkeleton();
    expect(out).toContain("## Context");
    expect(out).toContain("## Acceptance Criteria");
    expect(out).toContain("## Test Plan");
  });

  it("omits the comment for a hintless section (lin-0nh0)", () => {
    // Custom templates may have headings with no `<!-- hint -->`; render just
    // the heading rather than an empty `<!--  -->` comment.
    const out = renderSkeleton([{ heading: "## Notes", hint: "" }]);
    expect(out).toBe("## Notes");
  });
});

describe("renderCreateValidationError", () => {
  it("lists missing sections and a paste-able skeleton", () => {
    const body = renderCreateValidationError(["## Context", "## Test Plan"]);
    expect(body).toContain("required sections missing or empty:");
    expect(body).toContain("## Context");
    expect(body).toContain("## Test Plan");
    expect(body).toContain("Add these sections to the description");
  });

  it("annotates each missing heading with its hint", () => {
    const body = renderCreateValidationError(
      ["## Context"],
      REQUIRED_CREATE_SECTIONS,
    );
    expect(body).toContain(
      "  - ## Context (Why this work exists and what it enables. Link upstream: the parent goal, a spec heading, or the path the work lands at)",
    );
  });
});
