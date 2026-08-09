import { describe, expect, it } from "vitest";
import {
  appendSection,
  getSection,
  replaceSection,
} from "../../../src/common/markdown-sections.js";

const NOTES = "## Notes";
const DESIGN = "## Design";

describe("getSection", () => {
  it("returns the trimmed body when the section is present", () => {
    const doc = ["Intro paragraph.", "", NOTES, "", "first note line", ""].join(
      "\n",
    );
    expect(getSection(doc, NOTES)).toBe("first note line");
  });

  it("captures everything up to the next `## ` heading", () => {
    const doc = [
      NOTES,
      "note body line 1",
      "note body line 2",
      "",
      DESIGN,
      "design line",
    ].join("\n");
    expect(getSection(doc, NOTES)).toBe("note body line 1\nnote body line 2");
  });

  it("returns empty string when the section is absent", () => {
    expect(getSection("just an intro", NOTES)).toBe("");
  });

  it("returns empty string when the section is present but empty", () => {
    const doc = [NOTES, "", DESIGN, "design body"].join("\n");
    expect(getSection(doc, NOTES)).toBe("");
  });
});

describe("replaceSection", () => {
  it("swaps in a new body when the section exists", () => {
    const doc = ["Intro.", "", NOTES, "old note"].join("\n");
    const result = replaceSection(doc, NOTES, "new note");
    expect(result).toBe(`Intro.\n\n${NOTES}\n\nnew note`);
  });

  it("appends a new section when absent and body is non-empty", () => {
    const result = replaceSection("Intro.", NOTES, "first note");
    expect(result).toBe(`Intro.\n\n${NOTES}\n\nfirst note`);
  });

  it("is a no-op when section is absent and body is empty", () => {
    expect(replaceSection("Intro.", NOTES, "   \n  ")).toBe("Intro.");
  });

  it("removes the heading entirely when section exists and body is cleared", () => {
    const doc = [
      "Intro.",
      "",
      NOTES,
      "old note",
      "",
      DESIGN,
      "design body",
    ].join("\n");
    const result = replaceSection(doc, NOTES, "");
    expect(result).toBe(`Intro.\n\n${DESIGN}\ndesign body`);
  });

  it("seeds the document with only the section when starting from empty", () => {
    expect(replaceSection("", NOTES, "first")).toBe(`${NOTES}\n\nfirst`);
  });

  it("preserves other sections when editing a middle one", () => {
    const doc = [
      "Intro.",
      "",
      DESIGN,
      "design body",
      "",
      NOTES,
      "note body",
      "",
      "## Acceptance Criteria",
      "ac body",
    ].join("\n");
    const result = replaceSection(doc, NOTES, "rewritten note");
    expect(result).toBe(
      [
        "Intro.",
        "",
        DESIGN,
        "design body",
        "",
        NOTES,
        "",
        "rewritten note",
        "",
        "## Acceptance Criteria",
        "ac body",
      ].join("\n"),
    );
  });
});

describe("appendSection (--append-notes)", () => {
  it("joins the addition to existing body with a blank-line separator", () => {
    const doc = ["Intro.", "", NOTES, "first note"].join("\n");
    const result = appendSection(doc, NOTES, "second note");
    expect(getSection(result, NOTES)).toBe("first note\n\nsecond note");
  });

  it("creates the section when absent", () => {
    const result = appendSection("Intro.", NOTES, "first note");
    expect(result).toBe(`Intro.\n\n${NOTES}\n\nfirst note`);
  });

  it("is a no-op when the addition is empty/whitespace", () => {
    const doc = ["Intro.", "", NOTES, "first note"].join("\n");
    expect(appendSection(doc, NOTES, "   \n ")).toBe(doc);
  });

  it("preserves sibling sections when appending to a middle one", () => {
    const doc = [
      DESIGN,
      "design body",
      "",
      NOTES,
      "note one",
      "",
      "## Acceptance Criteria",
      "ac body",
    ].join("\n");
    const result = appendSection(doc, NOTES, "note two");
    expect(getSection(result, DESIGN)).toBe("design body");
    expect(getSection(result, NOTES)).toBe("note one\n\nnote two");
    expect(getSection(result, "## Acceptance Criteria")).toBe("ac body");
  });
});
