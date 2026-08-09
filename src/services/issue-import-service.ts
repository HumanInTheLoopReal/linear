/**
 * `linear issues import` — bulk-create Linear issues from a JSONL stream
 * (the inverse of `issues export`).
 *
 * Linear has no transactional surface and no public upsert primitive, so
 * this is positioned as a **one-shot migration utility** — it creates new
 * Linear issues, never updates existing ones.
 *
 * Pipeline:
 *   1. Parse each JSONL line. Lines tagged `_type: "memory"` are dropped
 *      with a `memories_skipped` count (no Linear analog).
 *   2. Pre-fetch caches in one round-trip each:
 *      - all teams (key → id)
 *      - all workspace labels (name → id)
 *      - if `dedup` is set, every open-issue title (case-insensitive)
 *   3. Phase A — create issues. For each parsed line, resolve teamId from
 *      the cache, ensure any missing labels via `ensureWorkspaceLabel`,
 *      then call `createIssue`. Record `source_identifier → linear_id` in
 *      the ID map so Phase B can wire dependencies.
 *   4. Phase B — create dependencies. For each line's
 *      `dependencies[].depends_on_identifier`, look up the Linear UUIDs in
 *      the ID map and create an `IssueRelation` of type `Blocks`. The JSONL
 *      "X depends on Y" shape → Linear "Y blocks X", so the blocker
 *      becomes `issue` and the dependent becomes `relatedIssue`.
 *
 * Dropped from the import surface:
 *   - `comments[]` round-trip: comment authors map to the importing user,
 *     which is lossy. Tracked as a follow-up rather than imported silently.
 *   - `parent` / `children`: needs a separate sub-issue mutation pass; out
 *     of scope here.
 *   - `--input` legacy alias: dropped in favor of the positional [file].
 *
 * Architectural notes:
 *   - Service uses `GraphQLClient` only; label cache rides `GetLabels`
 *     (paginated). Team key→id mapping uses `GetTeams` (typically <50
 *     teams, single page).
 *   - On a partial failure mid-Phase-A, every issue already created stays
 *     in Linear (no rollback). The result reports `created`, the surviving
 *     issue IDs, and the line index that failed so the caller can re-run
 *     the importer with a trimmed JSONL.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import { CLOSED_STATE_TYPES } from "../common/issue-lifecycle.js";
import {
  CreateIssueDocument,
  type CreateIssueMutation,
  GetLabelsDocument,
  type GetLabelsQuery,
  GetTeamsDocument,
  type GetTeamsQuery,
  IssueRelationType,
  ListIssuesForExportDocument,
  type ListIssuesForExportQuery,
} from "../gql/graphql.js";
import { createIssueRelation } from "./issue-relation-service.js";
import { ensureWorkspaceLabel } from "./label-service.js";

const PAGE = 100;
const MAX_PAGES = 100;
const DEFAULT_LABEL_DESCRIPTION = "Imported via linear issues import";

type ExportIssueLine = {
  _type: "issue";
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  team?: { key: string } | null;
  labels?: string[];
  dependencies?: Array<{ depends_on_identifier: string; type?: string }>;
};

export interface ImportOpts {
  client: GraphQLClient;
  /** JSONL text as a single string (newline-separated). */
  jsonl: string;
  /** Display name for the input ("file:/path" or "<stdin>"). */
  source: string;
  /** Skip mutations — parse + plan only. */
  dryRun?: boolean;
  /** Skip lines whose title matches an open issue (case-insensitive). */
  dedup?: boolean;
}

export interface ImportError {
  line_index: number;
  identifier?: string;
  message: string;
}

export interface ImportResult {
  action: "imported" | "planned";
  source: string;
  dry_run: boolean;
  parsed: number;
  created: number;
  dedup_skipped: number;
  memories_skipped: number;
  /** New Linear identifiers created (Phase A). */
  ids: string[];
  /** Issue-relation rows created in Phase B. */
  relations_created: number;
  /** Issue lines that failed to create or whose deps could not resolve. */
  errors: ImportError[];
}

function parseJsonl(jsonl: string): {
  issues: Array<{ index: number; line: ExportIssueLine }>;
  memorySkipped: number;
  parseErrors: ImportError[];
} {
  const issues: Array<{ index: number; line: ExportIssueLine }> = [];
  const parseErrors: ImportError[] = [];
  let memorySkipped = 0;
  const rawLines = jsonl.split(/\r?\n/);
  rawLines.forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      parseErrors.push({
        line_index: idx,
        message: `invalid JSON: ${(e as Error).message}`,
      });
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      parseErrors.push({ line_index: idx, message: "not an object" });
      return;
    }
    const obj = parsed as Record<string, unknown>;
    if (obj._type === "memory") {
      memorySkipped += 1;
      return;
    }
    if (typeof obj.title !== "string" || obj.title.trim().length === 0) {
      parseErrors.push({
        line_index: idx,
        identifier:
          typeof obj.identifier === "string" ? obj.identifier : undefined,
        message: "missing or empty title",
      });
      return;
    }
    issues.push({ index: idx, line: obj as ExportIssueLine });
  });
  return { issues, memorySkipped, parseErrors };
}

async function fetchTeamMap(
  client: GraphQLClient,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor: string | undefined;
  for (let p = 0; p < MAX_PAGES; p += 1) {
    const r = await client.request<GetTeamsQuery>(GetTeamsDocument, {
      first: PAGE,
      after: cursor,
    });
    for (const t of r.teams.nodes) map.set(t.key, t.id);
    if (!r.teams.pageInfo.hasNextPage) return map;
    cursor = r.teams.pageInfo.endCursor ?? undefined;
    if (!cursor) return map;
  }
  return map;
}

async function fetchLabelMap(
  client: GraphQLClient,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor: string | undefined;
  for (let p = 0; p < MAX_PAGES; p += 1) {
    const r = await client.request<GetLabelsQuery>(GetLabelsDocument, {
      first: PAGE,
      after: cursor,
    });
    for (const l of r.issueLabels.nodes) map.set(l.name, l.id);
    if (!r.issueLabels.pageInfo.hasNextPage) return map;
    cursor = r.issueLabels.pageInfo.endCursor ?? undefined;
    if (!cursor) return map;
  }
  return map;
}

async function fetchOpenTitleSet(client: GraphQLClient): Promise<Set<string>> {
  const set = new Set<string>();
  let cursor: string | undefined;
  for (let p = 0; p < MAX_PAGES; p += 1) {
    // We reuse the export query rather than a leaner one — its payload
    // is heavier than needed for a title-only check, but it exists
    // already and the cardinality (open issues only) is bounded.
    const r = await client.request<ListIssuesForExportQuery>(
      ListIssuesForExportDocument,
      {
        first: PAGE,
        after: cursor,
        filter: { state: { type: { nin: [...CLOSED_STATE_TYPES] } } },
        includeArchived: false,
      },
    );
    for (const n of r.issues.nodes) set.add(n.title.toLowerCase());
    if (!r.issues.pageInfo.hasNextPage) return set;
    cursor = r.issues.pageInfo.endCursor ?? undefined;
    if (!cursor) return set;
  }
  return set;
}

async function resolveLabelIds(
  client: GraphQLClient,
  labelMap: Map<string, string>,
  labels: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of labels) {
    let id = labelMap.get(name);
    if (!id) {
      id = await ensureWorkspaceLabel(client, name, DEFAULT_LABEL_DESCRIPTION);
      labelMap.set(name, id);
    }
    ids.push(id);
  }
  return ids;
}

export async function importIssues(opts: ImportOpts): Promise<ImportResult> {
  const parsed = parseJsonl(opts.jsonl);
  const errors: ImportError[] = [...parsed.parseErrors];

  const result: ImportResult = {
    action: opts.dryRun ? "planned" : "imported",
    source: opts.source,
    dry_run: opts.dryRun ?? false,
    parsed: parsed.issues.length,
    created: 0,
    dedup_skipped: 0,
    memories_skipped: parsed.memorySkipped,
    ids: [],
    relations_created: 0,
    errors,
  };

  if (parsed.issues.length === 0) return result;

  const teamMap = await fetchTeamMap(opts.client);
  const labelMap = await fetchLabelMap(opts.client);
  const dedupSet = opts.dedup
    ? await fetchOpenTitleSet(opts.client)
    : new Set<string>();

  const idMap = new Map<string, string>(); // source identifier → Linear UUID

  for (const { index, line } of parsed.issues) {
    if (opts.dedup && dedupSet.has(line.title.toLowerCase())) {
      result.dedup_skipped += 1;
      continue;
    }

    const teamKey = line.team?.key;
    if (!teamKey) {
      errors.push({
        line_index: index,
        identifier: line.identifier,
        message: "missing team.key",
      });
      continue;
    }
    const teamId = teamMap.get(teamKey);
    if (!teamId) {
      errors.push({
        line_index: index,
        identifier: line.identifier,
        message: `unknown team key "${teamKey}"`,
      });
      continue;
    }

    if (opts.dryRun) {
      result.created += 1;
      continue;
    }

    let labelIds: string[];
    try {
      labelIds = await resolveLabelIds(
        opts.client,
        labelMap,
        line.labels ?? [],
      );
    } catch (e) {
      errors.push({
        line_index: index,
        identifier: line.identifier,
        message: `label resolution failed: ${(e as Error).message}`,
      });
      continue;
    }

    try {
      const createResult = await opts.client.request<CreateIssueMutation>(
        CreateIssueDocument,
        {
          input: {
            title: line.title,
            description: line.description ?? undefined,
            teamId,
            labelIds: labelIds.length > 0 ? labelIds : undefined,
            priority: line.priority ?? undefined,
          },
        },
      );
      if (
        !createResult.issueCreate.success ||
        !createResult.issueCreate.issue
      ) {
        errors.push({
          line_index: index,
          identifier: line.identifier,
          message: "issueCreate returned success=false",
        });
        continue;
      }
      const created = createResult.issueCreate.issue;
      idMap.set(line.identifier, created.id);
      result.ids.push(created.identifier);
      result.created += 1;
    } catch (e) {
      errors.push({
        line_index: index,
        identifier: line.identifier,
        message: `issueCreate failed: ${(e as Error).message}`,
      });
    }
  }

  // Phase B — relations.
  if (!opts.dryRun) {
    for (const { index, line } of parsed.issues) {
      const myLinearId = idMap.get(line.identifier);
      if (!myLinearId) continue;
      for (const dep of line.dependencies ?? []) {
        const blockerLinearId = idMap.get(dep.depends_on_identifier);
        if (!blockerLinearId) {
          errors.push({
            line_index: index,
            identifier: line.identifier,
            message: `dependency target "${dep.depends_on_identifier}" not in this import — relation skipped`,
          });
          continue;
        }
        try {
          await createIssueRelation(opts.client, {
            issueId: blockerLinearId,
            relatedIssueId: myLinearId,
            type: IssueRelationType.Blocks,
          });
          result.relations_created += 1;
        } catch (e) {
          errors.push({
            line_index: index,
            identifier: line.identifier,
            message: `relation create failed for "${dep.depends_on_identifier}": ${(e as Error).message}`,
          });
        }
      }
    }
  }

  return result;
}
