import type { LinearSdkClient } from "../client/linear-client.js";
import { invalidParameterError } from "../common/errors.js";
import { mapLogicalStatus } from "../common/issue-filter.js";
import type { IssueFilterReferences } from "../common/issue-filter-options.js";
import { resolveCycleId } from "./cycle-resolver.js";
import { resolveIssueId } from "./issue-resolver.js";
import { resolveLabelIds } from "./label-resolver.js";
import { resolveProjectId } from "./project-resolver.js";
import { resolveStatusId } from "./status-resolver.js";
import { resolveTeamId } from "./team-resolver.js";
import { resolveUserId } from "./user-resolver.js";

export type SearchFilterResolutionInput = IssueFilterReferences;

export interface SearchFilterResolution {
  teamId?: string;
  assigneeId?: string;
  creatorId?: string;
  projectId?: string;
  stateIds?: string[];
  stateTypes?: string[];
  labelIds?: string[];
  cycleId?: string;
  parentId?: string;
  /** Set when --status all is detected; relaxes server-side archived hiding. */
  includeArchived?: boolean;
}

export async function resolveSearchFilterIds(
  sdkClient: LinearSdkClient,
  input: SearchFilterResolutionInput,
): Promise<SearchFilterResolution> {
  const resolved: SearchFilterResolution = {};

  if (input.team) {
    resolved.teamId = await resolveTeamId(sdkClient, input.team);
  }

  if (input.assignee) {
    resolved.assigneeId = await resolveUserId(sdkClient, input.assignee);
  }

  if (input.creator) {
    resolved.creatorId = await resolveUserId(sdkClient, input.creator);
  }

  if (input.project) {
    resolved.projectId = await resolveProjectId(sdkClient, input.project);
  }

  if (input.statusNames && input.statusNames.length > 0) {
    // Classify each name as a logical alias (filtered via state.type) or
    // a team-specific workflow-state name (resolved to a UUID). Mixing
    // the two in one `--status a,b` invocation isn't supported — the
    // filter shapes are different and AND-ing them produces empty results.
    const logical: string[] = [];
    const specific: string[] = [];
    for (const name of input.statusNames) {
      if (mapLogicalStatus(name)) {
        logical.push(name);
      } else {
        specific.push(name);
      }
    }
    // --status all is the user's escape hatch from the default "hide
    // completed + archived" pair. The state-type list it expands to lifts
    // the client-side completed exclusion; this flag tells the GraphQL
    // call to also pass includeArchived: true so archived issues come
    // back too. (lin-pyzt)
    if (logical.some((n) => n.toLowerCase() === "all")) {
      resolved.includeArchived = true;
    }
    if (logical.length > 0 && specific.length > 0) {
      throw invalidParameterError(
        "--status",
        "cannot mix logical aliases (open, closed, in_progress, …) with team-specific state names in the same call",
      );
    }
    if (logical.length > 0) {
      const types = new Set<string>();
      for (const name of logical) {
        for (const t of mapLogicalStatus(name) ?? []) {
          types.add(t);
        }
      }
      resolved.stateTypes = [...types];
    } else {
      resolved.stateIds = await Promise.all(
        specific.map((status) =>
          resolveStatusId(sdkClient, status, resolved.teamId),
        ),
      );
    }
  }

  if (input.labelNames && input.labelNames.length > 0) {
    resolved.labelIds = await resolveLabelIds(sdkClient, input.labelNames);
  }

  if (input.cycle) {
    resolved.cycleId = await resolveCycleId(
      sdkClient,
      input.cycle,
      resolved.teamId ?? input.team,
    );
  }

  if (input.parent) {
    resolved.parentId = await resolveIssueId(sdkClient, input.parent);
  }

  return resolved;
}
