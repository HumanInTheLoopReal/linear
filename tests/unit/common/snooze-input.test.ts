import { describe, expect, it } from "vitest";
import { parseRelativeDuration } from "../../../src/common/identifier.js";
import {
  parseDeferWhen,
  parseSnoozeFor,
  parseSnoozeUntil,
} from "../../../src/common/snooze-input.js";

// A fixed reference clock: Monday 2026-06-01T09:15:00Z.
const NOW = new Date("2026-06-01T09:15:00Z");

describe("parseSnoozeUntil (lin-b7hb, lin-ipd3)", () => {
  describe("natural-language anchors", () => {
    it("today → the current UTC date", () => {
      expect(parseSnoozeUntil("today", NOW)).toBe("2026-06-01");
    });

    it("tomorrow → current date + 1", () => {
      expect(parseSnoozeUntil("tomorrow", NOW)).toBe("2026-06-02");
    });

    it("next week → current date + 7", () => {
      expect(parseSnoozeUntil("next week", NOW)).toBe("2026-06-08");
    });

    it("next month → same day, next calendar month", () => {
      expect(parseSnoozeUntil("next month", NOW)).toBe("2026-07-01");
    });

    it("is case- and whitespace-insensitive", () => {
      expect(parseSnoozeUntil("  Tomorrow  ", NOW)).toBe("2026-06-02");
      expect(parseSnoozeUntil("NEXT WEEK", NOW)).toBe("2026-06-08");
    });
  });

  describe("weekday anchors", () => {
    // NOW is a Monday (2026-06-01).
    it("a future weekday this week → its next occurrence", () => {
      expect(parseSnoozeUntil("friday", NOW)).toBe("2026-06-05");
    });

    it("today's weekday → the SAME weekday next week (strictly future)", () => {
      expect(parseSnoozeUntil("monday", NOW)).toBe("2026-06-08");
    });

    it("next <weekday> → the following week's occurrence", () => {
      expect(parseSnoozeUntil("next friday", NOW)).toBe("2026-06-12");
    });
  });

  describe("ISO datetimes", () => {
    it("a naive datetime is treated as UTC, minute precision", () => {
      expect(parseSnoozeUntil("2026-06-01T14:30", NOW)).toBe("2026-06-01T1430");
    });

    it("an explicit Z datetime keeps the UTC instant", () => {
      expect(parseSnoozeUntil("2026-06-01T14:30:00Z", NOW)).toBe(
        "2026-06-01T1430",
      );
    });

    it("an offset datetime is normalized to UTC", () => {
      // 14:30+05:30 == 09:00Z
      expect(parseSnoozeUntil("2026-06-01T14:30:00+05:30", NOW)).toBe(
        "2026-06-01T0900",
      );
    });

    it("tolerates a space separator", () => {
      expect(parseSnoozeUntil("2026-06-01 14:30", NOW)).toBe("2026-06-01T1430");
    });
  });

  describe("plain dates", () => {
    it("passes a valid YYYY-MM-DD through unchanged", () => {
      expect(parseSnoozeUntil("2099-12-31", NOW)).toBe("2099-12-31");
    });

    it("rejects an impossible calendar date", () => {
      expect(() => parseSnoozeUntil("2026-02-30", NOW)).toThrow();
    });
  });

  describe("rejection", () => {
    it("throws on an unrecognized token", () => {
      expect(() => parseSnoozeUntil("someday", NOW)).toThrow(
        /Invalid resurface date/,
      );
    });

    it("throws on a bare time with no date", () => {
      expect(() => parseSnoozeUntil("14:30", NOW)).toThrow();
    });
  });
});

describe("parseSnoozeFor (lin-ipd3)", () => {
  it("h (hours) → a sub-day UTC timestamp", () => {
    expect(parseSnoozeFor("6h", NOW)).toBe("2026-06-01T1515");
  });

  it("hours wrap across the day boundary", () => {
    expect(parseSnoozeFor("18h", NOW)).toBe("2026-06-02T0315");
  });

  it("d/w/mo/y delegate to parseRelativeDuration (day-granular)", () => {
    // Delegation, not a hardcoded date: parseRelativeDuration uses local-date
    // math, so comparing to its own output keeps this timezone-stable.
    expect(parseSnoozeFor("7d", NOW)).toBe(parseRelativeDuration("7d", NOW));
    expect(parseSnoozeFor("1w", NOW)).toBe(parseRelativeDuration("1w", NOW));
    expect(parseSnoozeFor("7d", NOW)).not.toContain("T");
  });

  it("rejects a missing unit", () => {
    expect(() => parseSnoozeFor("6", NOW)).toThrow(/Invalid duration/);
  });

  it("rejects an unknown unit", () => {
    expect(() => parseSnoozeFor("6s", NOW)).toThrow(/Invalid duration/);
  });

  it("the error message advertises the h unit", () => {
    expect(() => parseSnoozeFor("soon", NOW)).toThrow(/h, d, w, mo, y/);
  });
});

describe("parseDeferWhen (lin-ov30.4)", () => {
  it("routes a relative duration to parseSnoozeFor (matches its output)", () => {
    expect(parseDeferWhen("7d", NOW)).toBe(parseSnoozeFor("7d", NOW));
    expect(parseDeferWhen("6h", NOW)).toBe(parseSnoozeFor("6h", NOW));
    expect(parseDeferWhen("2w", NOW)).toBe(parseSnoozeFor("2w", NOW));
  });

  it("strips a leading + from a relative duration (the +6h form)", () => {
    expect(parseDeferWhen("+6h", NOW)).toBe(parseSnoozeFor("6h", NOW));
    expect(parseDeferWhen("+1d", NOW)).toBe(parseSnoozeFor("1d", NOW));
  });

  it("routes a natural-language anchor to parseSnoozeUntil", () => {
    expect(parseDeferWhen("tomorrow", NOW)).toBe("2026-06-02");
    expect(parseDeferWhen("next week", NOW)).toBe("2026-06-08");
  });

  it("routes an absolute date to parseSnoozeUntil unchanged", () => {
    expect(parseDeferWhen("2026-12-31", NOW)).toBe("2026-12-31");
  });

  it("routes an ISO datetime to a sub-day suffix", () => {
    expect(parseDeferWhen("2026-06-10T18:45", NOW)).toBe("2026-06-10T1845");
  });

  it("rejects an unparseable value", () => {
    expect(() => parseDeferWhen("someday", NOW)).toThrow(/Invalid resurface/);
  });
});
