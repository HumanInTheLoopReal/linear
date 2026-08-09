import { describe, expect, it, vi } from "vitest";
import { requireCommentBody } from "../../../src/commands/_comment-body.js";
import { checkCommentFormat } from "../../../src/services/comment-lint.js";

vi.mock("../../../src/services/comment-lint.js", () => ({
  checkCommentFormat: vi.fn(),
}));

describe("requireCommentBody", () => {
  it("returns the resolved body and applies the formatting policy", () => {
    vi.mocked(checkCommentFormat).mockReset();
    expect(requireCommentBody({ body: "Structured update" })).toBe(
      "Structured update",
    );
    expect(checkCommentFormat).toHaveBeenCalledWith("Structured update");
  });

  it.each([
    undefined,
    "",
    "  \n  ",
  ])("rejects a missing or empty body before linting (%s)", (body) => {
    vi.mocked(checkCommentFormat).mockReset();
    expect(() => requireCommentBody({ body })).toThrow(
      "Invalid --body: is required",
    );
    expect(checkCommentFormat).not.toHaveBeenCalled();
  });

  it("propagates an error-mode formatting rejection", () => {
    vi.mocked(checkCommentFormat)
      .mockReset()
      .mockImplementationOnce(() => {
        throw new Error("comment formatting rejected");
      });

    expect(() => requireCommentBody({ body: "unstructured" })).toThrow(
      "comment formatting rejected",
    );
  });
});
