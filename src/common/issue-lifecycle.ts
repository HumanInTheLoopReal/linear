/**
 * Canonical mapping between the CLI's lifecycle vocabulary and Linear's
 * workflow-state types. Keep every command and service on these constants so
 * `open`, `in_progress`, and `closed` mean the same thing everywhere.
 *
 * `open` is the to-do bucket and intentionally excludes `started`; callers
 * that need every non-terminal issue (for example blocked/orphan scans) use
 * {@link NON_CLOSED_STATE_TYPES} instead.
 */
export const OPEN_STATE_TYPES = ["triage", "backlog", "unstarted"] as const;
export const IN_PROGRESS_STATE_TYPES = ["started"] as const;
export const CLOSED_STATE_TYPES = [
  "completed",
  "canceled",
  "duplicate",
] as const;

export const NON_CLOSED_STATE_TYPES = [
  ...OPEN_STATE_TYPES,
  ...IN_PROGRESS_STATE_TYPES,
] as const;

export const ALL_STATE_TYPES = [
  ...NON_CLOSED_STATE_TYPES,
  ...CLOSED_STATE_TYPES,
] as const;

export type LifecycleStatus = "open" | "in_progress" | "closed";

const LOGICAL_STATUS_ALIASES: Record<string, readonly string[]> = {
  open: OPEN_STATE_TYPES,
  closed: CLOSED_STATE_TYPES,
  active: IN_PROGRESS_STATE_TYPES,
  in_progress: IN_PROGRESS_STATE_TYPES,
  all: ALL_STATE_TYPES,
};

export function stateTypesForLogicalStatus(
  name: string,
): readonly string[] | null {
  return LOGICAL_STATUS_ALIASES[name.toLowerCase()] ?? null;
}

export function logicalStatusAliases(): readonly string[] {
  return Object.keys(LOGICAL_STATUS_ALIASES).sort();
}

export function lifecycleStatusFromStateType(
  stateType: string,
): LifecycleStatus {
  if (IN_PROGRESS_STATE_TYPES.includes(stateType as "started")) {
    return "in_progress";
  }
  if (
    CLOSED_STATE_TYPES.includes(
      stateType as (typeof CLOSED_STATE_TYPES)[number],
    )
  ) {
    return "closed";
  }
  return "open";
}

export function isClosedStateType(stateType: string): boolean {
  return CLOSED_STATE_TYPES.includes(
    stateType as (typeof CLOSED_STATE_TYPES)[number],
  );
}

export function isNonClosedStateType(stateType: string): boolean {
  return NON_CLOSED_STATE_TYPES.includes(
    stateType as (typeof NON_CLOSED_STATE_TYPES)[number],
  );
}
