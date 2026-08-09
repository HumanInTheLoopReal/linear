import { lifecycleStatusFromStateType } from "../common/issue-lifecycle.js";

/**
 * Shared text-format helpers for human-readable command output.
 *
 * Linear defaults to JSON; text formatters live next to their command
 * (inline above the `.action()` block) and call these helpers to build
 * the byte-stable output. The contract is set by the snapshot tests —
 * change a constant here only when the expected output intentionally changes.
 */

/**
 * The five status buckets in linear's visual vocabulary. Mapped from Linear's
 * `WorkflowState.type` (the canonical input) plus two derived overrides
 * (`blocked` from open blocking relations, `deferred` from the
 * `deferred` / `deferred-until:*` Linear-Hack labels).
 */
export type ComputedStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "closed"
  | "deferred";

export const STATUS_ICONS: Record<ComputedStatus, string> = {
  open: "○",
  in_progress: "◐",
  blocked: "●",
  closed: "✓",
  deferred: "❄",
};

export interface StatusOverrides {
  blocked?: boolean;
  deferred?: boolean;
}

/**
 * Map Linear's `state.type` (and optional computed overrides) to a status
 * bucket. Overrides win: a deferred-and-blocked issue renders as deferred —
 * the explicit lifecycle marker outranks the derived dependency state.
 */
export function statusFromType(
  stateType: string,
  overrides: StatusOverrides = {},
): ComputedStatus {
  if (overrides.deferred) return "deferred";
  if (overrides.blocked) return "blocked";
  return lifecycleStatusFromStateType(stateType);
}

export function statusIcon(
  stateType: string,
  overrides: StatusOverrides = {},
): string {
  return STATUS_ICONS[statusFromType(stateType, overrides)];
}

/**
 * Linear priority 0 means "no priority"; the column is omitted entirely in
 * that case rather than printing "P0". 1-4 pass through as P1-P4.
 */
export function priorityCol(priority: number | null | undefined): string {
  if (priority === null || priority === undefined) return "";
  if (priority < 1 || priority > 4) return "";
  return `P${priority}`;
}

/**
 * Linear has no native issue-type field. The Linear-Hack convention encodes
 * type as a workspace label `type:<name>` (e.g. `type:epic`, `type:bug`).
 * The text output brackets non-task types (`[epic]`); plain tasks get no
 * bracket. Anything not matching the convention also returns empty.
 */
export function typeLabel(
  labels: { name: string }[] | { nodes: { name: string }[] } | undefined,
): string {
  const list = !labels
    ? []
    : Array.isArray(labels)
      ? labels
      : (labels.nodes ?? []);
  for (const l of list) {
    if (l.name.startsWith("type:")) {
      const t = l.name.slice("type:".length);
      if (!t || t === "task") return "";
      return `[${t}]`;
    }
  }
  return "";
}

/**
 * A non-root row in a generic tree. Each row always renders a connector
 * (`├── ` / `└── `); roots are emitted by the caller without `renderTree`.
 *
 * `ancestorContinues[i]` says whether the i-th ancestor BELOW the root has
 * more siblings after it (and so should draw `│` in column i instead of
 * blank). Direct children of the root have an empty array — just the
 * connector, no indent columns.
 */
export interface TreeRow {
  ancestorContinues: boolean[];
  isLast: boolean;
  content: string;
}

/**
 * Render non-root rows as a tree:
 *   `├── ` / `└── ` connectors, `│   ` / `    ` indent columns, joined by \n.
 *
 * No trailing newline — the caller composes the surrounding sections.
 * Returns an empty string for an empty list so the caller can unconditionally
 * concat without a stray separator.
 */
export function renderTree(rows: TreeRow[]): string {
  return rows
    .map((row) => {
      const indent = row.ancestorContinues
        .map((c) => (c ? "│   " : "    "))
        .join("");
      const connector = row.isLast ? "└── " : "├── ";
      return indent + connector + row.content;
    })
    .join("\n");
}

/**
 * The 80-character separator printed above the footer total line.
 */
export const SEPARATOR = "-".repeat(80);

/**
 * Footer legend explaining the row-level status icons. Independent of any
 * particular Linear workspace's state names — the icons map categorically
 * from Linear's `state.type` enum (triage/backlog/unstarted → ○, started → ◐,
 * completed/canceled/duplicate → ✓), plus the two derived markers (● blocked
 * is inferred from open `blocks` relations; ❄ deferred from the Linear-Hack
 * `deferred` / `deferred-until:*` labels).
 */
export const STATUS_LEGEND =
  "Status: ○ to do  ◐ in progress  ● blocked  ✓ done  ❄ deferred";

/**
 * Render the footer block: separator + total line + blank + legend.
 * Caller supplies the total line text (e.g. `Total: 14 issues (10 open, 2 in
 * progress)` or `Ready: 5 issues with no active blockers`) since wording
 * varies per command.
 */
export function renderFooter(totalLine: string): string {
  return [SEPARATOR, totalLine, "", STATUS_LEGEND].join("\n");
}
