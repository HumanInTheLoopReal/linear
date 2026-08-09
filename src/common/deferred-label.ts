/**
 * Shared semantics for Linear-Hack deferred/snooze labels. (lin-dpp1)
 *
 * `linear snooze` and the deferred-issue triage flow attach two labels:
 *   - `deferred`                          — sticky "do not surface" tag
 *   - `deferred-until:<YYYY-MM-DD>`       — wake-up date, or
 *   - `deferred-until:<YYYY-MM-DDTHHMM>`  — sub-day wake-up instant (UTC,
 *                                           minute precision, colon-free time
 *                                           so the label stays Linear-friendly
 *                                           and lexicographically sortable)
 *
 * The wake-up instant is the source of truth when present. If at least one
 * `deferred-until:` label points to a future instant, the issue is
 * deferred. If every recorded instant is in the past, the issue resurfaces
 * even if the bare `deferred` label is still attached (snooze always
 * sets both; users / agents sometimes forget to strip them). When NO
 * `deferred-until:` label is present at all, the bare `deferred` label
 * is authoritative.
 *
 * Before this helper, `linear next` and `linear issues status` each
 * inlined slightly different deferred-detection logic, so their
 * "Ready-to-Work" counts disagreed by the number of stale-snooze rows
 * in the workspace — the bug fix that motivates this module.
 */

export const DEFERRED_LABEL = "deferred";
export const DEFERRED_UNTIL_PREFIX = "deferred-until:";

export interface LabelLike {
  name: string;
}

export interface LabelsLike {
  nodes: ReadonlyArray<LabelLike>;
}

// A resurface suffix is either a date (`YYYY-MM-DD`) or a UTC datetime with
// minute precision and a colon-free time (`YYYY-MM-DDTHHMM`). The colon-free
// time keeps the label name to a single colon (Linear-friendly) and preserves
// lexicographic ordering. (lin-b7hb)
const DEFER_SUFFIX_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})(\d{2}))?$/;

/**
 * Parse a `deferred-until:` suffix into a UTC epoch (ms), or null if it is not
 * a valid date / datetime. A bare date resolves to 00:00:00Z of that day, so a
 * day-granular snooze resurfaces at the start of the date — exactly the old
 * string-comparison behaviour. A datetime resolves to that minute. (lin-b7hb)
 */
export function deferInstant(suffix: string): number | null {
  const m = DEFER_SUFFIX_RE.exec(suffix);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] !== undefined ? Number(m[4]) : 0;
  const minute = m[5] !== undefined ? Number(m[5]) : 0;
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  const d = new Date(ms);
  // Reject overflow (e.g. month 13, hour 24) via a UTC round-trip.
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return ms;
}

/**
 * Normalize a `now` argument to a UTC epoch (ms). A number is taken as an
 * instant; a `YYYY-MM-DD` string resolves to that day's 00:00:00Z (so callers
 * injecting a date keep the legacy day-granular semantics); any other string
 * is parsed as an ISO instant.
 */
function toNowMs(now: number | string): number {
  if (typeof now === "number") return now;
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(now)
    ? Date.parse(`${now}T00:00:00Z`)
    : Date.parse(now);
  return Number.isNaN(ms) ? Date.now() : ms;
}

/**
 * Decide whether an issue's labels classify it as deferred *as of* `now`
 * (a UTC epoch in ms, or a `YYYY-MM-DD` string → that day's start). The
 * resurface date is compared as an INSTANT, so a sub-day `deferred-until:`
 * datetime resurfaces at the right minute (lin-b7hb). See the module docstring
 * for precedence. Called by both `next-service` and `stats-service` so the two
 * surfaces agree on the "ready" / "deferred" partition; production passes
 * `Date.now()` for true sub-day accuracy.
 */
export function isDeferred(
  labels: LabelsLike | null | undefined,
  now: number | string,
): boolean {
  const nowMs = toNowMs(now);
  const names = labels?.nodes?.map((l) => l.name) ?? [];
  const instants = names
    .filter((n) => n.startsWith(DEFERRED_UNTIL_PREFIX))
    .map((n) => deferInstant(n.slice(DEFERRED_UNTIL_PREFIX.length)))
    .filter((i): i is number => i !== null);

  if (instants.length > 0) {
    return instants.some((i) => i > nowMs);
  }
  return names.includes(DEFERRED_LABEL);
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True iff `value` is a real `YYYY-MM-DD` calendar date. Rejects both
 * malformed shapes (`next-week`, ``) and impossible dates (`2026-13-40`,
 * `2026-02-30`) by round-tripping through `Date` and checking the parts
 * survived — the same validation `parseDueDate` uses, factored out so the
 * snooze-hygiene scan can classify a `deferred-until:` suffix without
 * throwing. (lin-ay7q)
 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/**
 * Extract the `YYYY-MM-DD` resurface date of every VALID `deferred-until:`
 * suffix on an issue's labels (malformed suffixes are dropped). A sub-day
 * datetime suffix contributes its DATE portion, so the date-granular
 * `--defer-before/after` window filter keeps working without
 * caring about the time. Snooze guarantees ≤1, but drift can leave several;
 * callers decide how to combine them.
 */
export function deferUntilDates(
  labels: LabelsLike | null | undefined,
): string[] {
  const names = labels?.nodes?.map((l) => l.name) ?? [];
  return names
    .filter((n) => n.startsWith(DEFERRED_UNTIL_PREFIX))
    .map((n) => n.slice(DEFERRED_UNTIL_PREFIX.length))
    .filter((s) => deferInstant(s) !== null)
    .map((s) => s.slice(0, 10));
}

/**
 * True when an issue's resurface date falls in the open window
 * `(after, before)` — i.e. there is at least one valid `deferred-until:` date
 * `d` with `d > after` (when set) and `d < before` (when set). Bounds are
 * strict: the resurface date must be strictly greater than `after` and strictly
 * less than `before`. Issues with no valid resurface date never match (you
 * cannot range-filter an absent date).
 */
export function matchesDeferWindow(
  labels: LabelsLike | null | undefined,
  after: string | undefined,
  before: string | undefined,
): boolean {
  const dates = deferUntilDates(labels);
  return dates.some(
    (d) =>
      (after === undefined || d > after) &&
      (before === undefined || d < before),
  );
}

/** A single kind of snooze-label drift surfaced by {@link auditDeferral}. */
export type DeferralProblemKind =
  | "malformed-date"
  | "multiple-dates"
  | "orphaned-until"
  | "stale";

export interface DeferralProblem {
  kind: DeferralProblemKind;
  /** Human-readable specifics (the offending label(s) / dates). */
  detail: string;
}

export interface DeferralAudit {
  /** Whether the bare `deferred` tag is present. */
  hasDeferredLabel: boolean;
  /** Full `deferred-until:*` label names found on the issue. */
  untilLabels: string[];
  /** Drift detected; empty array means the snooze state is clean. */
  problems: DeferralProblem[];
}

/**
 * Classify an issue's deferred/snooze labels for drift, *as of* `now`.
 * A clean snooze is either a bare `deferred` (indefinite) or a single
 * `deferred-until:<future-instant>` paired with `deferred`; anything else is
 * reported so `linear snooze verify` can flag it. Pure and deterministic —
 * `now` is injected (a UTC epoch in ms, or a `YYYY-MM-DD` string → that day's
 * start) exactly like {@link isDeferred}, so a sub-day datetime suffix is
 * staleness-checked against the real instant.
 *
 * Drift kinds:
 *   - `malformed-date`  a `deferred-until:` suffix that is not a real
 *                       date / `YYYY-MM-DDTHHMM` datetime
 *   - `multiple-dates`  >1 `deferred-until:` label (snooze guarantees ≤1)
 *   - `orphaned-until`  a `deferred-until:` without the bare `deferred` tag
 *   - `stale`           every valid resurface instant has passed yet labels
 *                       remain (already resurfaces in `next`; run `wake`)
 */
export function auditDeferral(
  labels: LabelsLike | null | undefined,
  now: number | string,
): DeferralAudit {
  const nowMs = toNowMs(now);
  const names = labels?.nodes?.map((l) => l.name) ?? [];
  const hasDeferredLabel = names.includes(DEFERRED_LABEL);
  const untilLabels = names.filter((n) => n.startsWith(DEFERRED_UNTIL_PREFIX));
  const problems: DeferralProblem[] = [];

  for (const name of untilLabels) {
    if (deferInstant(name.slice(DEFERRED_UNTIL_PREFIX.length)) === null) {
      problems.push({ kind: "malformed-date", detail: name });
    }
  }

  if (untilLabels.length > 1) {
    problems.push({ kind: "multiple-dates", detail: untilLabels.join(", ") });
  }

  if (untilLabels.length > 0 && !hasDeferredLabel) {
    problems.push({
      kind: "orphaned-until",
      detail: `${untilLabels.join(", ")} present without the bare \`deferred\` label`,
    });
  }

  // Stale: at least one VALID resurface instant and every valid instant is at
  // or before `now`. `isDeferred` would already return false for these, so the
  // issue is back in `next` while the labels linger — `wake` cleans them up.
  // Malformed suffixes are excluded (flagged separately) so a single bad
  // suffix never masquerades as "resurfaced".
  const validSuffixes = untilLabels
    .map((n) => n.slice(DEFERRED_UNTIL_PREFIX.length))
    .filter((s) => deferInstant(s) !== null);
  const allPassed = validSuffixes.every(
    (s) => (deferInstant(s) as number) <= nowMs,
  );
  if (validSuffixes.length > 0 && allPassed) {
    problems.push({
      kind: "stale",
      detail: `resurface date ${validSuffixes.join(", ")} has passed; run \`linear wake\` to clear the labels`,
    });
  }

  return { hasDeferredLabel, untilLabels, problems };
}
