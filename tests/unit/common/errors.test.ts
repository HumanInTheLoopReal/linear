import { describe, expect, it } from "vitest";
import {
  AUTH_ERROR_CODE,
  AuthenticationError,
  invalidParameterError,
  isAuthError,
  isNotFoundError,
  multipleMatchesError,
  notFoundError,
  requiresParameterError,
} from "../../../src/common/errors.js";

describe("notFoundError", () => {
  it("creates error with entity and identifier", () => {
    const err = notFoundError("Team", "ABC");
    expect(err.message).toBe('Team "ABC" not found');
    expect(isNotFoundError(err)).toBe(true);
  });

  it("includes context when provided", () => {
    const err = notFoundError("Cycle", "Sprint 1", "for team ENG");
    expect(err.message).toBe('Cycle "Sprint 1" for team ENG not found');
  });
});

describe("multipleMatchesError", () => {
  it("creates error with matches and disambiguation hint", () => {
    const err = multipleMatchesError(
      "cycle",
      "Sprint",
      ["id-1", "id-2"],
      "use an ID",
    );
    expect(err.message).toContain('Multiple cycles found matching "Sprint"');
    expect(err.message).toContain("id-1, id-2");
    expect(err.message).toContain("use an ID");
  });
});

describe("invalidParameterError", () => {
  it("creates error with parameter and reason", () => {
    const err = invalidParameterError("--limit", "requires positive integer");
    expect(err.message).toBe("Invalid --limit: requires positive integer");
  });
});

describe("requiresParameterError", () => {
  it("creates error with flag dependency", () => {
    const err = requiresParameterError("--around-active", "--team");
    expect(err.message).toBe("--around-active requires --team to be specified");
  });
});

describe("AuthenticationError", () => {
  it("creates error with default message", () => {
    const err = new AuthenticationError();
    expect(err.message).toBe("Linear API authentication failed.");
    expect(err.name).toBe("AuthenticationError");
  });

  it("creates error with custom details", () => {
    const err = new AuthenticationError("Token expired");
    expect(err.details).toBe("Token expired");
  });

  it("defaults kind to 'invalid' and carries a non-empty remediation list", () => {
    const err = new AuthenticationError("Token expired");
    expect(err.kind).toBe("invalid");
    expect(Array.isArray(err.remediation)).toBe(true);
    expect(err.remediation.length).toBeGreaterThan(0);
    expect(err.remediation.join("\n")).toContain("LINEAR_API_TOKEN");
  });

  it("accepts opts to override kind, message, and remediation", () => {
    const err = new AuthenticationError("No token in any source.", {
      kind: "missing",
      message: "No API token found.",
      remediation: ["Set LINEAR_API_TOKEN=<token>."],
    });
    expect(err.kind).toBe("missing");
    expect(err.message).toBe("No API token found.");
    expect(err.details).toBe("No token in any source.");
    expect(err.remediation).toEqual(["Set LINEAR_API_TOKEN=<token>."]);
  });
});

describe("isAuthError", () => {
  it("returns true for AuthenticationError", () => {
    expect(isAuthError(new AuthenticationError())).toBe(true);
  });

  it("returns true for exact 'Authentication required' message", () => {
    expect(isAuthError(new Error("Authentication required"))).toBe(true);
  });

  it("returns true for exact 'Unauthorized' message", () => {
    expect(isAuthError(new Error("Unauthorized"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isAuthError(new Error("Team not found"))).toBe(false);
  });

  it("returns false for errors that merely contain auth keywords", () => {
    expect(
      isAuthError(new Error("Failed to update authentication settings")),
    ).toBe(false);
    expect(isAuthError(new Error("Unauthorized access to resource"))).toBe(
      false,
    );
  });
});

describe("AUTH_ERROR_CODE", () => {
  it("is 42", () => {
    expect(AUTH_ERROR_CODE).toBe(42);
  });
});
