/**
 * Resurface-input parsing for `linear snooze --until` / `--for` (lin-b7hb,
 * lin-ipd3).
 *
 * Day-granular `parseDueDate` / `parseRelativeDuration` (units d/w/mo/y) are
 * extended here with sub-day and natural-language inputs:
 *
 *   --until accepts, in addition to `YYYY-MM-DD`:
 *     - natural-language anchors: `today`, `tomorrow`, `next week`,
 *       `next month`, a bare weekday (`friday` → soonest future Friday),
 *       or `next <weekday>` (the following week's occurrence)
 *     - an ISO datetime `YYYY-MM-DDTHH:MM[:SS][Z|±HH:MM]`; a naive datetime
 *       (no zone) is interpreted as UTC
 *
 *   --for accepts, in addition to d/w/mo/y, an `h` (hours) unit (`6h`).
 *
 * Both helpers return a `deferred-until:` SUFFIX — `YYYY-MM-DD` for day
 * granularity, or `YYYY-MM-DDTHHMM` (UTC, minute precision, colon-free time)
 * for sub-day — i.e. exactly what {@link deferInstant} consumes. `now` is
 * injected so the natural-language / hours math is deterministic in tests.
 */

import { parseDueDate, parseRelativeDuration } from "./identifier.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// Sunday-indexed to line up with Date#getUTCDay().
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a UTC instant as a day-granular `YYYY-MM-DD` suffix. */
function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Format a UTC instant as a minute-precision `YYYY-MM-DDTHHMM` suffix. */
function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${formatDate(ms)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/** Midnight-UTC instant of `now`'s calendar day, plus that day's weekday. */
function startOfUtcDay(now: Date): { ms: number; dow: number } {
  const ms = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return { ms, dow: new Date(ms).getUTCDay() };
}

// `YYYY-MM-DDTHH:MM[:SS][Z|±HHMM|±HH:MM]`, also tolerating a space separator.
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/i;
const WEEKDAY_RE =
  /^(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/;

/**
 * Parse a `--until` value into a `deferred-until:` suffix. Resolution order:
 * natural-language anchor → ISO datetime → plain `YYYY-MM-DD`. Anchors and
 * naive datetimes are computed in UTC so they line up with `deferInstant`.
 *
 * @throws Error if `input` matches none of the accepted forms.
 */
export function parseSnoozeUntil(
  input: string,
  now: Date = new Date(),
): string {
  const raw = input.trim();
  const lower = raw.toLowerCase();
  const sod = startOfUtcDay(now);

  if (lower === "today") return formatDate(sod.ms);
  if (lower === "tomorrow") return formatDate(sod.ms + DAY_MS);
  if (lower === "next week") return formatDate(sod.ms + 7 * DAY_MS);
  if (lower === "next month") {
    const d = new Date(sod.ms);
    return formatDate(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()),
    );
  }

  const weekday = WEEKDAY_RE.exec(lower);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]);
    let delta = (target - sod.dow + 7) % 7;
    if (delta === 0) delta = 7; // bare weekday → soonest STRICTLY-future day
    if (weekday[1]) delta += 7; // `next <weekday>` → the following week
    return formatDate(sod.ms + delta * DAY_MS);
  }

  const dt = ISO_DATETIME_RE.exec(raw);
  if (dt) {
    const hasZone = dt[7] !== undefined;
    // Normalize the separator and pin a naive datetime to UTC before parsing.
    const iso = raw.replace(" ", "T") + (hasZone ? "" : "Z");
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) {
      throw new Error(`Invalid datetime: "${input}".`);
    }
    return formatDateTime(ms);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return parseDueDate(raw);
  }

  throw new Error(
    `Invalid resurface date: "${input}". Accepted: YYYY-MM-DD, an ISO datetime ` +
      `(YYYY-MM-DDTHH:MM — naive treated as UTC), or a natural-language anchor ` +
      `(today, tomorrow, next week, next month, a weekday like "friday", or "next friday").`,
  );
}

const FOR_RE = /^(\d+)(h|d|w|mo|y)$/;

/**
 * Parse a `--for` value into a `deferred-until:` suffix. An `h` (hours) unit
 * yields a sub-day `YYYY-MM-DDTHHMM` instant (UTC); d/w/mo/y delegate to
 * {@link parseRelativeDuration} and yield a `YYYY-MM-DD` date.
 *
 * @throws Error if `input` is not `<n><unit>` with unit in h/d/w/mo/y.
 */
export function parseSnoozeFor(input: string, now: Date = new Date()): string {
  const trimmed = input.trim();
  const m = FOR_RE.exec(trimmed);
  if (!m) {
    throw new Error(
      `Invalid duration: "${input}". Expected <n><unit> where unit is one of ` +
        `h, d, w, mo, y (e.g. 6h, 7d, 2w, 1mo, 1y).`,
    );
  }
  if (m[2] === "h") {
    return formatDateTime(now.getTime() + Number.parseInt(m[1], 10) * HOUR_MS);
  }
  return parseRelativeDuration(trimmed, now);
}

/**
 * Parse a single `--defer <when>` value (`issues create --defer`, lin-ov30.4)
 * into a `deferred-until:` suffix. Unlike snooze's separate `--until` / `--for`
 * flags, one arg here accepts BOTH forms — matching the single `--defer` flag:
 * a relative duration `<n><unit>` (optionally `+`-prefixed, e.g. `+6h`, `7d`)
 * routes to {@link parseSnoozeFor}; anything else (a `YYYY-MM-DD` date, an ISO
 * datetime, or a natural-language anchor like `tomorrow`) to
 * {@link parseSnoozeUntil}.
 */
export function parseDeferWhen(input: string, now: Date = new Date()): string {
  const trimmed = input.trim().replace(/^\+/, "");
  if (FOR_RE.test(trimmed)) {
    return parseSnoozeFor(trimmed, now);
  }
  return parseSnoozeUntil(trimmed, now);
}
