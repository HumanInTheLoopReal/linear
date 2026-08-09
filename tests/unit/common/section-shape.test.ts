import { describe, expect, it } from "vitest";
import type { RequiredSection } from "../../../src/common/required-sections.js";
import {
  findEmptySections,
  normalizeSectionShape,
  renderShapeNotice,
  styleFor,
} from "../../../src/common/section-shape.js";

const CRITERIA: RequiredSection = {
  heading: "## Acceptance Criteria",
  hint: "",
};
const CONTEXT: RequiredSection = { heading: "## Context", hint: "" };
const TEST_PLAN: RequiredSection = { heading: "## Test Plan", hint: "" };
const ALTERNATIVES: RequiredSection = { heading: "## Alternatives", hint: "" };

const ALL = [CONTEXT, CRITERIA, TEST_PLAN];

/** Normalize and return just the resulting markdown. */
function shape(body: string, sections: RequiredSection[] = ALL): string {
  return normalizeSectionShape(body, sections).description;
}

describe("styleFor", () => {
  it("gives criteria sections checkboxes by heading alone", () => {
    // No `style` field anywhere — this is what makes a repo's own template
    // markdown, which carries only headings and hints, still get the right
    // treatment.
    expect(styleFor(CRITERIA)).toBe("checklist");
    expect(styleFor({ heading: "## Success Criteria", hint: "" })).toBe(
      "checklist",
    );
  });

  it("gives alternatives and consequences plain bullets", () => {
    expect(styleFor(ALTERNATIVES)).toBe("bullets");
    expect(styleFor({ heading: "## Consequences", hint: "" })).toBe("bullets");
  });

  it("leaves framing and verification sections as prose", () => {
    expect(styleFor(CONTEXT)).toBe("prose");
    expect(styleFor(TEST_PLAN)).toBe("prose");
    expect(styleFor({ heading: "## Decision", hint: "" })).toBe("prose");
  });

  it("matches regardless of heading depth or case", () => {
    expect(styleFor({ heading: "### acceptance criteria", hint: "" })).toBe(
      "checklist",
    );
  });

  it("lets an explicit style win over the heading default", () => {
    expect(styleFor({ ...CRITERIA, style: "prose" })).toBe("prose");
  });
});

describe("normalizeSectionShape — the repair the gate applies", () => {
  it("turns bare lines under a criteria section into checkboxes", () => {
    const out = shape(
      [
        "## Context",
        "",
        "why this exists",
        "",
        "## Acceptance Criteria",
        "",
        "The session list renders every session.",
        "Selecting one opens it.",
        "",
        "## Test Plan",
        "",
        "npm test",
      ].join("\n"),
    );
    expect(out).toContain("- [ ] The session list renders every session.");
    expect(out).toContain("- [ ] Selecting one opens it.");
  });

  it("leaves prose sections completely alone", () => {
    // The whole reason `prose` is the default: a body the author wrote on
    // purpose must survive a gate that only meant to fix a list.
    const out = shape(
      "## Context\n\nwhy this exists\nand a second line\n\n## Test Plan\n\nnpm test",
    );
    expect(out).toContain("why this exists\nand a second line");
    expect(out).toContain("## Test Plan\n\nnpm test");
    expect(out).not.toContain("- [ ]");
    expect(out).not.toContain("- npm test");
  });

  it("upgrades a plain bullet to a checkbox but never touches a real one", () => {
    const out = shape(
      "## Acceptance Criteria\n\n- already a bullet\n- [ ] already a box\n- [x] already ticked",
      [CRITERIA],
    );
    expect(out).toBe(
      "## Acceptance Criteria\n\n- [ ] already a bullet\n- [ ] already a box\n- [x] already ticked",
    );
  });

  it("converts a numbered list, since criteria are unordered claims", () => {
    const out = shape("## Acceptance Criteria\n\n1. first\n2. second", [
      CRITERIA,
    ]);
    expect(out).toBe("## Acceptance Criteria\n\n- [ ] first\n- [ ] second");
  });

  it("adds plain bullets, not checkboxes, to a bullets section", () => {
    const out = shape("## Alternatives\n\nrolled our own\nbought a service", [
      ALTERNATIVES,
    ]);
    expect(out).toBe("## Alternatives\n\n- rolled our own\n- bought a service");
  });

  it("leaves an existing bullet alone in a bullets section", () => {
    const body = "## Alternatives\n\n* starred\n1. numbered";
    expect(shape(body, [ALTERNATIVES])).toBe(body);
  });

  it("never marks a line inside a fenced code block", () => {
    const body = [
      "## Acceptance Criteria",
      "",
      "the command runs",
      "",
      "```sh",
      "npm run build",
      "rm -rf dist",
      "```",
    ].join("\n");
    const out = shape(body, [CRITERIA]);
    expect(out).toContain("- [ ] the command runs");
    expect(out).toContain("\nnpm run build\nrm -rf dist\n");
  });

  it("never marks table rows, quotes, or html", () => {
    const body = [
      "## Acceptance Criteria",
      "",
      "| a | b |",
      "| - | - |",
      "> quoted",
      "<br />",
      "<!-- a note -->",
    ].join("\n");
    expect(shape(body, [CRITERIA])).toBe(body);
  });

  it("treats an indented line as a continuation, not a new criterion", () => {
    const body =
      "## Acceptance Criteria\n\n- [ ] the list renders\n  even when empty";
    expect(shape(body, [CRITERIA])).toBe(body);
  });

  it("stops at the next heading of any depth", () => {
    const out = shape(
      "## Acceptance Criteria\n\ncriterion\n\n### Notes\n\nnot a criterion",
      [CRITERIA],
    );
    expect(out).toContain("- [ ] criterion");
    expect(out).toContain("\nnot a criterion");
    expect(out).not.toContain("- [ ] not a criterion");
  });

  it("ignores a heading that only appears inside a code fence", () => {
    const body = [
      "## Acceptance Criteria",
      "",
      "```md",
      "## Test Plan",
      "```",
      "a real criterion",
    ].join("\n");
    const out = shape(body, [CRITERIA, TEST_PLAN]);
    expect(out).toContain("- [ ] a real criterion");
    expect(out).toContain("```md\n## Test Plan\n```");
  });

  it("does nothing to a section the description does not contain", () => {
    const body = "## Context\n\nwhy";
    const result = normalizeSectionShape(body, ALL);
    expect(result.description).toBe(body);
    expect(result.changes).toEqual([]);
  });

  it("reports what it changed, and reports nothing when it changed nothing", () => {
    const dirty = normalizeSectionShape(
      "## Acceptance Criteria\n\nbare one\nbare two",
      [CRITERIA],
    );
    expect(dirty.changes).toEqual([
      { heading: "## Acceptance Criteria", style: "checklist", lines: 2 },
    ]);
    expect(renderShapeNotice(dirty.changes)).toBe(
      "formatted to match the template: ## Acceptance Criteria (2 lines → - [ ])",
    );

    const clean = normalizeSectionShape(
      "## Acceptance Criteria\n\n- [ ] fine",
      [CRITERIA],
    );
    expect(clean.changes).toEqual([]);
  });

  it("is idempotent", () => {
    const once = shape("## Acceptance Criteria\n\nbare", [CRITERIA]);
    expect(shape(once, [CRITERIA])).toBe(once);
  });

  it("tolerates CRLF input", () => {
    expect(shape("## Acceptance Criteria\r\n\r\nbare", [CRITERIA])).toBe(
      "## Acceptance Criteria\n\n- [ ] bare",
    );
  });
});

describe("normalizeSectionShape — markdown the repair must not damage", () => {
  it("does not let a short fence close a longer one", () => {
    // Four backticks is how a code sample containing a three-backtick fence is
    // written. A toggle would treat the inner fence as a close and start
    // marking the rest of the sample.
    const body = [
      "## Acceptance Criteria",
      "````md",
      "literal",
      "```",
      "still code",
      "````",
    ].join("\n");
    expect(shape(body, [CRITERIA])).toBe(body);
  });

  it("does not let a tilde fence close a backtick one", () => {
    const body = [
      "## Acceptance Criteria",
      "```md",
      "~~~",
      "still code",
      "```",
    ].join("\n");
    expect(shape(body, [CRITERIA])).toBe(body);
  });

  it("leaves a four-space indented code block alone", () => {
    const body =
      "## Acceptance Criteria\n\n- [ ] a claim\n\n    - literal sample";
    expect(shape(body, [CRITERIA])).toBe(body);
  });

  it("treats a lazy continuation as part of the claim above it", () => {
    // Markdown folds this into one list item, so marking the second line would
    // turn half a sentence into a criterion of its own.
    const body =
      "## Acceptance Criteria\n\n- [ ] result remains stable\neven after retry";
    expect(shape(body, [CRITERIA])).toBe(body);
  });

  it("still marks consecutive bare lines as separate claims", () => {
    // The other side of the continuation rule: neither line was a list item to
    // begin with, so neither continues anything.
    expect(
      shape("## Acceptance Criteria\n\nfirst claim\nsecond claim", [CRITERIA]),
    ).toBe("## Acceptance Criteria\n\n- [ ] first claim\n- [ ] second claim");
  });

  it("leaves a nested detail bullet unticked", () => {
    const body =
      "## Acceptance Criteria\n\n- [ ] the list renders\n  - even when empty";
    expect(shape(body, [CRITERIA])).toBe(body);
  });

  it("leaves an unterminated fence to be code", () => {
    const body = "## Acceptance Criteria\n\n```sh\nnpm run build";
    expect(shape(body, [CRITERIA])).toBe(body);
  });
});

describe("locating sections — the spellings a heading comes in", () => {
  it("finds a setext heading and judges its body", () => {
    const body = [
      "Context",
      "=======",
      "",
      "why this exists",
      "",
      "Test Plan",
      "---------",
      "",
    ].join("\n");
    expect(findEmptySections(body, ALL)).toEqual(["## Test Plan"]);
  });

  it("repairs under a setext heading without marking its underline", () => {
    const out = shape(
      "Acceptance Criteria\n===================\n\nbare claim",
      [CRITERIA],
    );
    expect(out).toBe(
      "Acceptance Criteria\n===================\n\n- [ ] bare claim",
    );
  });

  it("sees the headings below an unterminated fence", () => {
    // Markdown says the fence runs to the end of the document, which would hide
    // the empty Test Plan from every check. A gate that cannot see a section
    // cannot enforce it, so the scanner reads past the stray fence.
    const body = [
      "## Context",
      "why",
      "## Acceptance Criteria",
      "```md",
      "bare",
      "## Test Plan",
    ].join("\n");
    expect(findEmptySections(body, ALL)).toEqual(["## Test Plan"]);
  });
});

describe("findEmptySections — content that only looks like content", () => {
  it("flags a section holding a multi-line comment", () => {
    expect(
      findEmptySections("## Context\n\n<!--\nplaceholder only\n-->", [CONTEXT]),
    ).toEqual(["## Context"]);
  });

  it("counts text sharing a line with a comment", () => {
    expect(
      findEmptySections("## Context\n\n<!-- note --> real content", [CONTEXT]),
    ).toEqual([]);
  });

  it("counts a fenced command as content", () => {
    expect(
      findEmptySections("## Test Plan\n\n```sh\nnpm test\n```", [TEST_PLAN]),
    ).toEqual([]);
  });
});

describe("findEmptySections — the refusal the gate applies", () => {
  it("flags a heading with nothing under it", () => {
    expect(
      findEmptySections("## Context\n\n## Test Plan\n\nnpm test", ALL),
    ).toEqual(["## Context"]);
  });

  it("flags a section holding only the skeleton's own hint comment", () => {
    // This is the case the check exists for: an agent pastes the skeleton the
    // CLI printed and fills nothing in.
    expect(
      findEmptySections("## Context\n\n<!-- why this work exists -->", [
        CONTEXT,
      ]),
    ).toEqual(["## Context"]);
  });

  it("accepts any real content, including a single bullet", () => {
    expect(
      findEmptySections("## Acceptance Criteria\n\n- [ ] a claim", [CRITERIA]),
    ).toEqual([]);
  });

  it("says nothing about a section that is absent entirely", () => {
    // Absence is the presence check's job; reporting it here would double up.
    expect(findEmptySections("## Context\n\nwhy", ALL)).toEqual([]);
  });

  it("flags the last section when it ends the description", () => {
    expect(
      findEmptySections("## Context\n\nwhy\n\n## Test Plan\n\n", ALL),
    ).toEqual(["## Test Plan"]);
  });
});
