/**
 * `linear upgrade` — version-tracking + changelog review.
 *
 * Implements the upgrade status/review/ack flow plus the `getVersionsSince()`
 * and `compareVersions()` helpers used by version tracking.
 *
 * Notes:
 *   - Version source is `package.json` (calendar-versioned).
 *   - Last-seen version is persisted in `~/.linear/config.json` via
 *     config-store helpers.
 *
 * This service is pure local state — no Linear API calls. It is layered as a
 * service so the command stays a thin Commander wrapper, mirroring `info.ts`.
 */

import {
  getLastSeenVersion,
  setLastSeenVersion,
} from "../common/config-store.js";
import { type VersionChange, versionChanges } from "./version-changelog.js";

/**
 * Compare two dotted numeric version strings (e.g. `2026.4.9`).
 * Returns -1 if `a < b`, 0 if equal, 1 if `a > b`.
 *
 * Missing trailing components are treated as 0 (`2026.4` == `2026.4.0`), and
 * non-numeric components parse to 0.
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".");
  const partsB = b.split(".");
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i += 1) {
    const pa = Number.parseInt(partsA[i] ?? "", 10) || 0;
    const pb = Number.parseInt(partsB[i] ?? "", 10) || 0;
    if (pa < pb) return -1;
    if (pa > pb) return 1;
  }
  return 0;
}

/**
 * Return all changelog entries newer than `sinceVersion`, in chronological
 * order (oldest first):
 *
 *   - empty `sinceVersion` → return the whole list (as-is, newest-first).
 *   - `sinceVersion` not in the changelog → return the whole list (user is
 *     upgrading from a very old / unknown version).
 *   - `sinceVersion` is the newest entry → return [].
 *   - otherwise → the entries before it (which are newer), reversed to
 *     chronological order.
 *
 * `versionChanges` is ordered newest-first; the parameter defaults to it so
 * tests can inject a fixture list.
 */
export function getVersionsSince(
  sinceVersion: string,
  changelog: VersionChange[] = versionChanges,
): VersionChange[] {
  if (sinceVersion === "") {
    return changelog;
  }

  const startIdx = changelog.findIndex((vc) => vc.version === sinceVersion);
  if (startIdx === -1) {
    return changelog;
  }
  if (startIdx === 0) {
    return [];
  }

  // Entries before `sinceVersion` are the newer ones; reverse for chronological.
  return changelog.slice(0, startIdx).reverse();
}

function pluralize(count: number): string {
  return count === 1 ? "" : "s";
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export interface RunUpgradeStatusOpts {
  /** Current CLI version (from package.json). */
  currentVersion: string;
  /** Injected for tests; defaults to reading config-store. */
  lastSeenVersion?: string;
  /** Injected for tests; defaults to the bundled changelog. */
  changelog?: VersionChange[];
}

export interface UpgradeStatusResult {
  upgraded: boolean;
  current_version: string;
  previous_version?: string;
  changes_available?: boolean;
}

/**
 * Detect whether the CLI version increased since the last-seen version.
 * Only a true upgrade (current > previous) counts, never a
 * downgrade. First run (no previous version) reports `upgraded: false`.
 */
export function runUpgradeStatus(
  opts: RunUpgradeStatusOpts,
): UpgradeStatusResult {
  const previousVersion = opts.lastSeenVersion ?? getLastSeenVersion();
  const changelog = opts.changelog ?? versionChanges;

  const upgraded =
    previousVersion !== "" &&
    previousVersion !== opts.currentVersion &&
    compareVersions(opts.currentVersion, previousVersion) > 0;

  const result: UpgradeStatusResult = {
    upgraded,
    current_version: opts.currentVersion,
  };
  if (upgraded) {
    result.previous_version = previousVersion;
    result.changes_available =
      getVersionsSince(previousVersion, changelog).length > 0;
  }
  return result;
}

export function formatUpgradeStatus(result: UpgradeStatusResult): string {
  if (result.upgraded) {
    const lines = [
      `✨ linear upgraded from v${result.previous_version} to v${result.current_version}`,
    ];
    // changes_available is set whenever upgraded; only show the hint block
    // when there are documented changes (count>0).
    if (result.changes_available) {
      const count = getVersionsSince(result.previous_version ?? "").length;
      lines.push(
        `   ${count} version${pluralize(count)} with changes available`,
      );
      lines.push("");
      lines.push("Run 'linear upgrade review' to see what changed");
    }
    return `${lines.join("\n")}\n`;
  }
  if (!result.previous_version) {
    return `linear version: v${result.current_version} (first run or version tracking just enabled)\n`;
  }
  return `linear version: v${result.current_version} (no upgrade detected)\n`;
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

export interface RunUpgradeReviewOpts {
  currentVersion: string;
  lastSeenVersion?: string;
  changelog?: VersionChange[];
}

export interface UpgradeReviewResult {
  current_version: string;
  previous_version: string;
  new_versions: VersionChange[];
}

/**
 * Compute the changelog entries to show for `linear upgrade review`.
 * Returns the entries between the last-seen and current version in
 * chronological order. When there is no previous version recorded, or the
 * current version is not newer, `new_versions` is empty and callers branch on
 * `previous_version === ""` / equality to render the appropriate hint.
 */
export function runUpgradeReview(
  opts: RunUpgradeReviewOpts,
): UpgradeReviewResult {
  const previousVersion = opts.lastSeenVersion ?? getLastSeenVersion();
  const changelog = opts.changelog ?? versionChanges;

  const upgraded =
    previousVersion !== "" &&
    previousVersion !== opts.currentVersion &&
    compareVersions(opts.currentVersion, previousVersion) > 0;

  return {
    current_version: opts.currentVersion,
    previous_version: previousVersion,
    new_versions: upgraded ? getVersionsSince(previousVersion, changelog) : [],
  };
}

export function formatUpgradeReview(result: UpgradeReviewResult): string {
  if (result.previous_version === "") {
    return [
      "No previous version recorded",
      "Run 'linear info --whats-new' to see recent changes",
      "",
    ].join("\n");
  }

  if (
    compareVersions(result.current_version, result.previous_version) <= 0 ||
    result.new_versions.length === 0
  ) {
    // Either already current / a downgrade, or current is newer but the
    // version is not documented in the changelog.
    if (compareVersions(result.current_version, result.previous_version) <= 0) {
      return [
        `You're already on v${result.current_version} (no upgrade detected)`,
        "Run 'linear info --whats-new' to see recent changes",
        "",
      ].join("\n");
    }
    return [
      "",
      `🔄 Upgraded from v${result.previous_version} to v${result.current_version}`,
      "=".repeat(60),
      "",
      `v${result.current_version} is newer than v${result.previous_version} but not in changelog`,
      "Run 'linear info --whats-new' to see recent documented changes",
      "",
    ].join("\n");
  }

  const lines: string[] = [
    "",
    `🔄 Upgraded from v${result.previous_version} to v${result.current_version}`,
    "=".repeat(60),
    "",
  ];
  for (const vc of result.new_versions) {
    const marker = vc.version === result.current_version ? " ← current" : "";
    lines.push(`## v${vc.version} (${vc.date})${marker}`);
    lines.push("");
    for (const change of vc.changes) {
      lines.push(`  • ${change}`);
    }
    lines.push("");
  }
  lines.push("💡 Run 'linear upgrade ack' to mark this version as seen");
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// ack
// ---------------------------------------------------------------------------

export interface RunUpgradeAckOpts {
  currentVersion: string;
  lastSeenVersion?: string;
  /** Injected for tests; defaults to persisting via config-store. */
  persist?: (version: string) => void;
}

export interface UpgradeAckResult {
  acknowledged: true;
  current_version: string;
  previous_version: string;
}

/**
 * Record the current version as acknowledged. Reads the prior last-seen
 * version (for the message), then persists the current version. Linear has no
 * in-session global flags or PersistentPreRun-driven session state.
 *
 * Side effect: writes `linear.last_seen_version` to ~/.linear/config.json.
 */
export function runUpgradeAck(opts: RunUpgradeAckOpts): UpgradeAckResult {
  const previousVersion = opts.lastSeenVersion ?? getLastSeenVersion();
  const persist = opts.persist ?? setLastSeenVersion;
  persist(opts.currentVersion);
  return {
    acknowledged: true,
    current_version: opts.currentVersion,
    previous_version: previousVersion,
  };
}

export function formatUpgradeAck(result: UpgradeAckResult): string {
  if (result.previous_version === result.current_version) {
    return `✓ Already on v${result.current_version}\n`;
  }
  if (result.previous_version === "") {
    return `✓ Acknowledged linear v${result.current_version}\n`;
  }
  return `✓ Acknowledged upgrade from v${result.previous_version} to v${result.current_version}\n`;
}
