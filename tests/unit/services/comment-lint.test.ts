import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../../../src/common/config-store.js";
import { LinearError } from "../../../src/common/errors.js";
import {
  checkCommentFormat,
  isWallOfText,
  resolveCommentValidationMode,
  WALL_MIN_CHARS,
} from "../../../src/services/comment-lint.js";

vi.mock("../../../src/common/config-store.js", () => ({
  getConfig: vi.fn(() => ({
    key: "",
    value: null,
    found: false,
    source: "default",
  })),
}));

function setConfiguredMode(value: string | null) {
  vi.mocked(getConfig).mockReturnValue({
    key: "validation.on-comment",
    value,
    found: value !== null,
    source: value !== null ? "global" : "default",
  });
}

const WALL = "x".repeat(WALL_MIN_CHARS);

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setConfiguredMode(null);
  stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe("isWallOfText", () => {
  it("is false below the threshold", () => {
    expect(isWallOfText("x".repeat(WALL_MIN_CHARS - 1))).toBe(false);
  });

  it("is true at the threshold with no line break", () => {
    expect(isWallOfText(WALL)).toBe(true);
  });

  it("any line break counts as structure", () => {
    expect(isWallOfText(`${WALL}\n${WALL}`)).toBe(false);
  });

  it("trims before measuring, so trailing whitespace can't tip it over", () => {
    expect(isWallOfText(`${"x".repeat(WALL_MIN_CHARS - 1)}   \n`)).toBe(false);
  });

  it("short one-liners never trigger", () => {
    expect(isWallOfText("LGTM")).toBe(false);
  });
});

describe("resolveCommentValidationMode", () => {
  it("defaults to warn when unset", () => {
    expect(resolveCommentValidationMode()).toBe("warn");
  });

  it("respects configured off/warn/error", () => {
    for (const mode of ["off", "warn", "error"] as const) {
      setConfiguredMode(mode);
      expect(resolveCommentValidationMode()).toBe(mode);
    }
  });

  it("falls back to warn on unrecognized values", () => {
    setConfiguredMode("strict");
    expect(resolveCommentValidationMode()).toBe("warn");
  });
});

describe("checkCommentFormat", () => {
  it("warn (default): prints guidance to stderr and does not throw", () => {
    expect(() => checkCommentFormat(WALL)).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const written = String(stderrSpy.mock.calls[0][0]);
    expect(written).toContain("paragraph with no line breaks");
    expect(written).toContain("pipe tables do NOT render");
  });

  it("stays silent for structured or short bodies", () => {
    checkCommentFormat("LGTM");
    checkCommentFormat(`${WALL}\n- but structured`);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("error mode (opt-in): throws a teaching error with a config hint", () => {
    setConfiguredMode("error");
    let caught: unknown;
    try {
      checkCommentFormat(WALL);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LinearError);
    const err = caught as LinearError;
    expect(err.message).toContain("paragraph with no line breaks");
    expect(err.hint).toContain("validation.on-comment");
  });

  it("off mode: no-op even for a wall", () => {
    setConfiguredMode("off");
    expect(() => checkCommentFormat(WALL)).not.toThrow();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
