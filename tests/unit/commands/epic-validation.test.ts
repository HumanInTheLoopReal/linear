import { beforeEach, describe, expect, it, vi } from "vitest";

// The epic create gate reads `validation.on-create` + `template.create` via
// config-store; mock getConfig so the tests control the mode + template.
vi.mock("../../../src/common/config-store.js", () => ({
  getConfig: vi.fn(() => ({
    key: "",
    value: null,
    found: false,
    source: "default",
  })),
}));

import { enforceEpicCreateValidation } from "../../../src/commands/epic.js";
import { getConfig } from "../../../src/common/config-store.js";

/** Make getConfig answer `validation.on-create`; everything else unset. */
function setMode(mode: "off" | "warn" | "error" | null) {
  vi.mocked(getConfig).mockImplementation((key: string) => {
    if (key === "validation.on-create" && mode !== null) {
      return { key, value: mode, found: true, source: "global" };
    }
    return { key, value: null, found: false, source: "default" };
  });
}

// Built-in default template sections, with the type slot filled per type: an
// untyped child needs ## Acceptance Criteria, the epic parent ## Success
// Criteria (see resolveRequiredSections).
const GOOD_CHILD = "## Context\nc\n## Acceptance Criteria\na\n## Test Plan\nt";
const GOOD_EPIC =
  "## Context\nc\n## Success Criteria\n- ships\n## Test Plan\nt";

beforeEach(() => {
  vi.clearAllMocks();
  setMode(null); // unset -> default `error`
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

describe("enforceEpicCreateValidation (lin-fllv)", () => {
  it("passes when the epic + every child carry their required sections", () => {
    expect(() =>
      enforceEpicCreateValidation(
        "Epic",
        GOOD_EPIC,
        [{ title: "A" }, { title: "B" }],
        [GOOD_CHILD, GOOD_CHILD],
        undefined,
      ),
    ).not.toThrow();
  });

  it("blocks (and names the epic) when the parent lacks ## Success Criteria", () => {
    expect(() =>
      enforceEpicCreateValidation(
        "My Epic",
        "## Context\nc\n## Test Plan\nt",
        [{ title: "A" }],
        [GOOD_CHILD],
        undefined,
      ),
    ).toThrow(/epic "My Epic": ## Success Criteria/);
  });

  it("never asks the epic parent for ## Acceptance Criteria", () => {
    let msg = "";
    try {
      enforceEpicCreateValidation(
        "My Epic",
        "just a plain epic body",
        [{ title: "A" }],
        [GOOD_CHILD],
        undefined,
      );
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain(
      'epic "My Epic": ## Context, ## Success Criteria, ## Test Plan',
    );
  });

  it("blocks (and names the child) when a child lacks template sections", () => {
    expect(() =>
      enforceEpicCreateValidation(
        "Epic",
        GOOD_EPIC,
        [{ title: "Good" }, { title: "Bad" }],
        [GOOD_CHILD, "just prose"],
        undefined,
      ),
    ).toThrow(/child "Bad": ## Context, ## Acceptance Criteria, ## Test Plan/);
  });

  it("lists EVERY violation in one error (fail-fast, no half-built epic)", () => {
    let msg = "";
    try {
      enforceEpicCreateValidation(
        "E",
        "bad epic",
        [{ title: "C1" }, { title: "C2" }],
        ["bad", "bad"],
        undefined,
      );
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain('epic "E"');
    expect(msg).toContain('child "C1"');
    expect(msg).toContain('child "C2"');
  });

  it("--no-validate skips the gate entirely", () => {
    expect(() =>
      enforceEpicCreateValidation(
        "E",
        "bad epic",
        [{ title: "C1" }],
        ["bad"],
        false,
      ),
    ).not.toThrow();
  });

  it("warn mode proceeds but writes to stderr", () => {
    setMode("warn");
    const write = vi.mocked(process.stderr.write);
    expect(() =>
      enforceEpicCreateValidation(
        "E",
        "bad epic",
        [{ title: "C1" }],
        ["bad"],
        undefined,
      ),
    ).not.toThrow();
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("epic create blocked"),
    );
  });
});
