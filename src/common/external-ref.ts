/**
 * Linear-Hack for an external-reference field (lin-qev5).
 *
 * An issue carries at most one external reference (e.g. a GitHub/Jira/ADO
 * key) so a sync agent can stamp the upstream id and later look the issue back
 * up by it. Linear has no equivalent scalar field, and an attachment URL is a
 * hyperlink — not a token you can filter on. So we encode the reference as a
 * `ref:<value>` workspace label, which IS queryable via the existing
 * `--label ref:<value>` filter on `issues list`/`query`.
 *
 * An issue carries at most one `ref:*` label (the external reference is
 * singular); `update --external-ref` replaces any prior one, with set-or-clear
 * semantics.
 */

export const REF_LABEL_PREFIX = "ref:";

/** True for a label name that encodes an external reference (`ref:<value>`). */
export function isRefLabel(name: string): boolean {
  return name.startsWith(REF_LABEL_PREFIX);
}

/** The workspace-label name that encodes `ref` (e.g. `gh-123` → `ref:gh-123`). */
export function refLabelName(ref: string): string {
  return `${REF_LABEL_PREFIX}${ref.trim()}`;
}

/** The reference value carried by a `ref:<value>` label, or null if not one. */
export function refValue(name: string): string | null {
  return isRefLabel(name) ? name.slice(REF_LABEL_PREFIX.length) : null;
}
