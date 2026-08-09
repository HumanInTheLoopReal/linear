/**
 * Hardcoded changelog driving `linear upgrade review`.
 *
 * The `versionChanges[]` ordered slice and its `VersionChange` struct. The
 * content is linear-cli-specific: this history starts at the linear-cli
 * launch under calendar versioning (`YYYY.M.PATCH`).
 *
 * INVARIANT: the array is ordered newest-first (index 0 is the most recent
 * release). `getVersionsSince()` in `upgrade-service.ts` relies on this
 * ordering. Add new releases at the TOP of the array.
 */

/** Agent-relevant changes for a specific CLI version. */
export interface VersionChange {
  version: string;
  date: string;
  changes: string[];
}

/**
 * Newest-first changelog. Each `version` matches the calendar-versioned
 * `package.json` version at that release. `date` is ISO `YYYY-MM-DD`.
 */
export const versionChanges: VersionChange[] = [
  {
    version: "2026.4.9",
    date: "2026-05-31",
    changes: [
      "NEW: `linear upgrade` command family (status/review/ack) tracks the CLI version you last acknowledged and surfaces what changed since.",
      "NEW: version tracking persists `linear.last_seen_version` in ~/.linear/config.json (override with LINEAR_LAST_SEEN_VERSION); no local database required.",
      "CHANGE: `linear upgrade review` shows the full changelog since your last-seen version, unlike `linear info --whats-new` which shows only the highlight blurb.",
    ],
  },
  {
    version: "2026.4.8",
    date: "2026-05-30",
    changes: [
      "NEW: `linear doctor` workspace-health probe (auth, stale issues, unassigned work, label hygiene).",
      "NEW: `linear preflight` fast pre-PR readiness check.",
      "FIX: issue-resolver caching reduces duplicate GraphQL lookups within a single command.",
    ],
  },
  {
    version: "2026.4.7",
    date: "2026-05-28",
    changes: [
      "NEW: `linear setup <recipe>` installs editor integration (cursor, claude, codex) with managed config sections.",
      "NEW: `linear where` reports on-disk linear side-file locations and the resolved token source.",
      "CHANGE: read-only verbs default to human-readable text; pass `--json` (or `--json=compact`) for the structured envelope.",
    ],
  },
  {
    version: "2026.4.6",
    date: "2026-05-24",
    changes: [
      "NEW: `linear batch` executes multiple create/update/close operations from a script file.",
      "NEW: team resolution accepts team key, name, or UUID interchangeably across all commands.",
      "FIX: GraphQL client retries transient 5xx responses with backoff instead of failing the command.",
    ],
  },
];
