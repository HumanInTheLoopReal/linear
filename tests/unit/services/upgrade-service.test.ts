import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  formatUpgradeAck,
  formatUpgradeReview,
  formatUpgradeStatus,
  getVersionsSince,
  runUpgradeAck,
  runUpgradeReview,
  runUpgradeStatus,
} from "../../../src/services/upgrade-service.js";
import type { VersionChange } from "../../../src/services/version-changelog.js";

// Newest-first fixture changelog (mirrors the real shape).
const FIXTURE: VersionChange[] = [
  { version: "2026.4.9", date: "2026-05-31", changes: ["NEW: c three"] },
  { version: "2026.4.8", date: "2026-05-30", changes: ["FIX: c two"] },
  { version: "2026.4.7", date: "2026-05-28", changes: ["NEW: c one"] },
];

describe("compareVersions", () => {
  it("orders calendar-versioned patches", () => {
    expect(compareVersions("2026.4.9", "2026.4.8")).toBe(1);
    expect(compareVersions("2026.4.8", "2026.4.9")).toBe(-1);
    expect(compareVersions("2026.4.9", "2026.4.9")).toBe(0);
  });

  it("orders across month and year components", () => {
    expect(compareVersions("2026.5.0", "2026.4.9")).toBe(1);
    expect(compareVersions("2027.1.0", "2026.12.9")).toBe(1);
  });

  it("treats missing trailing components as zero", () => {
    expect(compareVersions("2026.4", "2026.4.0")).toBe(0);
    expect(compareVersions("2026.4.1", "2026.4")).toBe(1);
  });

  it("treats non-numeric components as zero", () => {
    expect(compareVersions("x.y.z", "0.0.0")).toBe(0);
  });
});

describe("getVersionsSince", () => {
  it("returns all versions when sinceVersion is empty", () => {
    expect(getVersionsSince("", FIXTURE)).toEqual(FIXTURE);
  });

  it("returns all versions when sinceVersion is unknown", () => {
    expect(getVersionsSince("1.0.0", FIXTURE)).toEqual(FIXTURE);
  });

  it("returns [] when already on the newest version", () => {
    expect(getVersionsSince("2026.4.9", FIXTURE)).toEqual([]);
  });

  it("returns newer versions in chronological order (oldest first)", () => {
    const result = getVersionsSince("2026.4.7", FIXTURE);
    expect(result.map((v) => v.version)).toEqual(["2026.4.8", "2026.4.9"]);
  });

  it("returns a single newer version when one release behind", () => {
    const result = getVersionsSince("2026.4.8", FIXTURE);
    expect(result.map((v) => v.version)).toEqual(["2026.4.9"]);
  });
});

describe("runUpgradeStatus", () => {
  it("reports an upgrade when current is newer than last-seen", () => {
    const result = runUpgradeStatus({
      currentVersion: "2026.4.9",
      lastSeenVersion: "2026.4.7",
      changelog: FIXTURE,
    });
    expect(result).toEqual({
      upgraded: true,
      current_version: "2026.4.9",
      previous_version: "2026.4.7",
      changes_available: true,
    });
  });

  it("reports no upgrade on a downgrade", () => {
    const result = runUpgradeStatus({
      currentVersion: "2026.4.7",
      lastSeenVersion: "2026.4.9",
      changelog: FIXTURE,
    });
    expect(result).toEqual({
      upgraded: false,
      current_version: "2026.4.7",
    });
  });

  it("reports no upgrade when versions are equal", () => {
    const result = runUpgradeStatus({
      currentVersion: "2026.4.9",
      lastSeenVersion: "2026.4.9",
      changelog: FIXTURE,
    });
    expect(result.upgraded).toBe(false);
    expect(result.previous_version).toBeUndefined();
  });

  it("first run (no last-seen) reports no upgrade", () => {
    const result = runUpgradeStatus({
      currentVersion: "2026.4.9",
      lastSeenVersion: "",
      changelog: FIXTURE,
    });
    expect(result).toEqual({
      upgraded: false,
      current_version: "2026.4.9",
    });
  });
});

describe("formatUpgradeStatus", () => {
  it("renders the upgrade banner with review hint", () => {
    const text = formatUpgradeStatus({
      upgraded: true,
      current_version: "2026.4.9",
      previous_version: "2026.4.8",
      changes_available: true,
    });
    expect(text).toContain("✨ linear upgraded from v2026.4.8 to v2026.4.9");
    expect(text).toContain("Run 'linear upgrade review' to see what changed");
  });

  it("renders the first-run line when no previous version", () => {
    const text = formatUpgradeStatus({
      upgraded: false,
      current_version: "2026.4.9",
    });
    expect(text).toBe(
      "linear version: v2026.4.9 (first run or version tracking just enabled)\n",
    );
  });

  it("renders the no-upgrade line when previous matches", () => {
    const text = formatUpgradeStatus({
      upgraded: false,
      current_version: "2026.4.9",
      previous_version: "2026.4.9",
    });
    expect(text).toBe("linear version: v2026.4.9 (no upgrade detected)\n");
  });
});

describe("runUpgradeReview", () => {
  it("lists versions between last-seen and current, chronologically", () => {
    const result = runUpgradeReview({
      currentVersion: "2026.4.9",
      lastSeenVersion: "2026.4.7",
      changelog: FIXTURE,
    });
    expect(result.current_version).toBe("2026.4.9");
    expect(result.previous_version).toBe("2026.4.7");
    expect(result.new_versions.map((v) => v.version)).toEqual([
      "2026.4.8",
      "2026.4.9",
    ]);
  });

  it("returns empty new_versions when there is no previous version", () => {
    const result = runUpgradeReview({
      currentVersion: "2026.4.9",
      lastSeenVersion: "",
      changelog: FIXTURE,
    });
    expect(result.previous_version).toBe("");
    expect(result.new_versions).toEqual([]);
  });

  it("returns empty new_versions on no upgrade", () => {
    const result = runUpgradeReview({
      currentVersion: "2026.4.9",
      lastSeenVersion: "2026.4.9",
      changelog: FIXTURE,
    });
    expect(result.new_versions).toEqual([]);
  });
});

describe("formatUpgradeReview", () => {
  it("renders no-previous-version hint", () => {
    const text = formatUpgradeReview({
      current_version: "2026.4.9",
      previous_version: "",
      new_versions: [],
    });
    expect(text).toContain("No previous version recorded");
    expect(text).toContain("linear info --whats-new");
  });

  it("renders already-current hint", () => {
    const text = formatUpgradeReview({
      current_version: "2026.4.9",
      previous_version: "2026.4.9",
      new_versions: [],
    });
    expect(text).toContain("You're already on v2026.4.9 (no upgrade detected)");
  });

  it("renders version blocks with the current marker and ack hint", () => {
    const text = formatUpgradeReview({
      current_version: "2026.4.9",
      previous_version: "2026.4.7",
      new_versions: getVersionsSince("2026.4.7", FIXTURE),
    });
    expect(text).toContain("🔄 Upgraded from v2026.4.7 to v2026.4.9");
    expect(text).toContain("=".repeat(60));
    expect(text).toContain("## v2026.4.8 (2026-05-30)");
    expect(text).toContain("## v2026.4.9 (2026-05-31) ← current");
    expect(text).toContain("  • NEW: c three");
    expect(text).toContain("💡 Run 'linear upgrade ack' to mark this version");
  });
});

describe("runUpgradeAck", () => {
  it("persists the current version and returns the prior one", () => {
    const persist = vi.fn();
    const result = runUpgradeAck({
      currentVersion: "2026.4.9",
      lastSeenVersion: "2026.4.7",
      persist,
    });
    expect(persist).toHaveBeenCalledWith("2026.4.9");
    expect(result).toEqual({
      acknowledged: true,
      current_version: "2026.4.9",
      previous_version: "2026.4.7",
    });
  });

  it("persists on first run with empty previous version", () => {
    const persist = vi.fn();
    const result = runUpgradeAck({
      currentVersion: "2026.4.9",
      lastSeenVersion: "",
      persist,
    });
    expect(persist).toHaveBeenCalledWith("2026.4.9");
    expect(result.previous_version).toBe("");
  });
});

describe("formatUpgradeAck", () => {
  it("renders already-on line when previous equals current", () => {
    const text = formatUpgradeAck({
      acknowledged: true,
      current_version: "2026.4.9",
      previous_version: "2026.4.9",
    });
    expect(text).toBe("✓ Already on v2026.4.9\n");
  });

  it("renders first-run ack line when previous is empty", () => {
    const text = formatUpgradeAck({
      acknowledged: true,
      current_version: "2026.4.9",
      previous_version: "",
    });
    expect(text).toBe("✓ Acknowledged linear v2026.4.9\n");
  });

  it("renders upgrade ack line when previous differs", () => {
    const text = formatUpgradeAck({
      acknowledged: true,
      current_version: "2026.4.9",
      previous_version: "2026.4.7",
    });
    expect(text).toBe("✓ Acknowledged upgrade from v2026.4.7 to v2026.4.9\n");
  });
});
