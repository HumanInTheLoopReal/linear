import type { GraphQLClient } from "../client/graphql-client.js";
import type { IssueFilter } from "../gql/graphql.js";
import {
  type IssueStatsFieldsFragment,
  ListIssuesForStatsDocument,
  type ListIssuesForStatsQuery,
} from "../gql/graphql.js";

export type GroupBy = "status" | "priority" | "type" | "assignee" | "label";

export interface GroupCount {
  group: string;
  count: number;
}

export interface CountResult {
  count: number;
}

export interface GroupedCountResult {
  total: number;
  groups: GroupCount[];
}

const TYPE_PREFIX = "type:";

async function paginateAll(
  client: GraphQLClient,
  filter: IssueFilter | undefined,
): Promise<IssueStatsFieldsFragment[]> {
  const all: IssueStatsFieldsFragment[] = [];
  let after: string | undefined;
  let hasNextPage = true;

  while (hasNextPage) {
    const result = await client.request<ListIssuesForStatsQuery>(
      ListIssuesForStatsDocument,
      { first: 250, after, filter },
    );
    all.push(...result.issues.nodes);
    hasNextPage = result.issues.pageInfo.hasNextPage;
    after = result.issues.pageInfo.endCursor ?? undefined;
    if (!after) break;
  }

  return all;
}

function deriveStatus(issue: IssueStatsFieldsFragment): string {
  return issue.state.name || issue.state.type;
}

function deriveType(issue: IssueStatsFieldsFragment): string | null {
  for (const l of issue.labels.nodes) {
    if (l.name.startsWith(TYPE_PREFIX)) {
      const stripped = l.name.slice(TYPE_PREFIX.length);
      if (stripped.length > 0) return stripped;
    }
  }
  return null;
}

function sortGroups(counts: Map<string, number>): GroupCount[] {
  return Array.from(counts.entries())
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

export async function countMatching(
  client: GraphQLClient,
  filter: IssueFilter | undefined,
): Promise<CountResult> {
  const issues = await paginateAll(client, filter);
  return { count: issues.length };
}

export async function countMatchingGrouped(
  client: GraphQLClient,
  filter: IssueFilter | undefined,
  groupBy: GroupBy,
): Promise<GroupedCountResult> {
  const issues = await paginateAll(client, filter);
  const counts = new Map<string, number>();

  for (const issue of issues) {
    if (groupBy === "label") {
      const labels = issue.labels.nodes;
      if (labels.length === 0) {
        counts.set("(no labels)", (counts.get("(no labels)") ?? 0) + 1);
        continue;
      }
      for (const l of labels) {
        counts.set(l.name, (counts.get(l.name) ?? 0) + 1);
      }
      continue;
    }

    let key: string;
    switch (groupBy) {
      case "status":
        key = deriveStatus(issue);
        break;
      case "priority":
        key = `P${issue.priority ?? 0}`;
        break;
      case "type":
        key = deriveType(issue) ?? "(no type)";
        break;
      case "assignee":
        key = issue.assignee?.name ?? "(unassigned)";
        break;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    total: issues.length,
    groups: sortGroups(counts),
  };
}
