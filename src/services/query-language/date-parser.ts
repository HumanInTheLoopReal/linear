/**
 * Parse a value token from the query language as a date/timestamp.
 *
 * Accepts:
 *   - Duration tokens (DURATION): 7d, 24h, 2w, 1m (month), 1y → resolved
 *     RELATIVE to `now`. `>7d` means "more than 7 days ago" — i.e.
 *     older than (now - 7d). Durations are interpreted as "duration
 *     ago" and emit an ISO timestamp at (now - duration).
 *   - Numeric tokens (NUMBER) interpreted as seconds-ago.
 *   - Quoted strings or bare identifiers in ISO 8601 form
 *     (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ).
 *
 * Returns an ISO 8601 string suitable for Linear's `*At` comparison
 * filters (gte / lte / gt / lt).
 */

const SUFFIX_TO_MS: Record<string, number> = {
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  m: 30 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

export function resolveDateValue(
  value: string,
  valueKind: "IDENT" | "STRING" | "NUMBER" | "DURATION",
  now: Date,
): string {
  if (valueKind === "DURATION") {
    const m = /^(\d+)([hdwmyHDWMY])$/.exec(value);
    if (!m) throw new Error(`invalid duration '${value}'`);
    const n = Number.parseInt(m[1], 10);
    const ms = SUFFIX_TO_MS[m[2].toLowerCase()];
    return new Date(now.getTime() - n * ms).toISOString();
  }
  if (valueKind === "NUMBER") {
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n)) throw new Error(`invalid numeric date '${value}'`);
    return new Date(now.getTime() - n * 1000).toISOString();
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00.000Z`).toISOString();
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`unable to parse date '${value}'`);
  }
  return parsed.toISOString();
}
