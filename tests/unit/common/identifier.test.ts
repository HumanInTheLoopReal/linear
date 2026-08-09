import { describe, expect, it } from "vitest";
import {
  isUuid,
  parseDueDate,
  parseIssueIdentifier,
  parseRelativeDuration,
  tryParseIssueIdentifier,
} from "../../../src/common/identifier.js";

describe("isUuid", () => {
  it("returns true for valid UUID", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("returns false for issue identifier", () => {
    expect(isUuid("ABC-123")).toBe(false);
  });

  it("returns false for plain string", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});

describe("parseIssueIdentifier", () => {
  it("parses valid identifier", () => {
    const result = parseIssueIdentifier("ABC-123");
    expect(result).toEqual({ teamKey: "ABC", issueNumber: 123 });
  });

  it("throws on invalid format", () => {
    expect(() => parseIssueIdentifier("invalid")).toThrow(
      "Invalid issue identifier",
    );
  });

  it("throws on non-numeric issue number", () => {
    expect(() => parseIssueIdentifier("ABC-XYZ")).toThrow(
      "Invalid issue number",
    );
  });
});

describe("tryParseIssueIdentifier", () => {
  it("returns parsed identifier for valid input", () => {
    expect(tryParseIssueIdentifier("ABC-123")).toEqual({
      teamKey: "ABC",
      issueNumber: 123,
    });
  });

  it("returns null for invalid input", () => {
    expect(tryParseIssueIdentifier("invalid")).toBeNull();
  });
});

describe("parseDueDate", () => {
  it("returns valid YYYY-MM-DD date string", () => {
    expect(parseDueDate("2025-01-15")).toBe("2025-01-15");
  });

  it("returns valid leap day", () => {
    expect(parseDueDate("2024-02-29")).toBe("2024-02-29");
  });

  it("throws on invalid format (no dashes)", () => {
    expect(() => parseDueDate("20250115")).toThrow("Invalid due date format");
  });

  it("throws on invalid format (extra parts)", () => {
    expect(() => parseDueDate("2025-01-15T00:00")).toThrow(
      "Invalid due date format",
    );
  });

  it("throws on impossible date (Feb 30)", () => {
    expect(() => parseDueDate("2025-02-30")).toThrow("Invalid due date");
  });

  it("throws on non-leap-year Feb 29", () => {
    expect(() => parseDueDate("2025-02-29")).toThrow("Invalid due date");
  });

  it("throws on empty string", () => {
    expect(() => parseDueDate("")).toThrow("Invalid due date format");
  });
});

// lin-j56l: relative-time parser feeds `linear snooze --for <duration>` so
// users can say "1w" instead of computing the absolute date by hand.
describe("parseRelativeDuration", () => {
  // 2026-05-18 is a Monday — convenient for week math without daylight-
  // savings cliffs in either US or EU zones.
  const today = new Date(2026, 4, 18); // month is 0-indexed

  it("adds days for the `d` unit", () => {
    expect(parseRelativeDuration("7d", today)).toBe("2026-05-25");
  });

  it("adds weeks for the `w` unit", () => {
    expect(parseRelativeDuration("2w", today)).toBe("2026-06-01");
  });

  it("adds months for the `mo` unit (calendar-month, not 30-day)", () => {
    expect(parseRelativeDuration("1mo", today)).toBe("2026-06-18");
    expect(parseRelativeDuration("3mo", today)).toBe("2026-08-18");
  });

  it("adds years for the `y` unit", () => {
    expect(parseRelativeDuration("1y", today)).toBe("2027-05-18");
  });

  // JS Date overflow: adding 1 month to Jan 31 yields Mar 3 (not Feb 31).
  // For snooze this is mildly surprising but matches every other Date-based
  // month-add in the ecosystem; explicit test so the behavior is contract.
  it("uses JS Date month-overflow semantics (1mo from Jan 31 → Mar 3)", () => {
    expect(parseRelativeDuration("1mo", new Date(2026, 0, 31))).toBe(
      "2026-03-03",
    );
  });

  it("zero-pads single-digit months and days", () => {
    expect(parseRelativeDuration("1d", new Date(2026, 0, 1))).toBe(
      "2026-01-02",
    );
  });

  it.each([
    "",
    "1",
    "1x",
    "w1",
    "1.5w",
    "1 week",
    "-1d",
    "+1d",
  ])("throws on invalid duration %s", (bad) => {
    expect(() => parseRelativeDuration(bad, today)).toThrow("Invalid duration");
  });
});
