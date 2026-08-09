import { getDefaultTeam } from "./config-store.js";
import type { RawFilterFlags } from "./issue-filter.js";
import {
  type NormalizedIssueFilterOptions,
  normalizeIssueFilterOptions,
} from "./issue-filter-options.js";

/**
 * Apply configured CLI defaults before pure filter normalization. Keeping this
 * orchestration outside the resolver leaves resolvers responsible only for
 * translating human references to API identifiers.
 */
export function prepareIssueFilterOptions(
  options: RawFilterFlags,
): NormalizedIssueFilterOptions {
  const defaultTeam =
    options.team === undefined && !options.allTeams
      ? (getDefaultTeam() ?? undefined)
      : undefined;
  return normalizeIssueFilterOptions(options, defaultTeam);
}
