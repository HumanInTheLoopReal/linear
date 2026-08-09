import type { GraphQLClient } from "../client/graphql-client.js";
import { GetLabelsDocument, type GetLabelsQuery } from "../gql/graphql.js";

export interface CoreType {
  name: string;
  description: string;
}

export const CORE_TYPES: CoreType[] = [
  { name: "task", description: "General work item (default)" },
  { name: "bug", description: "Bug report or defect" },
  { name: "feature", description: "New feature or enhancement" },
  { name: "chore", description: "Maintenance or housekeeping" },
  {
    name: "epic",
    description: "Large body of work spanning multiple issues",
  },
  { name: "decision", description: "Architecture decision record (ADR)" },
  {
    name: "spike",
    description:
      "Timeboxed investigation to reduce uncertainty before committing to a story",
  },
  {
    name: "story",
    description: "User story describing a feature from the user's perspective",
  },
  {
    name: "milestone",
    description:
      "Marks completion of a set of related issues (contains no work itself)",
  },
];

const TYPE_PREFIX = "type:";
const CORE_TYPE_NAMES = new Set(CORE_TYPES.map((t) => t.name));

export interface ListTypesResult {
  core_types: CoreType[];
  custom_types: string[];
}

export async function listTypes(
  client: GraphQLClient,
): Promise<ListTypesResult> {
  const result = await client.request<GetLabelsQuery>(GetLabelsDocument, {
    first: 250,
    filter: { name: { startsWith: TYPE_PREFIX } },
  });
  const customTypes = Array.from(
    new Set(
      result.issueLabels.nodes
        .map((label) => label.name.slice(TYPE_PREFIX.length))
        .filter((name) => name.length > 0 && !CORE_TYPE_NAMES.has(name)),
    ),
  ).sort();
  return { core_types: CORE_TYPES, custom_types: customTypes };
}
