import type { GraphQLClient } from "../client/graphql-client.js";
import type {
  ArchivedProject,
  CreatedProject,
  DeletedProject,
  PaginatedResult,
  PaginationOptions,
  ProjectDetail,
  ProjectListItem,
  UnarchivedProject,
  UpdatedProject,
} from "../common/types.js";
import {
  ArchiveProjectDocument,
  type ArchiveProjectMutation,
  CreateProjectDocument,
  type CreateProjectMutation,
  DeleteProjectDocument,
  type DeleteProjectMutation,
  GetProjectDocument,
  type GetProjectQuery,
  GetProjectsDocument,
  type GetProjectsQuery,
  type ProjectCreateInput,
  type ProjectUpdateInput,
  UnarchiveProjectDocument,
  type UnarchiveProjectMutation,
  UpdateProjectDocument,
  type UpdateProjectMutation,
} from "../gql/graphql.js";

// Linear caps GraphQL query complexity at 10000. The ProjectListFields
// fragment carries two nested connections (teams, labels), costing ~139 per
// project, so a single request for the CLI's default limit of 100 (~13950)
// is rejected outright. Fetch in chunks that stay under the cap and stitch
// the pages together so any limit works.
const PROJECTS_SAFE_PAGE_SIZE = 50;

export async function listProjects(
  client: GraphQLClient,
  options: PaginationOptions = {},
): Promise<PaginatedResult<ProjectListItem>> {
  const { limit = 50, after } = options;

  const nodes: ProjectListItem[] = [];
  let cursor = after;
  let pageInfo: PaginatedResult<ProjectListItem>["pageInfo"] = {
    hasNextPage: false,
    endCursor: null,
  };

  while (nodes.length < limit) {
    const pageSize = Math.min(limit - nodes.length, PROJECTS_SAFE_PAGE_SIZE);
    const result = await client.request<GetProjectsQuery>(GetProjectsDocument, {
      first: pageSize,
      after: cursor,
    });
    nodes.push(...result.projects.nodes);
    pageInfo = result.projects.pageInfo;
    if (!result.projects.pageInfo.hasNextPage) break;
    cursor = result.projects.pageInfo.endCursor ?? undefined;
  }

  return {
    nodes: nodes.slice(0, limit),
    pageInfo,
  };
}

export async function getProject(
  client: GraphQLClient,
  id: string,
): Promise<ProjectDetail> {
  const result = await client.request<GetProjectQuery>(GetProjectDocument, {
    id,
  });

  if (!result.project) {
    throw new Error(`Project with ID "${id}" not found`);
  }

  return result.project;
}

export async function createProject(
  client: GraphQLClient,
  input: ProjectCreateInput,
): Promise<CreatedProject> {
  const result = await client.request<CreateProjectMutation>(
    CreateProjectDocument,
    { input },
  );

  if (!result.projectCreate.success || !result.projectCreate.project) {
    throw new Error(`Failed to create project "${input.name}"`);
  }

  return result.projectCreate.project;
}

export async function updateProject(
  client: GraphQLClient,
  id: string,
  input: ProjectUpdateInput,
): Promise<UpdatedProject> {
  const result = await client.request<UpdateProjectMutation>(
    UpdateProjectDocument,
    { id, input },
  );

  if (!result.projectUpdate.success || !result.projectUpdate.project) {
    throw new Error(`Failed to update project "${id}"`);
  }

  return result.projectUpdate.project;
}

export async function archiveProject(
  client: GraphQLClient,
  id: string,
): Promise<ArchivedProject> {
  const result = await client.request<ArchiveProjectMutation>(
    ArchiveProjectDocument,
    { id },
  );

  if (!result.projectArchive.success || !result.projectArchive.entity) {
    throw new Error(`Failed to archive project "${id}"`);
  }

  return result.projectArchive.entity;
}

export async function unarchiveProject(
  client: GraphQLClient,
  id: string,
): Promise<UnarchivedProject> {
  const result = await client.request<UnarchiveProjectMutation>(
    UnarchiveProjectDocument,
    { id },
  );

  if (!result.projectUnarchive.success || !result.projectUnarchive.entity) {
    throw new Error(`Failed to unarchive project "${id}"`);
  }

  return result.projectUnarchive.entity;
}

export async function deleteProject(
  client: GraphQLClient,
  id: string,
): Promise<DeletedProject> {
  const result = await client.request<DeleteProjectMutation>(
    DeleteProjectDocument,
    { id },
  );

  if (!result.projectDelete.success) {
    throw new Error(`Failed to delete project "${id}"`);
  }

  return {
    id: result.projectDelete.entity?.id ?? id,
    success: true,
  };
}
