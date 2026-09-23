/**
 * `linear issues export` — paginate Linear issues into JSONL lines that
 * round-trip through `linear issues import`.
 *
 * Each output object is shaped to be import-friendly:
 *
 *   ```json
 *   {
 *     "_type": "issue",
 *     "id": "uuid",
 *     "identifier": "ENG-42",
 *     "title": "...",
 *     "description": "...",
 *     "status": "Started",        // = state.name
 *     "priority": 2,
 *     "team": { "id": "...", "key": "ENG", "name": "..." } | null,
 *     "labels": ["bug", "frontend"],
 *     "assignee": { "id": "...", "name": "..." } | null,
 *     "project": { "id": "...", "name": "..." } | null,
 *     "parent": "ENG-7" | null,
 *     "children": ["ENG-50", "ENG-51"],
 *     "dependencies": [
 *       { "depends_on_identifier": "ENG-1", "type": "blocks" }
 *     ],
 *     "comments": [
 *       { "id": "...", "body": "...", "author": "Alice", "created_at": "..." }
 *     ],
 *     "created_at": "RFC3339",
 *     "updated_at": "RFC3339"
 *   }
 *   ```
 *
 * The `dependencies` shape is `{depends_on_identifier, type}` — the
 * issue being exported "depends on" the listed issue. Linear surfaces
 * this via `inverseRelations` filtered to `type === "blocks"`: the
 * blocker is the `issue` of the inverse-relation. We emit the Linear
 * identifier (e.g. `ENG-99`) rather than the opaque UUID because the
 * identifier is the round-trip-stable token.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import {
  type CompleteIssueWithCommentsFieldsFragment,
  type IssueFilter,
  ListIssuesForExportDocument,
  type ListIssuesForExportQuery,
} from "../gql/graphql.js";
import { withAllComments } from "./issue-service.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
const BLOCKS_RELATION = "blocks";

export interface ExportComment {
  id: string;
  body: string;
  author: string | null;
  created_at: string;
}

export interface ExportDependency {
  depends_on_identifier: string;
  type: string;
}

export interface ExportTeamRef {
  id: string;
  key: string;
  name: string;
}

export interface ExportUserRef {
  id: string;
  name: string;
}

export interface ExportProjectRef {
  id: string;
  name: string;
}

export interface ExportIssueLine {
  _type: "issue";
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  team: ExportTeamRef | null;
  labels: string[];
  assignee: ExportUserRef | null;
  project: ExportProjectRef | null;
  parent: string | null;
  children: string[];
  dependencies: ExportDependency[];
  comments: ExportComment[];
  created_at: string;
  updated_at: string;
}

export interface ExportOpts {
  client: GraphQLClient;
  /** Forwarded to the IssueFilter (e.g. team scope). */
  filter?: IssueFilter;
  /** Include archived issues — mapped from the `--all` flag. */
  includeArchived?: boolean;
}

export interface ExportSummary {
  issue_count: number;
  filter_applied: boolean;
  include_archived: boolean;
}

function projectComments(
  node: CompleteIssueWithCommentsFieldsFragment,
): ExportComment[] {
  return (node.comments?.nodes ?? []).map((c) => ({
    id: c.id,
    body: c.body,
    author: c.user?.displayName ?? null,
    created_at: c.createdAt as string,
  }));
}

function projectDependencies(
  node: CompleteIssueWithCommentsFieldsFragment,
): ExportDependency[] {
  return (node.inverseRelations?.nodes ?? [])
    .filter((r) => r.type === BLOCKS_RELATION)
    .map((r) => ({
      depends_on_identifier: r.issue.identifier,
      type: r.type,
    }));
}

export function projectIssueForExport(
  node: CompleteIssueWithCommentsFieldsFragment,
): ExportIssueLine {
  return {
    _type: "issue",
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description ?? null,
    status: node.state.name,
    priority: node.priority ?? 0,
    team: node.team
      ? { id: node.team.id, key: node.team.key, name: node.team.name }
      : null,
    labels: (node.labels?.nodes ?? []).map((l) => l.name),
    assignee: node.assignee
      ? { id: node.assignee.id, name: node.assignee.name }
      : null,
    project: node.project
      ? { id: node.project.id, name: node.project.name }
      : null,
    parent: node.parent?.identifier ?? null,
    children: (node.children?.nodes ?? []).map((c) => c.identifier),
    dependencies: projectDependencies(node),
    comments: projectComments(node),
    created_at: node.createdAt as string,
    updated_at: node.updatedAt as string,
  };
}

export async function exportIssues(
  opts: ExportOpts,
): Promise<ExportIssueLine[]> {
  const out: ExportIssueLine[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const r = await opts.client.request<ListIssuesForExportQuery>(
      ListIssuesForExportDocument,
      {
        first: PAGE_SIZE,
        after: cursor,
        filter: opts.filter,
        includeArchived: opts.includeArchived ?? false,
      },
    );
    for (const node of r.issues.nodes) {
      // The list query carries Linear's default comment page per issue;
      // only an issue with more comments costs extra requests.
      out.push(projectIssueForExport(await withAllComments(opts.client, node)));
    }
    if (!r.issues.pageInfo.hasNextPage) return out;
    cursor = r.issues.pageInfo.endCursor ?? undefined;
    if (!cursor) return out;
  }
  return out;
}

export function summarizeExport(
  lines: ReadonlyArray<ExportIssueLine>,
  opts: { filterApplied: boolean; includeArchived: boolean },
): ExportSummary {
  return {
    issue_count: lines.length,
    filter_applied: opts.filterApplied,
    include_archived: opts.includeArchived,
  };
}
