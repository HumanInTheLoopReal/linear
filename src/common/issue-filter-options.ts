import { invalidParameterError } from "./errors.js";
import { parseDueDate } from "./identifier.js";
import {
  type IssueFilterOptions,
  parseCommaSeparated,
  type RawFilterFlags,
  validateDateRange,
  validateEstimate,
  validateFilterDependencies,
  validatePriority,
} from "./issue-filter.js";
import { ALL_STATE_TYPES } from "./issue-lifecycle.js";
import { globToLabelFilter, LabelGlobError } from "./label-glob.js";

export interface IssueFilterReferences {
  team?: string;
  assignee?: string;
  creator?: string;
  project?: string;
  statusNames?: string[];
  labelNames?: string[];
  cycle?: string;
  parent?: string;
}

type DirectIssueFilterOptionKey =
  | "priority"
  | "estimate"
  | "dueBefore"
  | "dueAfter"
  | "createdAfter"
  | "createdBefore"
  | "completedAfter"
  | "completedBefore"
  | "updatedAfter"
  | "updatedBefore"
  | "hasBlockers"
  | "isBlocking"
  | "labels"
  | "stateTypeFilter"
  | "labelPatternFilters";

export type DirectIssueFilterOptions = Pick<
  IssueFilterOptions,
  DirectIssueFilterOptionKey
>;

export interface MilestoneFilterReference {
  milestone: string;
  project?: string;
}

export interface NormalizedIssueFilterOptions {
  searchReferences?: IssueFilterReferences;
  milestoneReference?: MilestoneFilterReference;
  directOptions: DirectIssueFilterOptions;
}

function validateDateOption(value: string | undefined, flag: string): void {
  if (!value) {
    return;
  }

  try {
    parseDueDate(value);
  } catch {
    throw invalidParameterError(
      flag,
      "must be a valid date in YYYY-MM-DD format",
    );
  }
}

function parseIntegerOption(value: string, flag: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw invalidParameterError(flag, "must be an integer");
  }
  return Number.parseInt(value, 10);
}

function compileLabelPattern(
  labelPattern: string | undefined,
  exactLabelNames: string[] | undefined,
): IssueFilterOptions["labelPatternFilters"] {
  if (!labelPattern) {
    return undefined;
  }
  if (exactLabelNames) {
    throw invalidParameterError(
      "--label-pattern",
      "cannot be combined with --label (use one label filter at a time)",
    );
  }

  try {
    return [globToLabelFilter(labelPattern)];
  } catch (error) {
    if (error instanceof LabelGlobError) {
      throw invalidParameterError("--label-pattern", error.message);
    }
    throw error;
  }
}

function parseStateTypes(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const known: readonly string[] = ALL_STATE_TYPES;
  const types = parseCommaSeparated(value).map((t) => t.toLowerCase());
  const unknown = types.filter((t) => !known.includes(t));
  if (unknown.length > 0) {
    throw invalidParameterError(
      "--state-type",
      `unknown state type "${unknown.join(", ")}" (expected one of: ${known.join(", ")})`,
    );
  }
  return types;
}

/**
 * Parses and validates raw issue filter flags without reading configuration or
 * making API calls. The caller supplies the already-resolved default team so
 * config selection remains outside this pure normalization boundary.
 */
export function normalizeIssueFilterOptions(
  opts: RawFilterFlags,
  defaultTeam?: string,
): NormalizedIssueFilterOptions {
  validateDateOption(opts.dueBefore, "--due-before");
  validateDateOption(opts.dueAfter, "--due-after");
  validateDateOption(opts.createdAfter, "--created-after");
  validateDateOption(opts.createdBefore, "--created-before");
  validateDateOption(opts.completedAfter, "--completed-after");
  validateDateOption(opts.completedBefore, "--completed-before");
  validateDateOption(opts.updatedAfter, "--updated-after");
  validateDateOption(opts.updatedBefore, "--updated-before");

  const statusNames = opts.status
    ? parseCommaSeparated(opts.status)
    : undefined;
  // An empty `--label ""` means no label filter, as it did before the flag
  // became repeatable.
  const parsedLabels = opts.label
    ?.filter((value) => value !== "")
    .flatMap(parseCommaSeparated);
  const labelNames = parsedLabels?.length ? parsedLabels : undefined;
  const stateTypeFilter = parseStateTypes(opts.stateType);
  const labelPatternFilters = compileLabelPattern(
    opts.labelPattern,
    labelNames,
  );

  const priority = opts.priority
    ? parseIntegerOption(opts.priority, "--priority")
    : undefined;
  if (priority !== undefined) {
    validatePriority(priority);
  }

  const estimate = opts.estimate
    ? parseIntegerOption(opts.estimate, "--estimate")
    : undefined;
  if (estimate !== undefined) {
    validateEstimate(estimate);
  }

  const effectiveTeam = opts.team ?? (opts.allTeams ? undefined : defaultTeam);
  validateFilterDependencies({ ...opts, team: effectiveTeam });

  validateDateRange(opts.dueAfter, opts.dueBefore, "due date");
  validateDateRange(opts.createdAfter, opts.createdBefore, "created date");
  validateDateRange(
    opts.completedAfter,
    opts.completedBefore,
    "completed date",
  );
  validateDateRange(opts.updatedAfter, opts.updatedBefore, "updated date");

  const searchReferences: IssueFilterReferences = {
    team: effectiveTeam,
    assignee: opts.assignee,
    creator: opts.creator,
    project: opts.project,
    statusNames,
    labelNames,
    cycle: opts.cycle,
    parent: opts.parent,
  };
  const hasSearchReferences = Object.values(searchReferences).some(
    (value) => value !== undefined,
  );

  return {
    searchReferences: hasSearchReferences ? searchReferences : undefined,
    milestoneReference: opts.milestone
      ? { milestone: opts.milestone, project: opts.project }
      : undefined,
    directOptions: {
      priority,
      estimate,
      dueBefore: opts.dueBefore,
      dueAfter: opts.dueAfter,
      createdAfter: opts.createdAfter,
      createdBefore: opts.createdBefore,
      completedAfter: opts.completedAfter,
      completedBefore: opts.completedBefore,
      updatedAfter: opts.updatedAfter,
      updatedBefore: opts.updatedBefore,
      hasBlockers: opts.hasBlockers,
      isBlocking: opts.isBlocking,
      labels: labelNames,
      stateTypeFilter,
      labelPatternFilters,
    },
  };
}
