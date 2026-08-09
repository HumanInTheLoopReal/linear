import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/config-store.js", () => ({
  getConfig: vi.fn(),
}));

import { getConfig } from "../../../src/common/config-store.js";
import { REQUIRED_CREATE_SECTIONS } from "../../../src/common/required-sections.js";
import {
  DEFAULT_CREATE_TEMPLATE,
  requiredSectionsFromTemplate,
  resolveCreateSections,
  resolveCreateTemplate,
  resolveTypeSections,
  TEMPLATE_CREATE_KEY,
  typeSectionSpecsFromJson,
} from "../../../src/services/template-service.js";

function found(value: string, source: "local" | "global") {
  return { key: TEMPLATE_CREATE_KEY, value, found: true, source };
}
function unset() {
  return {
    key: TEMPLATE_CREATE_KEY,
    value: null,
    found: false,
    source: "default" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("requiredSectionsFromTemplate (lin-0nh0)", () => {
  it("parses headings + trailing <!-- hint --> comments", () => {
    const tpl = [
      "## Context",
      "",
      "<!-- why this exists -->",
      "",
      "## Test Plan",
      "<!-- how it's verified -->",
    ].join("\n");
    expect(requiredSectionsFromTemplate(tpl)).toEqual([
      { heading: "## Context", hint: "why this exists" },
      { heading: "## Test Plan", hint: "how it's verified" },
    ]);
  });

  it("supports heading levels 1-6 and trims trailing whitespace", () => {
    const tpl = ["# Top", "###### Deep", "## Trailing  "].join("\n");
    expect(requiredSectionsFromTemplate(tpl).map((s) => s.heading)).toEqual([
      "# Top",
      "###### Deep",
      "## Trailing",
    ]);
  });

  it("gives a hintless heading an empty hint", () => {
    expect(requiredSectionsFromTemplate("## Lonely\n\nsome prose")).toEqual([
      { heading: "## Lonely", hint: "" },
    ]);
  });

  it("ignores non-heading lines and `#nospace`", () => {
    const tpl = ["#nospace", "regular text", "## Real"].join("\n");
    expect(requiredSectionsFromTemplate(tpl)).toEqual([
      { heading: "## Real", hint: "" },
    ]);
  });

  it("tolerates CRLF line endings", () => {
    const tpl = "## A\r\n\r\n<!-- a -->\r\n## B";
    expect(requiredSectionsFromTemplate(tpl)).toEqual([
      { heading: "## A", hint: "a" },
      { heading: "## B", hint: "" },
    ]);
  });

  it("returns [] for empty / heading-free input", () => {
    expect(requiredSectionsFromTemplate("")).toEqual([]);
    expect(requiredSectionsFromTemplate("just prose, no headings")).toEqual([]);
  });

  it("round-trips the built-in default to REQUIRED_CREATE_SECTIONS", () => {
    // The core invariant: the default template, parsed back, IS the canonical
    // hardcoded gate — so behavior is unchanged when no template is set.
    expect(requiredSectionsFromTemplate(DEFAULT_CREATE_TEMPLATE)).toEqual(
      REQUIRED_CREATE_SECTIONS,
    );
  });
});

describe("resolveCreateTemplate (lin-0nh0)", () => {
  it("falls back to the built-in default when unset", () => {
    vi.mocked(getConfig).mockReturnValue(unset());
    const r = resolveCreateTemplate();
    expect(r.source).toBe("default");
    expect(r.template).toBe(DEFAULT_CREATE_TEMPLATE);
    expect(r.sections).toBe(REQUIRED_CREATE_SECTIONS);
  });

  it("uses a configured global template and parses its sections", () => {
    vi.mocked(getConfig).mockReturnValue(
      found("## Summary\n\n<!-- one line -->\n## Plan", "global"),
    );
    const r = resolveCreateTemplate();
    expect(r.source).toBe("global");
    expect(r.sections).toEqual([
      { heading: "## Summary", hint: "one line" },
      { heading: "## Plan", hint: "" },
    ]);
  });

  it("reports the local layer as the source for a per-repo template", () => {
    vi.mocked(getConfig).mockReturnValue(found("## Repo", "local"));
    expect(resolveCreateTemplate().source).toBe("local");
  });

  it("rejects a heading-free template (would disable the gate) and warns", () => {
    const warn = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    vi.mocked(getConfig).mockReturnValue(found("no headings here", "global"));
    const r = resolveCreateTemplate();
    expect(r.source).toBe("default");
    expect(r.sections).toBe(REQUIRED_CREATE_SECTIONS);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no markdown headings"),
    );
  });

  it("treats an empty/whitespace value as unset (default, no warning)", () => {
    const warn = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    vi.mocked(getConfig).mockReturnValue(found("   \n  ", "global"));
    const r = resolveCreateTemplate();
    expect(r.source).toBe("default");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("resolveCreateSections (lin-0nh0)", () => {
  it("returns the active template's sections", () => {
    vi.mocked(getConfig).mockReturnValue(found("## Only", "global"));
    expect(resolveCreateSections()).toEqual([{ heading: "## Only", hint: "" }]);
  });

  it("returns the canonical sections when unset", () => {
    vi.mocked(getConfig).mockReturnValue(unset());
    expect(resolveCreateSections()).toBe(REQUIRED_CREATE_SECTIONS);
  });
});

describe("typeSectionSpecsFromJson", () => {
  it("accepts the full { sections, exempt } shape", () => {
    const raw = JSON.stringify({
      decision: {
        sections: [
          { heading: "## Decision", hint: "one sentence, imperative" },
          "## Consequences",
        ],
        exempt: ["## Test Plan"],
      },
    });
    expect(typeSectionSpecsFromJson(raw)).toEqual({
      decision: {
        sections: [
          { heading: "## Decision", hint: "one sentence, imperative" },
          { heading: "## Consequences", hint: "" },
        ],
        exempt: ["## Test Plan"],
      },
    });
  });

  it("accepts a bare array as shorthand for { sections }", () => {
    expect(typeSectionSpecsFromJson('{"spike":["## Question"]}')).toEqual({
      spike: { sections: [{ heading: "## Question", hint: "" }] },
    });
  });

  it("accepts an empty section list (type needs only the universal sections)", () => {
    expect(typeSectionSpecsFromJson('{"epic":[]}')).toEqual({
      epic: { sections: [] },
    });
  });

  it("lower-cases the type key", () => {
    expect(
      Object.keys(typeSectionSpecsFromJson('{"Decision":["## D"]}')),
    ).toEqual(["decision"]);
  });

  it("rejects malformed input with a pointed message", () => {
    expect(() => typeSectionSpecsFromJson("not json")).toThrow(/invalid JSON/);
    expect(() => typeSectionSpecsFromJson('["decision"]')).toThrow(
      /object keyed by issue type/,
    );
    expect(() =>
      typeSectionSpecsFromJson('{"bug":{"sections":"## X"}}'),
    ).toThrow(/"sections" must be an array/);
    expect(() => typeSectionSpecsFromJson('{"bug":[{"hint":"x"}]}')).toThrow(
      /non-empty "heading"/,
    );
    expect(() =>
      typeSectionSpecsFromJson('{"bug":{"sections":[],"exempt":"## X"}}'),
    ).toThrow(/"exempt" must be an array/);
  });
});

describe("resolveTypeSections", () => {
  it("returns no overrides when unset", () => {
    vi.mocked(getConfig).mockReturnValue(unset());
    expect(resolveTypeSections()).toEqual({ overrides: {}, source: "default" });
  });

  it("reports the layer a configured override came from", () => {
    vi.mocked(getConfig).mockReturnValue(
      found('{"chore":["## Checklist"]}', "local"),
    );
    const r = resolveTypeSections();
    expect(r.source).toBe("local");
    expect(r.overrides.chore.sections).toEqual([
      { heading: "## Checklist", hint: "" },
    ]);
  });

  it("warns and falls back to the built-ins on a malformed value", () => {
    const warn = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    vi.mocked(getConfig).mockReturnValue(found("{oops", "local"));
    expect(resolveTypeSections()).toEqual({ overrides: {}, source: "default" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("template.required-sections-by-type ignored"),
    );
  });
});
