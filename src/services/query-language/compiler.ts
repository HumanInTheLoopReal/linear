/**
 * Compiler from the query AST to a Linear `IssueFilter`.
 *
 * Linear's IssueFilter natively supports compound `and: []` / `or: []`
 * arrays, so AND/OR/leaf-NOT nodes can be pushed entirely server-side.
 * The compiler emits a single `IssueFilter` per AST root.
 *
 * NOT is supported only on leaf comparisons (negation via inverse
 * operator). Nesting NOT around AND/OR throws `UnsupportedQueryError`;
 * users can rewrite manually via De Morgan's law.
 *
 * Fields that have no Linear-Direct equivalent throw
 * `UnsupportedFieldError` with a clear message.
 *
 * Status mapping (query vocabulary → Linear state.type):
 *   open        → state.type IN [triage, backlog, unstarted]
 *   in_progress → state.type = started
 *   closed      → state.type IN [completed, canceled, duplicate]
 *   blocked     → hasBlockedByRelations.eq = true (Linear primitive)
 *   deferred    → labels.name = "deferred" (Linear-Hack)
 *
 * Priority numbers use Linear's scheme directly:
 *   0=no priority, 1=urgent, 2=high, 3=medium, 4=low.
 *
 * Type field compiles to a `type:<value>` label match.
 */

import { stateTypesForLogicalStatus } from "../../common/issue-lifecycle.js";
import {
  globToLabelFilter,
  isLabelGlob,
  LabelGlobError,
} from "../../common/label-glob.js";
import { extractMetadata } from "../../common/metadata-block.js";
import type { IssueFilter } from "../../gql/graphql.js";
import { resolveDateValue } from "./date-parser.js";
import type {
  ComparisonNode,
  ComparisonOp,
  Node,
  ValueKind,
} from "./parser.js";

export class UnsupportedQueryError extends Error {}
export class UnsupportedFieldError extends Error {}

/**
 * A client-side predicate over an issue's description (which carries the
 * Linear-Hack ```metadata block). Metadata has no server-side IssueFilter
 * equivalent, so `metadata.<key>` conditions are evaluated after fetch.
 * (lin-ov30.1)
 */
export type MetadataPredicate = (
  description: string | null | undefined,
) => boolean;

export interface CompiledQuery {
  filter: IssueFilter;
  /**
   * `metadata.<key>` conditions to apply client-side (AND-combined) to the
   * fetched issues; empty for queries with no metadata filter.
   */
  metadataPredicates: MetadataPredicate[];
}

const METADATA_PREFIX = "metadata.";

function isMetadataField(field: string): boolean {
  return field.startsWith(METADATA_PREFIX);
}

const FIELD_ALIASES: Record<string, string> = {
  desc: "description",
  labels: "label",
  created_at: "created",
  updated_at: "updated",
  closed_at: "closed",
  spec_id: "spec",
};

const UNSUPPORTED_FIELDS = new Set([
  "owner",
  "notes",
  "pinned",
  "ephemeral",
  "template",
  "spec",
  "mol_type",
  "has_metadata_key",
]);

function canonicalField(field: string): string {
  return FIELD_ALIASES[field] ?? field;
}

export function compile(node: Node, now: Date = new Date()): CompiledQuery {
  // Split metadata leaves (client-side) from the server-filterable AST.
  // Metadata lives in the description's ```metadata block, so it has no
  // IssueFilter equivalent and is applied after fetch. (lin-ov30.1)
  const { server, predicates } = splitMetadata(node);
  const filter = server === null ? {} : compileNode(server, now);
  return { filter, metadataPredicates: predicates };
}

interface SplitResult {
  /** The metadata-free AST to compile server-side, or null if none remains. */
  server: Node | null;
  predicates: MetadataPredicate[];
}

function combineAnd(left: Node | null, right: Node | null): Node | null {
  if (left === null) return right;
  if (right === null) return left;
  return { kind: "and", left, right };
}

/**
 * Walk the AST, pulling `metadata.<key>` comparisons out as client-side
 * predicates and returning the remaining server-filterable AST. Metadata is
 * only valid in an AND context (and leaf-NOT, by operator inversion); a
 * metadata leaf under OR or a complex NOT throws — there is no way to combine
 * a client predicate with a server filter under disjunction without fetching
 * the whole workspace. (lin-ov30.1)
 */
function splitMetadata(node: Node): SplitResult {
  switch (node.kind) {
    case "comparison":
      if (isMetadataField(node.field)) {
        return { server: null, predicates: [makeMetadataPredicate(node)] };
      }
      return { server: node, predicates: [] };
    case "and": {
      const l = splitMetadata(node.left);
      const r = splitMetadata(node.right);
      return {
        server: combineAnd(l.server, r.server),
        predicates: [...l.predicates, ...r.predicates],
      };
    }
    case "or": {
      const l = splitMetadata(node.left);
      const r = splitMetadata(node.right);
      if (l.predicates.length > 0 || r.predicates.length > 0) {
        throw new UnsupportedQueryError(
          "metadata.<key> filters can only be combined with AND, not OR (metadata is matched client-side and cannot be merged into a server-side OR).",
        );
      }
      return { server: node, predicates: [] };
    }
    case "not":
      if (
        node.operand.kind === "comparison" &&
        isMetadataField(node.operand.field)
      ) {
        // NOT metadata.x=y  ==  metadata.x!=y (predicate-level inversion).
        return {
          server: null,
          predicates: [makeMetadataPredicate(invertComparison(node.operand))],
        };
      }
      if (splitMetadata(node.operand).predicates.length > 0) {
        throw new UnsupportedQueryError(
          "metadata.<key> can only be negated as a simple comparison (e.g. `NOT metadata.x=y`), not inside a compound NOT.",
        );
      }
      return { server: node, predicates: [] };
  }
}

/** Render a JSON metadata value to the string we compare a query value against. */
function stringifyMetaValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Build a client-side predicate for a `metadata.<key>` comparison. Supports
 * `=`/`!=` only. Sentinel values: `*` (key exists), `none` (key absent);
 * otherwise the stored value is stringified and compared for exact equality
 * (so `metadata.sprint=12` matches whether 12 was stored as a number or a
 * string). The key is taken from the ORIGINAL-case field text. (lin-ov30.1)
 */
function makeMetadataPredicate(node: ComparisonNode): MetadataPredicate {
  if (node.op !== "=" && node.op !== "!=") {
    throw new UnsupportedQueryError(
      `metadata field '${node.fieldRaw}' only supports = and != comparisons`,
    );
  }
  const key = node.fieldRaw.slice(METADATA_PREFIX.length);
  if (key.length === 0) {
    throw new UnsupportedFieldError(
      "metadata filter needs a key, e.g. `metadata.sprint=12`",
    );
  }
  const wantExists = node.value === "*";
  const wantAbsent = node.value.toLowerCase() === "none";
  const negate = node.op === "!=";

  return (description) => {
    const md = extractMetadata(description);
    const has = md !== null && Object.hasOwn(md, key);
    let matches: boolean;
    if (wantExists) {
      matches = has;
    } else if (wantAbsent) {
      matches = !has;
    } else {
      matches =
        has &&
        stringifyMetaValue((md as Record<string, unknown>)[key]) === node.value;
    }
    return negate ? !matches : matches;
  };
}

function compileNode(node: Node, now: Date): IssueFilter {
  switch (node.kind) {
    case "comparison":
      return compileComparison(node, now);
    case "and":
      return {
        and: [compileNode(node.left, now), compileNode(node.right, now)],
      };
    case "or":
      return {
        or: [compileNode(node.left, now), compileNode(node.right, now)],
      };
    case "not":
      if (node.operand.kind !== "comparison") {
        throw new UnsupportedQueryError(
          "NOT is only supported on simple comparisons (e.g., `NOT status=closed`). Rewrite `NOT (a AND b)` as `NOT a OR NOT b` via De Morgan's law.",
        );
      }
      return compileComparison(invertComparison(node.operand), now);
  }
}

const INVERSE_OP: Record<ComparisonOp, ComparisonOp> = {
  "=": "!=",
  "!=": "=",
  "<": ">=",
  "<=": ">",
  ">": "<=",
  ">=": "<",
};

function invertComparison(node: ComparisonNode): ComparisonNode {
  return { ...node, op: INVERSE_OP[node.op] };
}

function compileComparison(node: ComparisonNode, now: Date): IssueFilter {
  const field = canonicalField(node.field);

  if (UNSUPPORTED_FIELDS.has(field)) {
    throw new UnsupportedFieldError(
      `field '${node.field}' has no Linear equivalent and is not supported in queries`,
    );
  }

  switch (field) {
    case "status":
      return compileStatus(node);
    case "priority":
      return compilePriority(node);
    case "type":
      return compileType(node);
    case "assignee":
      return compileAssignee(node);
    case "label":
      return compileLabel(node);
    case "title":
      return compileTitle(node);
    case "description":
      return compileDescription(node);
    case "id":
      return compileId(node);
    case "parent":
      return compileParent(node);
    case "created":
      return compileDate(node, "createdAt", now);
    case "updated":
      return compileDate(node, "updatedAt", now);
    case "closed":
      return compileDate(node, "completedAt", now);
    case "started":
      return compileDate(node, "startedAt", now);
    default:
      throw new UnsupportedFieldError(`unknown query field '${node.field}'`);
  }
}

function assertEquality(node: ComparisonNode): void {
  if (node.op !== "=" && node.op !== "!=") {
    throw new UnsupportedQueryError(
      `field '${node.field}' only supports = and != comparisons`,
    );
  }
}

function compileStatus(node: ComparisonNode): IssueFilter {
  assertEquality(node);
  const value = node.value.toLowerCase();

  if (value === "blocked") {
    return {
      hasBlockedByRelations: { eq: node.op === "=" },
    };
  }

  if (value === "deferred") {
    return node.op === "="
      ? { labels: { name: { eq: "deferred" } } }
      : { labels: { name: { neq: "deferred" } } };
  }

  const stateTypes = stateTypesForLogicalStatus(value) ?? [value];
  if (node.op === "=") {
    return { state: { type: { in: [...stateTypes] } } };
  }
  return { state: { type: { nin: [...stateTypes] } } };
}

function parseIntStrict(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new UnsupportedQueryError(`expected integer, got '${raw}'`);
  }
  return n;
}

function compilePriority(node: ComparisonNode): IssueFilter {
  const n = parseIntStrict(node.value);
  switch (node.op) {
    case "=":
      return { priority: { eq: n } };
    case "!=":
      return { priority: { neq: n } };
    case "<":
      return { priority: { lt: n } };
    case "<=":
      return { priority: { lte: n } };
    case ">":
      return { priority: { gt: n } };
    case ">=":
      return { priority: { gte: n } };
  }
}

function compileType(node: ComparisonNode): IssueFilter {
  assertEquality(node);
  const labelName = `type:${node.value}`;
  return node.op === "="
    ? { labels: { name: { eq: labelName } } }
    : { labels: { name: { neq: labelName } } };
}

function compileAssignee(node: ComparisonNode): IssueFilter {
  assertEquality(node);
  if (node.value.toLowerCase() === "none") {
    return node.op === "="
      ? { assignee: { null: true } }
      : { assignee: { null: false } };
  }
  return node.op === "="
    ? { assignee: { displayName: { eq: node.value } } }
    : { assignee: { displayName: { neq: node.value } } };
}

function compileLabel(node: ComparisonNode): IssueFilter {
  assertEquality(node);
  if (node.value.toLowerCase() === "none") {
    return node.op === "="
      ? { labels: { length: { eq: 0 } } }
      : { labels: { length: { gt: 0 } } };
  }
  // Glob values (`label=type:*`) compile to server-side startsWith/endsWith/
  // contains via the shared helper; complex globs surface as a query error.
  // (lin-ym1m)
  if (isLabelGlob(node.value)) {
    try {
      return globToLabelFilter(node.value, node.op === "!=");
    } catch (err) {
      if (err instanceof LabelGlobError) {
        throw new UnsupportedQueryError(err.message);
      }
      throw err;
    }
  }
  return node.op === "="
    ? { labels: { name: { eq: node.value } } }
    : { labels: { name: { neq: node.value } } };
}

function compileStringField(
  node: ComparisonNode,
  key: "title" | "description",
): IssueFilter {
  assertEquality(node);
  if (key === "description" && node.value.toLowerCase() === "none") {
    // An "empty" description means `(description IS NULL OR description
    // = '')` — a body can be absent (null) OR present-but-blank (""). Matching
    // only `{ null: true }` silently misses blank-string bodies, so match
    // both halves of the predicate.
    return node.op === "="
      ? {
          or: [{ description: { null: true } }, { description: { eq: "" } }],
        }
      : {
          and: [{ description: { null: false } }, { description: { neq: "" } }],
        };
  }
  const cmp = { containsIgnoreCase: node.value };
  if (node.op === "=") {
    return { [key]: cmp } as IssueFilter;
  }
  return {
    [key]: { notContainsIgnoreCase: node.value },
  } as IssueFilter;
}

function compileTitle(node: ComparisonNode): IssueFilter {
  return compileStringField(node, "title");
}

function compileDescription(node: ComparisonNode): IssueFilter {
  return compileStringField(node, "description");
}

function compileId(node: ComparisonNode): IssueFilter {
  assertEquality(node);
  return node.op === "="
    ? { id: { eq: node.value } }
    : { id: { neq: node.value } };
}

function compileParent(node: ComparisonNode): IssueFilter {
  assertEquality(node);
  return node.op === "="
    ? { parent: { id: { eq: node.value } } }
    : { parent: { id: { neq: node.value } } };
}

function compileDate(
  node: ComparisonNode,
  key: "createdAt" | "updatedAt" | "completedAt" | "startedAt",
  now: Date,
): IssueFilter {
  const iso = resolveDateValue(node.value, node.valueKind as ValueKind, now);
  switch (node.op) {
    case ">":
    case ">=":
      return { [key]: { gte: iso } } as IssueFilter;
    case "<":
    case "<=":
      return { [key]: { lte: iso } } as IssueFilter;
    case "=":
    case "!=":
      throw new UnsupportedQueryError(
        `date field '${node.field}' only supports <, <=, >, >= comparisons`,
      );
  }
}
