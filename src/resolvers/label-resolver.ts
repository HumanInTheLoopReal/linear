import type { LinearSdkClient } from "../client/linear-client.js";
import { notFoundError } from "../common/errors.js";
import { isUuid } from "../common/identifier.js";

export async function resolveLabelId(
  client: LinearSdkClient,
  nameOrId: string,
): Promise<string> {
  if (isUuid(nameOrId)) return nameOrId;

  const result = await client.sdk.issueLabels({
    filter: { name: { eqIgnoreCase: nameOrId } },
    first: 1,
  });

  if (result.nodes.length === 0) {
    throw notFoundError("Label", nameOrId);
  }

  return result.nodes[0].id;
}

/** Resolve a workspace-global label without matching a team-scoped namesake. */
export async function resolveWorkspaceLabelId(
  client: LinearSdkClient,
  nameOrId: string,
): Promise<string> {
  const id = await findWorkspaceLabelId(client, nameOrId);
  if (!id) {
    throw notFoundError("Workspace label", nameOrId);
  }
  return id;
}

/** Find a workspace-global label, returning undefined when it does not exist. */
export async function findWorkspaceLabelId(
  client: LinearSdkClient,
  nameOrId: string,
): Promise<string | undefined> {
  // A UUID still has to clear the workspace scope. Passing it straight through
  // would let a team-scoped label's id reach `labels update` / `labels delete`,
  // which are documented as workspace-only.
  const match = isUuid(nameOrId)
    ? { id: { eq: nameOrId } }
    : { name: { eqIgnoreCase: nameOrId } };

  const result = await client.sdk.issueLabels({
    filter: { ...match, team: { null: true } },
    first: 1,
  });
  return result.nodes[0]?.id;
}

export async function resolveLabelIds(
  client: LinearSdkClient,
  namesOrIds: string[],
): Promise<string[]> {
  return Promise.all(namesOrIds.map((id) => resolveLabelId(client, id)));
}

/**
 * Label names or UUIDs that match no label anywhere in the workspace. A label
 * filter still applies them, so the caller can explain an empty result
 * instead of failing the read.
 */
export async function findMissingLabelNames(
  client: LinearSdkClient,
  namesOrIds: string[],
): Promise<string[]> {
  const found = await Promise.all(
    namesOrIds.map(async (label) => {
      const result = await client.sdk.issueLabels({
        filter: isUuid(label)
          ? { id: { eq: label } }
          : { name: { eqIgnoreCase: label } },
        first: 1,
      });
      return result.nodes.length > 0;
    }),
  );
  return namesOrIds.filter((_, i) => !found[i]);
}

/**
 * Resolve label names / ids to ids, silently dropping names that don't
 * exist. Use for *negative* filters like `--exclude-label` where missing
 * labels are a no-op (nothing to exclude) rather than a usage error. The
 * positive `--label` path still uses `resolveLabelIds` so typos surface
 * loudly. (lin-ufud)
 */
export async function resolveLabelIdsPermissive(
  client: LinearSdkClient,
  namesOrIds: string[],
): Promise<string[]> {
  const resolved = await Promise.all(
    namesOrIds.map(async (n) => {
      if (isUuid(n)) return n;
      const result = await client.sdk.issueLabels({
        filter: { name: { eqIgnoreCase: n } },
        first: 1,
      });
      return result.nodes[0]?.id ?? null;
    }),
  );
  return resolved.filter((id): id is string => id !== null);
}
