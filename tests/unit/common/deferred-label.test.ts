import { describe, expect, it } from "vitest";
import {
  auditDeferral,
  deferInstant,
  deferUntilDates,
  isDeferred,
  isValidIsoDate,
  matchesDeferWindow,
} from "../../../src/common/deferred-label.js";

function labels(...names: string[]) {
  return { nodes: names.map((name) => ({ name })) };
}

function kinds(result: ReturnType<typeof auditDeferral>): string[] {
  return result.problems.map((p) => p.kind).sort();
}

describe("isDeferred (lin-dpp1: shared deferred semantics)", () => {
  const today = "2026-05-18";

  it("returns false for the empty / null label set", () => {
    expect(isDeferred(null, today)).toBe(false);
    expect(isDeferred(undefined, today)).toBe(false);
    expect(isDeferred({ nodes: [] }, today)).toBe(false);
  });

  it("returns true on bare `deferred` label when no until-date exists", () => {
    expect(isDeferred(labels("deferred"), today)).toBe(true);
  });

  it("returns true when at least one deferred-until:<date> is future", () => {
    expect(isDeferred(labels("deferred-until:2026-06-01"), today)).toBe(true);
  });

  it("returns false when every deferred-until:<date> is in the past", () => {
    expect(
      isDeferred(labels("deferred", "deferred-until:2024-01-01"), today),
    ).toBe(false);
  });

  it("future date wins even if a past date is also attached", () => {
    expect(
      isDeferred(
        labels("deferred-until:2024-01-01", "deferred-until:2026-06-01"),
        today,
      ),
    ).toBe(true);
  });

  it("date label is authoritative — past dates override bare `deferred`", () => {
    // The motivating bug: snooze sets BOTH `deferred` + `deferred-until:<date>`.
    // After the date passes, stale `deferred` label must NOT keep an issue
    // out of the ready view. `linear next` already did this; `linear issues
    // status` did not, so its Ready-to-Work count was lower than next's
    // list. Single source of truth: same answer in both.
    const stale = labels("deferred", "deferred-until:2025-01-01");
    expect(isDeferred(stale, today)).toBe(false);
  });
});

describe("deferInstant (lin-b7hb: sub-day resurface parsing)", () => {
  it("resolves a bare date to 00:00:00Z of that day", () => {
    expect(deferInstant("2026-06-01")).toBe(Date.UTC(2026, 5, 1));
  });

  it("resolves a datetime suffix to that UTC minute", () => {
    expect(deferInstant("2026-06-01T1430")).toBe(Date.UTC(2026, 5, 1, 14, 30));
  });

  it("returns null for a malformed suffix", () => {
    expect(deferInstant("garbage")).toBeNull();
    expect(deferInstant("2026-06-01T14:30")).toBeNull(); // colon not allowed in label
    expect(deferInstant("2026-6-1")).toBeNull(); // unpadded
  });

  it("returns null for impossible dates / times (overflow)", () => {
    expect(deferInstant("2026-13-01")).toBeNull();
    expect(deferInstant("2026-02-30")).toBeNull();
    expect(deferInstant("2026-06-01T2400")).toBeNull();
    expect(deferInstant("2026-06-01T1060")).toBeNull();
  });
});

describe("isDeferred sub-day instants (lin-b7hb)", () => {
  // 2026-06-01T12:00Z, expressed as a UTC epoch.
  const noon = Date.UTC(2026, 5, 1, 12, 0);

  it("a datetime later today keeps the issue deferred", () => {
    expect(isDeferred(labels("deferred-until:2026-06-01T1800"), noon)).toBe(
      true,
    );
  });

  it("a datetime earlier today resurfaces the issue", () => {
    expect(isDeferred(labels("deferred-until:2026-06-01T0900"), noon)).toBe(
      false,
    );
  });

  it("a numeric `now` compares at minute precision", () => {
    const at = Date.UTC(2026, 5, 1, 14, 30);
    expect(isDeferred(labels("deferred-until:2026-06-01T1431"), at)).toBe(true);
    expect(isDeferred(labels("deferred-until:2026-06-01T1430"), at)).toBe(
      false,
    );
  });

  it("a date-string `now` still resolves to start-of-day (legacy semantics)", () => {
    // A same-day datetime is in the future relative to that day's 00:00Z.
    expect(
      isDeferred(labels("deferred-until:2026-06-01T0001"), "2026-06-01"),
    ).toBe(true);
  });
});

describe("isValidIsoDate (lin-ay7q)", () => {
  it("accepts real calendar dates", () => {
    expect(isValidIsoDate("2026-05-31")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true); // leap day
  });

  it("rejects malformed shapes", () => {
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate("next-week")).toBe(false);
    expect(isValidIsoDate("2026-5-1")).toBe(false); // unpadded
    expect(isValidIsoDate("2026/05/31")).toBe(false);
  });

  it("rejects impossible dates that match the shape", () => {
    expect(isValidIsoDate("2026-13-40")).toBe(false);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2025-02-29")).toBe(false); // non-leap year
  });
});

describe("deferUntilDates (lin-5u3w)", () => {
  it("extracts only valid deferred-until dates, dropping malformed suffixes", () => {
    const ls = labels(
      "deferred",
      "deferred-until:2026-06-01",
      "deferred-until:not-a-date",
      "type:bug",
    );
    expect(deferUntilDates(ls)).toEqual(["2026-06-01"]);
  });

  it("returns [] when no deferred-until label is present", () => {
    expect(deferUntilDates(labels("deferred"))).toEqual([]);
    expect(deferUntilDates(null)).toEqual([]);
  });

  it("yields the DATE portion of a sub-day datetime suffix (lin-b7hb)", () => {
    // So the date-granular --defer-before/after window keeps working.
    expect(
      deferUntilDates(labels("deferred", "deferred-until:2026-06-01T1430")),
    ).toEqual(["2026-06-01"]);
  });
});

describe("matchesDeferWindow (lin-5u3w)", () => {
  it("matches a resurface date strictly before the --defer-before bound", () => {
    const ls = labels("deferred", "deferred-until:2026-06-10");
    expect(matchesDeferWindow(ls, undefined, "2026-07-01")).toBe(true);
    expect(matchesDeferWindow(ls, undefined, "2026-06-10")).toBe(false); // strict
    expect(matchesDeferWindow(ls, undefined, "2026-06-01")).toBe(false);
  });

  it("matches a resurface date strictly after the --defer-after bound", () => {
    const ls = labels("deferred", "deferred-until:2026-06-10");
    expect(matchesDeferWindow(ls, "2026-06-01", undefined)).toBe(true);
    expect(matchesDeferWindow(ls, "2026-06-10", undefined)).toBe(false); // strict
    expect(matchesDeferWindow(ls, "2026-07-01", undefined)).toBe(false);
  });

  it("requires a single date to satisfy BOTH bounds (window semantics)", () => {
    const inWindow = labels("deferred-until:2026-06-15");
    const outOfWindow = labels("deferred-until:2026-08-15");
    expect(matchesDeferWindow(inWindow, "2026-06-01", "2026-07-01")).toBe(true);
    expect(matchesDeferWindow(outOfWindow, "2026-06-01", "2026-07-01")).toBe(
      false,
    );
  });

  it("never matches an issue without a valid resurface date", () => {
    expect(
      matchesDeferWindow(labels("deferred"), undefined, "2026-07-01"),
    ).toBe(false);
    expect(
      matchesDeferWindow(
        labels("deferred-until:bogus"),
        "2026-01-01",
        "2026-12-31",
      ),
    ).toBe(false);
  });
});

describe("auditDeferral (lin-ay7q: snooze-label drift scan)", () => {
  const today = "2026-05-18";

  it("reports no problems for a clean indefinite snooze (bare deferred)", () => {
    const result = auditDeferral(labels("deferred"), today);
    expect(result.problems).toEqual([]);
    expect(result.hasDeferredLabel).toBe(true);
  });

  it("reports no problems for a clean future-dated snooze", () => {
    const result = auditDeferral(
      labels("deferred", "deferred-until:2026-06-01"),
      today,
    );
    expect(result.problems).toEqual([]);
    expect(result.untilLabels).toEqual(["deferred-until:2026-06-01"]);
  });

  it("reports no problems for an issue with no deferral labels", () => {
    expect(auditDeferral(labels("type:task"), today).problems).toEqual([]);
    expect(auditDeferral(null, today).problems).toEqual([]);
  });

  it("flags a malformed deferred-until date", () => {
    const result = auditDeferral(
      labels("deferred", "deferred-until:next-week"),
      today,
    );
    expect(kinds(result)).toContain("malformed-date");
    expect(result.problems[0].detail).toBe("deferred-until:next-week");
  });

  it("flags multiple competing resurface dates", () => {
    const result = auditDeferral(
      labels(
        "deferred",
        "deferred-until:2026-06-01",
        "deferred-until:2026-07-01",
      ),
      today,
    );
    expect(kinds(result)).toContain("multiple-dates");
  });

  it("flags a deferred-until orphaned from the bare deferred label", () => {
    const result = auditDeferral(labels("deferred-until:2026-06-01"), today);
    expect(kinds(result)).toContain("orphaned-until");
    expect(result.hasDeferredLabel).toBe(false);
  });

  it("flags a stale snooze whose date has already passed", () => {
    // Mirrors isDeferred: a past-only date means the issue already resurfaces
    // in `next`, so the lingering labels are drift to be cleaned via `wake`.
    const result = auditDeferral(
      labels("deferred", "deferred-until:2025-01-01"),
      today,
    );
    expect(kinds(result)).toContain("stale");
    expect(
      isDeferred(labels("deferred", "deferred-until:2025-01-01"), today),
    ).toBe(false);
  });

  it("does NOT flag stale when a future date is also present", () => {
    const result = auditDeferral(
      labels(
        "deferred",
        "deferred-until:2025-01-01",
        "deferred-until:2026-06-01",
      ),
      today,
    );
    // multiple-dates is flagged, but the future date means it is genuinely
    // still deferred, so `stale` must NOT fire.
    expect(kinds(result)).toContain("multiple-dates");
    expect(kinds(result)).not.toContain("stale");
  });

  it("a single malformed date is flagged malformed, never stale", () => {
    const result = auditDeferral(
      labels("deferred", "deferred-until:garbage"),
      today,
    );
    expect(kinds(result)).toContain("malformed-date");
    expect(kinds(result)).not.toContain("stale");
  });

  it("accepts a sub-day datetime suffix as a clean snooze (lin-b7hb)", () => {
    const at = Date.UTC(2026, 5, 1, 12, 0);
    const result = auditDeferral(
      labels("deferred", "deferred-until:2026-06-01T1800"),
      at,
    );
    expect(result.problems).toEqual([]);
  });

  it("flags a sub-day datetime as stale once its instant has passed", () => {
    const at = Date.UTC(2026, 5, 1, 12, 0);
    const result = auditDeferral(
      labels("deferred", "deferred-until:2026-06-01T0900"),
      at,
    );
    expect(kinds(result)).toContain("stale");
    expect(
      isDeferred(labels("deferred", "deferred-until:2026-06-01T0900"), at),
    ).toBe(false);
  });
});
