import type { GraphQLClient } from "../client/graphql-client.js";
import { invalidParameterError } from "../common/errors.js";
import {
  isClosedStateType,
  NON_CLOSED_STATE_TYPES,
} from "../common/issue-lifecycle.js";
import { replaceSection } from "../common/markdown-sections.js";
import {
  GetEpicCandidatesDocument,
  type GetEpicCandidatesQuery,
  type IssueCreateInput,
  type IssueFilter,
  IssueRelationType,
} from "../gql/graphql.js";
import { createIssueRelation } from "./issue-relation-service.js";
import { createIssue } from "./issue-service.js";

export interface EpicStatus {
  epic: {
    id: string;
    identifier: string;
    title: string;
    priority: number;
    state: { id: string; name: string; type: string };
    team: { id: string; key: string; name: string };
  };
  total_children: number;
  closed_children: number;
  eligible_for_close: boolean;
}

/**
 * Fetch all "epic candidates" — open issues with at least one child — and
 * compute child-completion progress client-side. Linear has no native epic
 * type, so any open issue with children is treated as an epic.
 */
export async function getEpicStatuses(
  client: GraphQLClient,
  options: { teamId?: string; eligibleOnly?: boolean } = {},
): Promise<EpicStatus[]> {
  const filter: IssueFilter = {
    state: { type: { in: [...NON_CLOSED_STATE_TYPES] } },
  };
  if (options.teamId) {
    filter.team = { id: { eq: options.teamId } };
  }

  const results: EpicStatus[] = [];
  let after: string | undefined;
  do {
    const result: GetEpicCandidatesQuery = await client.request(
      GetEpicCandidatesDocument,
      { filter, first: 250, after },
    );

    for (const issue of result.issues.nodes) {
      const total = issue.children.nodes.length;
      if (total === 0) continue;
      const closed = issue.children.nodes.filter((c) =>
        isClosedStateType(c.state.type),
      ).length;
      const eligible = total > 0 && closed === total;
      if (options.eligibleOnly && !eligible) continue;
      results.push({
        epic: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          priority: issue.priority,
          state: issue.state,
          team: issue.team,
        },
        total_children: total,
        closed_children: closed,
        eligible_for_close: eligible,
      });
    }

    after = result.issues.pageInfo.hasNextPage
      ? (result.issues.pageInfo.endCursor ?? undefined)
      : undefined;
  } while (after);

  return results;
}

// ─── lin-tij0: atomic `epic create` with inline children ────────────────────
//
// `linear epic create <title>` reads a JSONL children spec, creates the epic,
// then creates each child with parentId=epic and wires `blocked_by`
// references as `Blocks` relations. One-shot inline planning (vs. molecules,
// which uses reusable templates).

export interface EpicChildSpec {
  title: string;
  description?: string;
  priority?: number;
  acceptance?: string;
  design?: string;
  notes?: string;
  /** Titles of OTHER children in the same spec that block this one. */
  blocked_by?: string[];
}

export interface EpicCreatedRef {
  id: string;
  identifier: string;
  title: string;
}

export interface EpicCreateResult {
  epic: EpicCreatedRef;
  children: EpicCreatedRef[];
  dependencies: Array<{ from: string; to: string }>;
}

/**
 * Parse a JSONL children spec (one JSON object per line; blank lines and
 * `#`-prefixed lines ignored). Throws `invalidParameterError` on the
 * first malformed line so the caller gets an actionable line number.
 */
export function parseChildrenJsonl(input: string): EpicChildSpec[] {
  const out: EpicChildSpec[] = [];
  const lines = input.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === "" || raw.startsWith("#")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw invalidParameterError(
        "--children",
        `line ${i + 1}: invalid JSON (${(err as Error).message})`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw invalidParameterError(
        "--children",
        `line ${i + 1}: expected a JSON object`,
      );
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.title !== "string" || obj.title.trim() === "") {
      throw invalidParameterError(
        "--children",
        `line ${i + 1}: missing required "title" field`,
      );
    }
    const child: EpicChildSpec = { title: obj.title };
    if (typeof obj.description === "string")
      child.description = obj.description;
    if (typeof obj.priority === "number") child.priority = obj.priority;
    if (typeof obj.acceptance === "string") child.acceptance = obj.acceptance;
    if (typeof obj.design === "string") child.design = obj.design;
    if (typeof obj.notes === "string") child.notes = obj.notes;
    if (Array.isArray(obj.blocked_by)) {
      const arr = obj.blocked_by;
      if (!arr.every((x) => typeof x === "string")) {
        throw invalidParameterError(
          "--children",
          `line ${i + 1}: "blocked_by" must be an array of strings`,
        );
      }
      child.blocked_by = arr as string[];
    }
    out.push(child);
  }
  return out;
}

/**
 * Kahn-style topological sort by `blocked_by`. Throws on cycle or on an
 * unknown title reference. Sibling-only references — a child can only
 * depend on OTHER children in the same spec, not on existing issues.
 */
export function topologicalSortChildren(
  children: readonly EpicChildSpec[],
): EpicChildSpec[] {
  const byTitle = new Map<string, EpicChildSpec>();
  for (const c of children) {
    if (byTitle.has(c.title)) {
      throw invalidParameterError(
        "--children",
        `duplicate child title: "${c.title}"`,
      );
    }
    byTitle.set(c.title, c);
  }
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const c of children) {
    incoming.set(c.title, 0);
    outgoing.set(c.title, []);
  }
  for (const c of children) {
    for (const dep of c.blocked_by ?? []) {
      if (!byTitle.has(dep)) {
        throw invalidParameterError(
          "--children",
          `child "${c.title}" blocked_by unknown title "${dep}"`,
        );
      }
      incoming.set(c.title, (incoming.get(c.title) ?? 0) + 1);
      outgoing.get(dep)?.push(c.title);
    }
  }
  const queue: string[] = [];
  for (const [title, count] of incoming) {
    if (count === 0) queue.push(title);
  }
  const out: EpicChildSpec[] = [];
  while (queue.length > 0) {
    const title = queue.shift() as string;
    const child = byTitle.get(title);
    if (child) out.push(child);
    for (const next of outgoing.get(title) ?? []) {
      const remaining = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  if (out.length !== children.length) {
    const stuck = children
      .filter((c) => !out.includes(c))
      .map((c) => c.title)
      .join(", ");
    throw invalidParameterError(
      "--children",
      `blocked_by cycle involving: ${stuck}`,
    );
  }
  return out;
}

/**
 * Compose a child's final markdown description by attaching
 * `## Acceptance Criteria`, `## Design`, and `## Notes` sections to the
 * base `description`. Returns undefined when the spec has nothing to write.
 */
export function composeChildDescription(
  spec: EpicChildSpec,
): string | undefined {
  let body = spec.description ?? "";
  if (spec.acceptance) {
    body = replaceSection(body, "## Acceptance Criteria", spec.acceptance);
  }
  if (spec.design) {
    body = replaceSection(body, "## Design", spec.design);
  }
  if (spec.notes) {
    body = replaceSection(body, "## Notes", spec.notes);
  }
  return body.trim() === "" ? undefined : body;
}

/**
 * Return a spec whose {@link composeChildDescription} output is exactly `body`.
 *
 * The create gate works on composed markdown, so when it repairs a child's
 * shape the repair has to survive the second composition that happens inside
 * `createEpicWithChildren`. Carrying the repaired body as the base description
 * and dropping the section fields it already contains is what makes composition
 * idempotent here; leaving `acceptance` in place would splice the unrepaired
 * text straight back over the fix.
 */
export function withComposedDescription(
  spec: EpicChildSpec,
  body: string | undefined,
): EpicChildSpec {
  const { acceptance, design, notes, ...rest } = spec;
  return body === undefined ? rest : { ...rest, description: body };
}

export interface CreateEpicArgs {
  teamId: string;
  title: string;
  description?: string;
  children: EpicChildSpec[];
}

/**
 * Create the epic, then each child with parentId=epic, then wire
 * `blocked_by` references as Linear `Blocks` relations. Linear has no
 * client-side transactions — a failure mid-flight leaves whatever
 * already succeeded in place.
 */
export async function createEpicWithChildren(
  client: GraphQLClient,
  args: CreateEpicArgs,
): Promise<EpicCreateResult> {
  const ordered = topologicalSortChildren(args.children);

  const epicInput: IssueCreateInput = {
    teamId: args.teamId,
    title: args.title,
  };
  if (args.description) epicInput.description = args.description;
  const epic = await createIssue(client, epicInput);

  const createdByTitle = new Map<string, EpicCreatedRef>();
  for (const spec of ordered) {
    const childInput: IssueCreateInput = {
      teamId: args.teamId,
      title: spec.title,
      parentId: epic.id,
    };
    const desc = composeChildDescription(spec);
    if (desc !== undefined) childInput.description = desc;
    if (spec.priority !== undefined) childInput.priority = spec.priority;

    const created = await createIssue(client, childInput);
    createdByTitle.set(spec.title, {
      id: created.id,
      identifier: created.identifier,
      title: created.title,
    });
  }

  const dependencies: Array<{ from: string; to: string }> = [];
  for (const spec of ordered) {
    for (const dep of spec.blocked_by ?? []) {
      const dependent = createdByTitle.get(spec.title);
      const blocker = createdByTitle.get(dep);
      if (!dependent || !blocker) continue;
      await createIssueRelation(client, {
        issueId: blocker.id,
        relatedIssueId: dependent.id,
        type: IssueRelationType.Blocks,
      });
      dependencies.push({
        from: dependent.identifier,
        to: blocker.identifier,
      });
    }
  }

  return {
    epic: {
      id: epic.id,
      identifier: epic.identifier,
      title: epic.title,
    },
    children: Array.from(createdByTitle.values()),
    dependencies,
  };
}
