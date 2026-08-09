const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export interface IssueIdentifier {
  teamKey: string;
  issueNumber: number;
}

/** @throws Error if identifier format is invalid */
export function parseIssueIdentifier(identifier: string): IssueIdentifier {
  const parts = identifier.split("-");

  if (parts.length !== 2) {
    throw new Error(
      `Invalid issue identifier format: "${identifier}". Expected format: TEAM-123`,
    );
  }

  const teamKey = parts[0];
  const issueNumber = parseInt(parts[1], 10);

  if (Number.isNaN(issueNumber)) {
    throw new Error(`Invalid issue number in identifier: "${identifier}"`);
  }

  return { teamKey, issueNumber };
}

export function tryParseIssueIdentifier(
  identifier: string,
): IssueIdentifier | null {
  try {
    return parseIssueIdentifier(identifier);
  } catch {
    // parseIssueIdentifier throws on invalid format — return null per try-parse contract
    return null;
  }
}

const DUE_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** @throws Error if date format is invalid or date doesn't exist */
export function parseDueDate(value: string): string {
  if (!DUE_DATE_REGEX.test(value)) {
    throw new Error(
      `Invalid due date format: "${value}". Expected format: YYYY-MM-DD`,
    );
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(`Invalid due date: "${value}". The date does not exist.`);
  }

  return value;
}

const RELATIVE_DURATION_REGEX = /^(\d+)(d|w|mo|y)$/;

/**
 * Parse a compact relative-duration string into a future YYYY-MM-DD. Units:
 *
 *   d   days   (`1d`, `7d`)
 *   w   weeks  (`1w`, `2w`)
 *   mo  months (`1mo`, `3mo`) — calendar-month aware; landing on the 31st
 *       of a 30-day month clamps to the last day of that month (JS Date's
 *       native overflow behavior).
 *   y   years  (`1y`)
 *
 * Used by `linear snooze --for <duration>` so callers don't have to compute
 * a target date by hand. Pass `today` to make the function deterministic
 * for tests; defaults to `new Date()`. (lin-j56l)
 *
 * @throws Error if the value doesn't match the expected shape.
 */
export function parseRelativeDuration(value: string, today?: Date): string {
  const match = RELATIVE_DURATION_REGEX.exec(value);
  if (!match) {
    throw new Error(
      `Invalid duration: "${value}". Expected format: <n><unit> where unit is one of d, w, mo, y (e.g. 7d, 2w, 1mo).`,
    );
  }
  const n = Number.parseInt(match[1], 10);
  const unit = match[2];
  const base = today ?? new Date();
  const result = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (unit === "d") result.setDate(result.getDate() + n);
  else if (unit === "w") result.setDate(result.getDate() + n * 7);
  else if (unit === "mo") result.setMonth(result.getMonth() + n);
  else if (unit === "y") result.setFullYear(result.getFullYear() + n);

  const y = result.getFullYear();
  const m = String(result.getMonth() + 1).padStart(2, "0");
  const d = String(result.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
