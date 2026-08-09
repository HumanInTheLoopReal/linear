import type { IssueFilter } from "../gql/graphql.js";
import { invalidParameterError, requiresParameterError } from "./errors.js";
import { isUuid } from "./identifier.js";
import {
  logicalStatusAliases,
  stateTypesForLogicalStatus,
} from "./issue-lifecycle.js";

export { logicalStatusAliases };

export interface IssueFilterOptions {
  teamId?: string;
  assigneeId?: string;
  creatorId?: string;
  projectId?: string;
  stateIds?: string[];
  stateTypes?: string[];
  stateTypesExclude?: string[];
  labelIds?: string[];
  /**
   * Pre-built label-name glob fragments (lin-ym1m) from `--label-pattern`.
   * Each is a complete `{ labels: {...} }` IssueFilter produced by
   * `globToLabelFilter`; `buildIssueFilter` ANDs them in alongside the
   * id-based `labelIds` filter.
   */
  labelPatternFilters?: IssueFilter[];
  cycleId?: string;
  parentId?: string;
  milestoneId?: string;
  priority?: number;
  estimate?: number;
  dueBefore?: string;
  dueAfter?: string;
  createdAfter?: string;
  createdBefore?: string;
  completedAfter?: string;
  completedBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  hasBlockers?: boolean;
  isBlocking?: boolean;
  /**
   * Set by `--status all` to request that the GraphQL `issues` call pass
   * `includeArchived: true`. The state-type filter alone won't surface
   * archived issues because Linear's pagination wrapper hides them by
   * default. (lin-pyzt)
   */
  includeArchived?: boolean;
}

export interface RawFilterFlags {
  team?: string;
  /**
   * Explicit opt-out from the `team.default` config fallback. When false (or
   * omitted) AND `--team` is unset, `resolveFilterOptions` consults
   * `team.default` / `LINEAR_TEAM` so the listing is scoped to the user's
   * declared default. Pass `--all-teams` to ignore that fallback and list
   * across the entire workspace.
   */
  allTeams?: boolean;
  assignee?: string;
  creator?: string;
  project?: string;
  status?: string;
  label?: string;
  /** Label-name glob (lin-ym1m), e.g. `type:*`. Mutually exclusive with `--label`. */
  labelPattern?: string;
  cycle?: string;
  parent?: string;
  milestone?: string;
  priority?: string;
  estimate?: string;
  dueBefore?: string;
  dueAfter?: string;
  createdAfter?: string;
  createdBefore?: string;
  completedAfter?: string;
  completedBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  hasBlockers?: boolean;
  isBlocking?: boolean;
  /**
   * Commander tri-state from `.option("--no-scope")` + `.option("--scope <label>")`:
   *   - `true`     — neither flag passed (default for negatable boolean)
   *   - `false`    — `--no-scope` passed (firehose: skip implicit scope)
   *   - `string`   — `--scope <label>` passed (override the implicit label)
   *
   * The command layer calls `resolveScopeOption()` from `scope-filter.ts`
   * to collapse this into an `ActiveScope | undefined`.
   */
  scope?: string | boolean;
}

export function validatePriority(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 4) {
    throw invalidParameterError(
      "priority",
      "must be an integer between 0 and 4",
    );
  }
}

export function validateEstimate(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw invalidParameterError("estimate", "must be a non-negative integer");
  }
}

export function validateDateRange(
  after: string | undefined,
  before: string | undefined,
  label: string,
): void {
  if (after && before && after >= before) {
    throw invalidParameterError(
      label,
      `range is contradictory: after (${after}) must be before (${before})`,
    );
  }
}

export function validateFilterDependencies(
  flags: Pick<
    RawFilterFlags,
    "status" | "cycle" | "milestone" | "team" | "project"
  >,
): void {
  if (flags.status && !isUuid(flags.status) && !flags.team) {
    // Logical aliases (open, closed, in_progress, …) filter by state.type
    // category, which works workspace-wide; only team-specific workflow
    // state names need --team to disambiguate. lin-zst6: don't require
    // --team when every name is a logical alias.
    const names = parseCommaSeparated(flags.status);
    const allLogical = names.every((n) => mapLogicalStatus(n) !== null);
    if (!allLogical) {
      throw requiresParameterError("--status", "--team");
    }
  }
  if (flags.cycle && !isUuid(flags.cycle) && !flags.team) {
    throw requiresParameterError("--cycle", "--team");
  }
  if (flags.milestone && !isUuid(flags.milestone) && !flags.project) {
    throw requiresParameterError("--milestone", "--project");
  }
}

export function parseCommaSeparated(value: string): string[] {
  const parts = value.split(",").map((s) => s.trim());
  for (const part of parts) {
    if (part === "") {
      throw invalidParameterError(
        "comma-separated list",
        "contains empty segments",
      );
    }
  }
  return parts;
}

/**
 * Returns the WorkflowState.type list for a logical alias, or null if
 * `name` is not a recognized alias (i.e. caller should fall through to
 * team-specific workflow-state name resolution).
 */
export function mapLogicalStatus(name: string): readonly string[] | null {
  return stateTypesForLogicalStatus(name);
}
