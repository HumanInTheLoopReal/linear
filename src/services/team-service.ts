import type { GraphQLClient } from "../client/graphql-client.js";
import type {
  PaginatedResult,
  PaginationOptions,
  TeamDetail,
  TeamEstimateOption,
  TeamEstimationSource,
} from "../common/types.js";
import {
  GetTeamByIdDocument,
  type GetTeamByIdQuery,
  GetTeamsDocument,
  type GetTeamsQuery,
  UpdateTeamDocument,
  type UpdateTeamMutation,
} from "../gql/graphql.js";

export interface Team {
  id: string;
  key: string;
  name: string;
}

interface GetTeamInput {
  id: string;
}

type TeamConfigSource = Pick<
  TeamDetail,
  "issueEstimationType" | "issueEstimationExtended" | "issueEstimationAllowZero"
>;

function deriveValidEstimates(config: TeamConfigSource): TeamEstimateOption[] {
  const type = config.issueEstimationType;
  const extended = config.issueEstimationExtended;
  const allowZero = config.issueEstimationAllowZero;

  let base: TeamEstimateOption[] = [];

  switch (type) {
    case "fibonacci":
      base = [1, 2, 3, 5, 8, ...(extended ? [13, 21] : [])].map((value) => ({
        value,
        label: String(value),
      }));
      break;
    case "exponential":
      base = [1, 2, 4, 8, 16, ...(extended ? [32, 64] : [])].map((value) => ({
        value,
        label: String(value),
      }));
      break;
    case "linear":
      base = [1, 2, 3, 4, 5, ...(extended ? [6, 7] : [])].map((value) => ({
        value,
        label: String(value),
      }));
      break;
    case "tShirt": {
      const mapping: TeamEstimateOption[] = [
        { value: 1, label: "XS" },
        { value: 2, label: "S" },
        { value: 3, label: "M" },
        { value: 5, label: "L" },
        { value: 8, label: "XL" },
      ];
      const extendedValues: TeamEstimateOption[] = extended
        ? [
            { value: 13, label: "XXL" },
            { value: 21, label: "XXXL" },
          ]
        : [];
      base = [...mapping, ...extendedValues];
      break;
    }
    case "notUsed":
      base = [];
      break;
    default:
      base = [];
      break;
  }

  if (!allowZero || type === "notUsed" || base.length === 0) {
    return base;
  }

  return [{ value: 0, label: "0" }, ...base];
}

async function resolveEffectiveEstimationConfig(
  client: GraphQLClient,
  team: NonNullable<GetTeamByIdQuery["team"]>,
): Promise<{ config: TeamConfigSource; source: TeamEstimationSource }> {
  if (!team.inheritIssueEstimation || !team.parent?.id) {
    return { config: team, source: "self" };
  }

  try {
    const parentResult = await client.request<GetTeamByIdQuery>(
      GetTeamByIdDocument,
      {
        id: team.parent.id,
      },
    );

    if (!parentResult.team) {
      return { config: team, source: "self_fallback" };
    }

    return { config: parentResult.team, source: "parent" };
  } catch {
    return { config: team, source: "self_fallback" };
  }
}

export async function listTeams(
  client: GraphQLClient,
  options: PaginationOptions = {},
): Promise<PaginatedResult<Team>> {
  const { limit = 50, after } = options;
  const result = await client.request<GetTeamsQuery>(GetTeamsDocument, {
    first: limit,
    after,
  });
  return {
    nodes: result.teams.nodes,
    pageInfo: result.teams.pageInfo,
  };
}

/**
 * Normalize a user-supplied key into Linear's canonical form: uppercase
 * letters/digits, no trailing hyphen. 8-char cap, must start with a
 * letter. `kw-`-style trailing hyphens are stripped — Linear team keys
 * do not include them.
 *
 * Returns the canonical key on success and a list of human-readable
 * validation messages on failure.
 */
export interface NormalizedKey {
  ok: boolean;
  key: string;
  errors: string[];
}

const MAX_KEY_LEN = 8;

export function normalizeTeamKey(raw: string): NormalizedKey {
  const trimmed = raw.trim().replace(/-+$/, "");
  const errors: string[] = [];
  if (trimmed.length === 0) {
    errors.push("key cannot be empty");
  }
  if (trimmed.length > MAX_KEY_LEN) {
    errors.push(`key '${trimmed}' exceeds max length ${MAX_KEY_LEN}`);
  }
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(trimmed)) {
    errors.push(
      `key '${trimmed}' must start with a letter and contain only letters and digits`,
    );
  }
  return {
    ok: errors.length === 0,
    key: trimmed.toUpperCase(),
    errors,
  };
}

export interface RenameTeamKeyResult {
  team_id: string;
  old_key: string;
  new_key: string;
  changed: boolean;
  dry_run: boolean;
  warning: string;
}

const RENAME_KEY_WARNING =
  "Existing issue identifiers in Linear are immutable; only future issues will use the new prefix. Cross-issue references in existing descriptions are not rewritten.";

/**
 * Change a team's short key (the prefix used in issue identifiers like
 * `ENG-123`). Linear does not support rewriting existing issue
 * identifiers (they are immutable post-creation), so this is a
 * forward-only operation that affects only future issues.
 *
 * Dry-run validates the key shape and returns without calling the API.
 */
export async function renameTeamKey(
  client: GraphQLClient,
  args: {
    teamId: string;
    currentKey: string;
    newKey: string;
    dryRun?: boolean;
  },
): Promise<RenameTeamKeyResult> {
  const normalized = normalizeTeamKey(args.newKey);
  if (!normalized.ok) {
    throw new Error(`invalid team key: ${normalized.errors.join("; ")}`);
  }
  if (normalized.key === args.currentKey) {
    return {
      team_id: args.teamId,
      old_key: args.currentKey,
      new_key: normalized.key,
      changed: false,
      dry_run: args.dryRun ?? false,
      warning: RENAME_KEY_WARNING,
    };
  }

  if (args.dryRun) {
    return {
      team_id: args.teamId,
      old_key: args.currentKey,
      new_key: normalized.key,
      changed: false,
      dry_run: true,
      warning: RENAME_KEY_WARNING,
    };
  }

  const result = await client.request<UpdateTeamMutation>(UpdateTeamDocument, {
    id: args.teamId,
    input: { key: normalized.key },
  });
  if (!result.teamUpdate.success || !result.teamUpdate.team) {
    throw new Error(
      `teamUpdate failed for team ${args.teamId} → key=${normalized.key}`,
    );
  }
  return {
    team_id: result.teamUpdate.team.id,
    old_key: args.currentKey,
    new_key: result.teamUpdate.team.key,
    changed: true,
    dry_run: false,
    warning: RENAME_KEY_WARNING,
  };
}

export async function getTeam(
  client: GraphQLClient,
  input: GetTeamInput,
): Promise<TeamDetail> {
  const result = await client.request<GetTeamByIdQuery>(GetTeamByIdDocument, {
    id: input.id,
  });

  if (!result.team) {
    throw new Error(`Team with ID "${input.id}" not found`);
  }

  const { config, source } = await resolveEffectiveEstimationConfig(
    client,
    result.team,
  );

  return {
    ...result.team,
    validEstimates: deriveValidEstimates(config),
    estimationSource: source,
  };
}
