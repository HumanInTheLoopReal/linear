import type { LinearSdkClient } from "../client/linear-client.js";
import { multipleMatchesError, notFoundError } from "../common/errors.js";
import { isUuid } from "../common/identifier.js";

// Shortcuts that resolve to the authenticated user. Recognized
// case-insensitively at the resolver layer so every site that takes a
// user (assign, --assignee on next/issues update, etc.) gets the
// shorthand for free. The `@` prefix is required so a real display
// name "me" / "self" / "viewer" still resolves the usual way. (lin-17j1)
const SELF_TOKENS = new Set(["@me", "@self", "@viewer"]);

export async function resolveUserId(
  client: LinearSdkClient,
  nameOrEmailOrId: string,
): Promise<string> {
  if (SELF_TOKENS.has(nameOrEmailOrId.toLowerCase())) {
    const viewer = await client.sdk.viewer;
    return viewer.id;
  }
  if (isUuid(nameOrEmailOrId)) return nameOrEmailOrId;

  // Try by display name first (case-insensitive)
  const byName = await client.sdk.users({
    filter: { displayName: { eqIgnoreCase: nameOrEmailOrId } },
    first: 10,
  });

  if (byName.nodes.length === 1) return byName.nodes[0].id;

  if (byName.nodes.length > 1) {
    throw multipleMatchesError(
      "User",
      nameOrEmailOrId,
      byName.nodes.map((u) => `${u.name} <${u.email}>`),
      "Use email or UUID to disambiguate",
    );
  }

  const byEmail = await client.sdk.users({
    filter: { email: { eqIgnoreCase: nameOrEmailOrId } },
    first: 1,
  });

  if (byEmail.nodes.length > 0) return byEmail.nodes[0].id;

  throw notFoundError("User", nameOrEmailOrId);
}
