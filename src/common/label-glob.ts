import type { IssueFilter, NullableStringComparator } from "../gql/graphql.js";

/**
 * Label-name glob matching (lin-ym1m).
 *
 * Agents encode issue metadata in namespaced labels (`type:*`, `state:*`,
 * `deferred-until:*`), so selecting a whole family without enumerating every
 * exact label is a core need. Linear's API has no server-side regex or glob,
 * but its `NullableStringComparator` exposes `startsWith` / `endsWith` /
 * `contains` (and their negations), which cover the three glob shapes that
 * matter:
 *
 *   prefix*    → name startsWith prefix      (e.g. `type:*`)
 *   *suffix    → name endsWith suffix        (e.g. `*-debt`)
 *   *infix*    → name contains infix         (e.g. `*debt*`)
 *
 * These stay Linear-Direct (pushed server-side, no client fetch-all). Interior
 * or multi-`*` globs (`a*b`, `*a*b*`) and the single-char `?` wildcard have no
 * server equivalent, so they throw `LabelGlobError` with guidance rather than
 * silently degrading to a full-table scan.
 */

export class LabelGlobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelGlobError";
  }
}

/** A label value is a glob when it carries a `*` or `?` wildcard. */
export function isLabelGlob(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

/**
 * Translate a label-name glob into a server-side Linear label filter.
 *
 * Positive globs use `some` ("≥1 label matches"); negated globs use `every`
 * with the inverse operator ("no label matches" — issues with zero labels pass
 * vacuously, which is the desired set-complement). This mirrors the polarity
 * handling already used for `--exclude-label`.
 */
export function globToLabelFilter(value: string, negated = false): IssueFilter {
  if (value.includes("?")) {
    throw new LabelGlobError(
      `single-char wildcard '?' in '${value}' has no Linear equivalent; ` +
        "use a '*' prefix/suffix/contains glob",
    );
  }

  const stars = value.split("*").length - 1;
  const endsStar = value.endsWith("*");
  const startsStar = value.startsWith("*");

  let positive: NullableStringComparator;
  let negative: NullableStringComparator;
  let literal: string;

  if (stars === 1 && endsStar && !startsStar) {
    literal = value.slice(0, -1);
    positive = { startsWith: literal };
    negative = { notStartsWith: literal };
  } else if (stars === 1 && startsStar && !endsStar) {
    literal = value.slice(1);
    positive = { endsWith: literal };
    negative = { notEndsWith: literal };
  } else if (stars === 2 && startsStar && endsStar) {
    literal = value.slice(1, -1);
    positive = { contains: literal };
    negative = { notContains: literal };
  } else {
    throw new LabelGlobError(
      `glob '${value}' is not a simple prefix*/*suffix/*infix* pattern; ` +
        "Linear cannot match interior or multi-'*' globs server-side",
    );
  }

  if (literal.length === 0) {
    throw new LabelGlobError(
      `glob '${value}' has an empty pattern; ` +
        "use 'label=none' / 'label!=none' to test label presence",
    );
  }

  return negated
    ? { labels: { every: { name: negative } } }
    : { labels: { some: { name: positive } } };
}
