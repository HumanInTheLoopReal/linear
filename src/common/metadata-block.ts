/**
 * Linear-Hack for an arbitrary-JSON metadata field (lin-e64s).
 *
 * Stores arbitrary JSON metadata per issue (agent run-ids, provenance,
 * sync bookkeeping). Linear has no metadata field, so we round-trip it as a
 * fenced ```` ```metadata ```` code block appended to the description:
 *
 *     <the real description>
 *
 *     ```metadata
 *     { "run_id": "abc", "source": "sync" }
 *     ```
 *
 * `read --json` surfaces a parsed `metadata` object; `create`/`update` write
 * and merge it. The block is kept LAST in the description and serialized with
 * sorted keys so re-writes are stable (deterministic diffs).
 *
 * Read is lenient (a malformed block parses to null rather than throwing) so a
 * hand-edited description never breaks `read`; write input is strict (invalid
 * JSON is rejected up front), enforcing a "must be valid JSON" gate.
 */

/** A metadata object — JSON keys to arbitrary JSON values. */
export type Metadata = Record<string, unknown>;

// Capture the JSON body of a ```metadata fenced block. Tolerant of an optional
// leading newline and trailing whitespace inside the fence.
const METADATA_BLOCK_RE = /```metadata[ \t]*\r?\n([\s\S]*?)\r?\n?```/;

function isPlainObject(value: unknown): value is Metadata {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse `raw` as a JSON object, throwing a descriptive error if it is not
 * valid JSON or not an object. Used for write-side `--metadata <json>` input
 * (strict, like the create/update gate).
 */
export function parseMetadataJson(raw: string): Metadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON in --metadata: must be valid JSON");
  }
  if (!isPlainObject(parsed)) {
    throw new Error("invalid --metadata: must be a JSON object");
  }
  return parsed;
}

/**
 * Extract the parsed metadata object from a description, or null when there is
 * no (valid) ```metadata block. Lenient: a malformed block yields null.
 */
export function extractMetadata(
  description: string | null | undefined,
): Metadata | null {
  if (!description) return null;
  const match = METADATA_BLOCK_RE.exec(description);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Remove the ```metadata block (and the blank line that separated it) from a
 * description, returning just the human body with trailing whitespace trimmed.
 */
export function stripMetadataBlock(
  description: string | null | undefined,
): string {
  if (!description) return "";
  return description.replace(METADATA_BLOCK_RE, "").replace(/\s+$/, "");
}

/** Serialize a metadata object as a fenced ```metadata block (sorted keys). */
export function serializeMetadataBlock(metadata: Metadata): string {
  const sorted: Metadata = {};
  for (const key of Object.keys(metadata).sort()) {
    sorted[key] = metadata[key];
  }
  return ["```metadata", JSON.stringify(sorted, null, 2), "```"].join("\n");
}

/**
 * Return `description` with its metadata block replaced by `metadata`. A null
 * or empty object removes the block entirely. The block is always re-appended
 * LAST, after the (block-stripped) body.
 */
export function withMetadataBlock(
  description: string | null | undefined,
  metadata: Metadata | null,
): string {
  const body = stripMetadataBlock(description);
  if (!metadata || Object.keys(metadata).length === 0) {
    return body;
  }
  const block = serializeMetadataBlock(metadata);
  return body.length > 0 ? `${body}\n\n${block}` : block;
}

/** Shallow-merge `incoming` over `existing` (shallow-merge update semantics). */
export function mergeMetadata(
  existing: Metadata | null,
  incoming: Metadata,
): Metadata {
  return { ...(existing ?? {}), ...incoming };
}

/**
 * Coerce a `--set-metadata key=value` value to a JSON value, preserving number
 * / boolean / null / object / array when the value parses as JSON, else
 * keeping it as a string.
 */
function coerceMetadataValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Apply `--set-metadata key=value` and `--unset-metadata key` edits to an
 * existing metadata object. `sets` entries must contain `=`.
 */
export function applyMetadataEdits(
  existing: Metadata | null,
  sets: string[],
  unsets: string[],
): Metadata {
  const out: Metadata = { ...(existing ?? {}) };
  for (const kv of sets) {
    const eq = kv.indexOf("=");
    if (eq <= 0) {
      throw new Error(
        `invalid --set-metadata: expected key=value, got "${kv}"`,
      );
    }
    const key = kv.slice(0, eq);
    out[key] = coerceMetadataValue(kv.slice(eq + 1));
  }
  for (const key of unsets) {
    delete out[key];
  }
  return out;
}
