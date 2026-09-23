import type { GraphQLClient } from "../client/graphql-client.js";
import { fatalError } from "../common/errors.js";
import { CLOSED_STATE_TYPES } from "../common/issue-lifecycle.js";
import { getSection, replaceSection } from "../common/markdown-sections.js";
import type {
  CreatedIssue,
  Issue,
  IssueByIdentifier,
  IssueByIdentifierWithAttachments,
  IssueByIdentifierWithComments,
  IssueByIdentifierWithCommentThreads,
  IssueComment,
  IssueCommentThread,
  IssueDetail,
  IssueDetailWithAttachments,
  IssueDetailWithComments,
  IssueDetailWithCommentThreads,
  IssueSearchResult,
  PaginatedResult,
  PaginationOptions,
  UpdatedIssue,
} from "../common/types.js";
import {
  ArchiveIssueDocument,
  type ArchiveIssueMutation,
  CreateIssueDocument,
  type CreateIssueMutation,
  DeleteIssueDocument,
  type DeleteIssueMutation,
  FilteredSearchIssuesDocument,
  type FilteredSearchIssuesQuery,
  GetIssueByIdDocument,
  GetIssueByIdentifierDocument,
  type GetIssueByIdentifierQuery,
  GetIssueByIdentifierWithAttachmentsDocument,
  type GetIssueByIdentifierWithAttachmentsQuery,
  GetIssueByIdentifierWithCommentsDocument,
  type GetIssueByIdentifierWithCommentsQuery,
  GetIssueByIdentifierWithReactionsDocument,
  type GetIssueByIdentifierWithReactionsQuery,
  type GetIssueByIdQuery,
  GetIssueByIdWithAttachmentsDocument,
  type GetIssueByIdWithAttachmentsQuery,
  GetIssueByIdWithCommentsDocument,
  type GetIssueByIdWithCommentsQuery,
  GetIssueByIdWithReactionsDocument,
  type GetIssueByIdWithReactionsQuery,
  GetIssueCommentCountsDocument,
  type GetIssueCommentCountsQuery,
  GetIssueReadCommentsPageDocument,
  type GetIssueReadCommentsPageQuery,
  type IssueCreateInput,
  type IssueFilter,
  type IssueUpdateInput,
  PaginationOrderBy,
  SearchIssuesDocument,
  type SearchIssuesQuery,
  type SearchIssuesQueryVariables,
  UnarchiveIssueDocument,
  type UnarchiveIssueMutation,
  UpdateIssueDocument,
  type UpdateIssueMutation,
} from "../gql/graphql.js";
import { normalizeReactions } from "./reaction-service.js";

const DEFAULT_VISIBLE_ISSUES_FILTER: IssueFilter = {
  state: { type: { nin: [...CLOSED_STATE_TYPES] } },
};

function hasExplicitStateFilter(filter: IssueFilter): boolean {
  if (filter.state) {
    return true;
  }

  if (filter.and?.some(hasExplicitStateFilter)) {
    return true;
  }

  return filter.or?.some(hasExplicitStateFilter) ?? false;
}

function buildListIssuesFilter(
  filter: IssueFilter,
  includeClosed = false,
): IssueFilter {
  if (includeClosed || hasExplicitStateFilter(filter)) {
    return filter;
  }

  if (Object.keys(filter).length === 0) {
    return DEFAULT_VISIBLE_ISSUES_FILTER;
  }

  return {
    and: [DEFAULT_VISIBLE_ISSUES_FILTER, filter],
  };
}

function compareCommentsChronologically(
  a: Pick<IssueComment, "createdAt" | "editedAt" | "id">,
  b: Pick<IssueComment, "createdAt" | "editedAt" | "id">,
): number {
  const createdAtComparison = a.createdAt.localeCompare(b.createdAt);

  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const editedAtComparison = (a.editedAt ?? "").localeCompare(b.editedAt ?? "");

  if (editedAtComparison !== 0) {
    return editedAtComparison;
  }

  return a.id.localeCompare(b.id);
}

function sortCommentThreads(
  comments: IssueCommentThread[],
): IssueCommentThread[] {
  comments.sort(compareCommentsChronologically);

  for (const comment of comments) {
    sortCommentThreads(comment.replies);
  }

  return comments;
}

function groupCommentsIntoThreads(
  comments: readonly IssueComment[],
): IssueCommentThread[] {
  const commentsById = new Map<string, IssueCommentThread>();

  for (const comment of comments) {
    commentsById.set(comment.id, { ...comment, replies: [] });
  }

  const rootComments: IssueCommentThread[] = [];

  for (const comment of comments) {
    const threadedComment = commentsById.get(comment.id);

    if (!threadedComment) {
      continue;
    }

    if (!comment.parentId) {
      rootComments.push(threadedComment);
      continue;
    }

    const parentComment = commentsById.get(comment.parentId);

    if (!parentComment) {
      rootComments.push(threadedComment);
      continue;
    }

    parentComment.replies.push(threadedComment);
  }

  return sortCommentThreads(rootComments);
}

function threadIssueComments(
  issue: IssueDetailWithComments,
): IssueDetailWithCommentThreads;
function threadIssueComments(
  issue: IssueByIdentifierWithComments,
): IssueByIdentifierWithCommentThreads;
function threadIssueComments(
  issue: IssueDetailWithComments | IssueByIdentifierWithComments,
): IssueDetailWithCommentThreads | IssueByIdentifierWithCommentThreads {
  return {
    ...issue,
    comments: {
      nodes: groupCommentsIntoThreads(issue.comments?.nodes ?? []),
    },
  };
}

type NormalizedIssueReactions = ReturnType<typeof normalizeReactions>;

type IssueDetailWithReactions = Omit<
  NonNullable<GetIssueByIdWithReactionsQuery["issue"]>,
  "reactions"
> & {
  reactions: NormalizedIssueReactions;
};

type IssueByIdentifierWithReactions = Omit<
  GetIssueByIdentifierWithReactionsQuery["issues"]["nodes"][0],
  "reactions"
> & {
  reactions: NormalizedIssueReactions;
};

function normalizeIssueReactions<
  T extends { reactions: Parameters<typeof normalizeReactions>[0] },
>(issue: T): Omit<T, "reactions"> & { reactions: NormalizedIssueReactions } {
  return {
    ...issue,
    reactions: normalizeReactions(issue.reactions),
  };
}

export async function listIssues(
  client: GraphQLClient,
  options: PaginationOptions = {},
  filter?: IssueFilter,
  listOptions: { includeClosed?: boolean; includeArchived?: boolean } = {},
): Promise<PaginatedResult<Issue>> {
  const { limit = 25, after } = options;
  const { includeClosed = false, includeArchived = false } = listOptions;

  const result = await client.request<FilteredSearchIssuesQuery>(
    FilteredSearchIssuesDocument,
    {
      first: limit,
      after,
      filter: buildListIssuesFilter(filter ?? {}, includeClosed),
      orderBy: PaginationOrderBy.UpdatedAt,
      includeArchived,
    },
  );
  return {
    nodes: result.issues?.nodes ?? [],
    pageInfo: result.issues.pageInfo,
  };
}

const COMMENT_PAGE_SIZE = 250;

interface CommentPageInfo {
  hasNextPage: boolean;
  endCursor?: string | null;
}

/**
 * Follow an issue's comment `pageInfo` to the end and return the comments
 * after the first page, with the last page's `pageInfo`. Makes no request
 * when the first page is complete.
 */
async function fetchRemainingComments<N>(
  issueId: string,
  firstPage: CommentPageInfo,
  fetchPage: (
    after: string,
  ) => Promise<{ nodes: N[]; pageInfo: CommentPageInfo } | undefined>,
): Promise<{ nodes: N[]; pageInfo: CommentPageInfo }> {
  const nodes: N[] = [];
  let pageInfo = firstPage;
  while (pageInfo.hasNextPage) {
    if (!pageInfo.endCursor) {
      throw new Error(
        `Linear reported more comments on issue "${issueId}" without a page cursor`,
      );
    }
    const page = await fetchPage(pageInfo.endCursor);
    if (!page) {
      throw new Error(`Issue with ID "${issueId}" not found`);
    }
    nodes.push(...page.nodes);
    pageInfo = page.pageInfo;
  }
  return { nodes, pageInfo };
}

/**
 * Per-issue comment counts for a batch of issue IDs, fetched in a SINGLE
 * request (no N+1 fan-out) to back `issues list --with-comment-counts`
 * (lin-ov30.7). Batched comment-count lookup for the page (avoids N+1).
 *
 * Linear's `CommentConnection` exposes no `totalCount`, so the count is the
 * length of the nested `comments` nodes the same query returns. The inner
 * projection caps at 250 comments/issue (see `GetIssueCommentCounts`); an
 * issue past that saturates at 250. Returns a map keyed by issue id; ids with
 * no comments (or absent from the response) resolve to 0 at the call site.
 */
export async function getCommentCountsByIssueIds(
  client: GraphQLClient,
  issueIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (issueIds.length === 0) return counts;
  const result = await client.request<GetIssueCommentCountsQuery>(
    GetIssueCommentCountsDocument,
    { filter: { id: { in: issueIds } }, first: issueIds.length },
  );
  for (const node of result.issues?.nodes ?? []) {
    counts.set(node.id, node.comments?.nodes?.length ?? 0);
  }
  return counts;
}

export async function getIssue(
  client: GraphQLClient,
  id: string,
): Promise<IssueDetail> {
  const result = await client.request<GetIssueByIdQuery>(GetIssueByIdDocument, {
    id,
  });
  if (!result.issue) {
    throw new Error(`Issue with ID "${id}" not found`);
  }
  return result.issue;
}

type IssueReadCommentPage = IssueDetailWithComments["comments"];

/**
 * Load every comment of an issue whose query carried only the first page.
 * The result's `pageInfo.hasNextPage` is always false.
 */
export async function withAllComments<
  T extends { id: string; comments: IssueReadCommentPage },
>(client: GraphQLClient, issue: T): Promise<T> {
  if (!issue.comments.pageInfo.hasNextPage) return issue;
  const rest = await fetchRemainingComments(
    issue.id,
    issue.comments.pageInfo,
    async (after) => {
      const page = await client.request<GetIssueReadCommentsPageQuery>(
        GetIssueReadCommentsPageDocument,
        { id: issue.id, first: COMMENT_PAGE_SIZE, after },
      );
      return page.issue?.comments;
    },
  );
  return {
    ...issue,
    comments: {
      nodes: [...issue.comments.nodes, ...rest.nodes],
      pageInfo: rest.pageInfo,
    },
  };
}

export async function getIssueWithComments(
  client: GraphQLClient,
  id: string,
): Promise<IssueDetailWithComments> {
  const result = await client.request<GetIssueByIdWithCommentsQuery>(
    GetIssueByIdWithCommentsDocument,
    { id },
  );
  if (!result.issue) {
    throw new Error(`Issue with ID "${id}" not found`);
  }
  return withAllComments(client, result.issue);
}

export async function getIssueWithCommentThreads(
  client: GraphQLClient,
  id: string,
): Promise<IssueDetailWithCommentThreads> {
  const issue = await getIssueWithComments(client, id);
  return threadIssueComments(issue);
}

export async function getIssueByIdentifier(
  client: GraphQLClient,
  teamKey: string,
  issueNumber: number,
): Promise<IssueByIdentifier> {
  const result = await client.request<GetIssueByIdentifierQuery>(
    GetIssueByIdentifierDocument,
    { teamKey, number: issueNumber },
  );
  if (!result.issues.nodes.length) {
    throw new Error(
      `Issue with identifier "${teamKey}-${issueNumber}" not found`,
    );
  }
  return result.issues.nodes[0];
}

export async function getIssueByIdentifierWithComments(
  client: GraphQLClient,
  teamKey: string,
  issueNumber: number,
): Promise<IssueByIdentifierWithComments> {
  const result = await client.request<GetIssueByIdentifierWithCommentsQuery>(
    GetIssueByIdentifierWithCommentsDocument,
    { teamKey, number: issueNumber },
  );
  if (!result.issues.nodes.length) {
    throw new Error(
      `Issue with identifier "${teamKey}-${issueNumber}" not found`,
    );
  }
  return withAllComments(client, result.issues.nodes[0]);
}

export async function getIssueByIdentifierWithCommentThreads(
  client: GraphQLClient,
  teamKey: string,
  issueNumber: number,
): Promise<IssueByIdentifierWithCommentThreads> {
  const issue = await getIssueByIdentifierWithComments(
    client,
    teamKey,
    issueNumber,
  );
  return threadIssueComments(issue);
}

export async function getIssueWithReactions(
  client: GraphQLClient,
  id: string,
): Promise<IssueDetailWithReactions> {
  const result = await client.request<GetIssueByIdWithReactionsQuery>(
    GetIssueByIdWithReactionsDocument,
    { id },
  );
  if (!result.issue) {
    throw new Error(`Issue with ID "${id}" not found`);
  }
  return normalizeIssueReactions(result.issue);
}

export async function getIssueByIdentifierWithReactions(
  client: GraphQLClient,
  teamKey: string,
  issueNumber: number,
): Promise<IssueByIdentifierWithReactions> {
  const result = await client.request<GetIssueByIdentifierWithReactionsQuery>(
    GetIssueByIdentifierWithReactionsDocument,
    { teamKey, number: issueNumber },
  );
  if (!result.issues.nodes.length) {
    throw new Error(
      `Issue with identifier "${teamKey}-${issueNumber}" not found`,
    );
  }
  return normalizeIssueReactions(result.issues.nodes[0]);
}

export async function getIssueWithAttachments(
  client: GraphQLClient,
  id: string,
): Promise<IssueDetailWithAttachments> {
  const result = await client.request<GetIssueByIdWithAttachmentsQuery>(
    GetIssueByIdWithAttachmentsDocument,
    { id },
  );
  if (!result.issue) {
    throw new Error(`Issue with ID "${id}" not found`);
  }
  return result.issue;
}

export async function getIssueByIdentifierWithAttachments(
  client: GraphQLClient,
  teamKey: string,
  issueNumber: number,
): Promise<IssueByIdentifierWithAttachments> {
  const result = await client.request<GetIssueByIdentifierWithAttachmentsQuery>(
    GetIssueByIdentifierWithAttachmentsDocument,
    { teamKey, number: issueNumber },
  );
  if (!result.issues.nodes.length) {
    throw new Error(
      `Issue with identifier "${teamKey}-${issueNumber}" not found`,
    );
  }
  return result.issues.nodes[0];
}

export async function searchIssues(
  client: GraphQLClient,
  term: string,
  options: PaginationOptions = {},
  filter?: IssueFilter,
): Promise<PaginatedResult<IssueSearchResult>> {
  const { limit = 25, after } = options;
  const variables: SearchIssuesQueryVariables = {
    term,
    first: limit,
    after,
    ...(filter && { filter }),
  };
  const result = await client.request<SearchIssuesQuery>(
    SearchIssuesDocument,
    variables,
  );
  return {
    nodes: result.searchIssues?.nodes ?? [],
    pageInfo: result.searchIssues.pageInfo,
  };
}

export async function createIssue(
  client: GraphQLClient,
  input: IssueCreateInput,
): Promise<CreatedIssue> {
  const result = await client.request<CreateIssueMutation>(
    CreateIssueDocument,
    { input },
  );
  if (!result.issueCreate.success || !result.issueCreate.issue) {
    throw new Error("Failed to create issue");
  }
  return result.issueCreate.issue;
}

export async function updateIssue(
  client: GraphQLClient,
  id: string,
  input: IssueUpdateInput,
): Promise<UpdatedIssue> {
  const result = await client.request<UpdateIssueMutation>(
    UpdateIssueDocument,
    { id, input },
  );
  if (!result.issueUpdate.success || !result.issueUpdate.issue) {
    throw new Error("Failed to update issue");
  }
  return result.issueUpdate.issue;
}

const NOTES_HEADING = "## Notes";

/**
 * Field selector for `editIssueField`. Each value maps to either a
 * top-level Linear field (`title`, `description`) or a Linear-Hack
 * markdown section embedded in the description body.
 */
export type EditableField =
  | "title"
  | "description"
  | "design"
  | "notes"
  | "acceptance";

export const SECTION_HEADINGS: Record<
  "design" | "notes" | "acceptance",
  string
> = {
  design: "## Design",
  notes: NOTES_HEADING,
  acceptance: "## Acceptance Criteria",
};

/**
 * Append note text to an issue's description under a `## Notes` heading.
 * If the heading is absent it is inserted at the end of the description
 * with a blank line separator; otherwise the new note is appended at the
 * end of the existing Notes section as its own paragraph. Returns the
 * updated issue.
 *
 * Linear has no dedicated `notes` field, so the description acts as the
 * destination. This is a documented Linear-Composite mapping.
 */
export async function appendNote(
  client: GraphQLClient,
  id: string,
  text: string,
): Promise<UpdatedIssue> {
  const current = await getIssue(client, id);
  const existing = current.description ?? "";
  const trimmed = existing.trimEnd();

  let next: string;
  if (trimmed.length === 0) {
    next = `${NOTES_HEADING}\n\n${text}`;
  } else if (trimmed.includes(NOTES_HEADING)) {
    next = `${trimmed}\n\n${text}`;
  } else {
    next = `${trimmed}\n\n${NOTES_HEADING}\n\n${text}`;
  }

  return updateIssue(client, id, { description: next });
}

/** One `- [ ]` / `- [x]` line found in a description. */
export interface ChecklistItem {
  /** 1-based position among the description's checklist lines. */
  index: number;
  checked: boolean;
  /** Item text after the checkbox marker. */
  text: string;
}

const CHECKBOX_RE = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$/;

/** Parse every checklist line out of a description. */
export function parseChecklist(description: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const line of description.split("\n")) {
    const m = line.match(CHECKBOX_RE);
    if (!m) continue;
    items.push({
      index: items.length + 1,
      checked: m[2] !== " ",
      text: m[4].trim(),
    });
  }
  return items;
}

export interface ChecklistToggleResult {
  identifier: string;
  item: ChecklistItem;
  /** False when the item was already in the requested state (no write). */
  changed: boolean;
  /** Checklist progress after the toggle. */
  checked_count: number;
  total_count: number;
}

/**
 * Flip exactly one checklist line in an issue's description, leaving
 * every other byte untouched. `matcher` is either a 1-based index into
 * the checklist (as printed by the ambiguity error / `parseChecklist`)
 * or a case-insensitive substring of the item text; it must select
 * exactly one item. The description is re-read on every call, so no
 * local copy is involved and the race window is a single
 * read-modify-write. Already-in-state toggles are idempotent successes
 * (no API write). (TES-824)
 */
export async function toggleChecklistItem(
  client: GraphQLClient,
  id: string,
  matcher: string,
  checked: boolean,
): Promise<ChecklistToggleResult> {
  const issue = await getIssue(client, id);
  const description = issue.description ?? "";
  const lines = description.split("\n");

  interface Candidate {
    lineIdx: number;
    item: ChecklistItem;
  }
  const candidates: Candidate[] = [];
  lines.forEach((line, lineIdx) => {
    const m = line.match(CHECKBOX_RE);
    if (!m) return;
    candidates.push({
      lineIdx,
      item: {
        index: candidates.length + 1,
        checked: m[2] !== " ",
        text: m[4].trim(),
      },
    });
  });

  if (candidates.length === 0) {
    throw fatalError(
      `${issue.identifier} has no checklist items ('- [ ]' lines) in its description`,
    );
  }

  const listing = (cs: Candidate[]): string =>
    cs
      .map(
        (c) =>
          `  ${c.item.index}. [${c.item.checked ? "x" : " "}] ${c.item.text}`,
      )
      .join("\n");

  let matches: Candidate[];
  if (/^\d+$/.test(matcher.trim())) {
    const idx = Number(matcher.trim());
    matches = candidates.filter((c) => c.item.index === idx);
  } else {
    const needle = matcher.toLowerCase();
    matches = candidates.filter((c) =>
      c.item.text.toLowerCase().includes(needle),
    );
  }

  if (matches.length === 0) {
    throw fatalError(
      `no checklist item matching "${matcher}" in ${issue.identifier}. Items:\n${listing(candidates)}`,
      { hint: "match by unique substring or by the item's number" },
    );
  }
  if (matches.length > 1) {
    throw fatalError(
      `"${matcher}" matches ${matches.length} checklist items in ${issue.identifier}:\n${listing(matches)}`,
      { hint: "disambiguate with a longer substring or the item's number" },
    );
  }

  const target = matches[0];
  const countChecked = (delta: number): number =>
    candidates.filter((c) => c.item.checked).length + delta;

  if (target.item.checked === checked) {
    return {
      identifier: issue.identifier,
      item: target.item,
      changed: false,
      checked_count: countChecked(0),
      total_count: candidates.length,
    };
  }

  lines[target.lineIdx] = lines[target.lineIdx].replace(
    CHECKBOX_RE,
    (_all, pre, _state, post, text) =>
      `${pre}${checked ? "x" : " "}${post}${text}`,
  );
  await updateIssue(client, id, { description: lines.join("\n") });

  return {
    identifier: issue.identifier,
    item: { ...target.item, checked },
    changed: true,
    checked_count: countChecked(checked ? 1 : -1),
    total_count: candidates.length,
  };
}

/**
 * Read the current value of an editable field. For `design` / `notes` /
 * `acceptance` this is the body of the corresponding `## Heading` section
 * within the issue's description.
 */
export async function getEditableFieldValue(
  client: GraphQLClient,
  id: string,
  field: EditableField,
): Promise<string> {
  const issue = await getIssue(client, id);
  if (field === "title") return issue.title ?? "";
  const description = issue.description ?? "";
  if (field === "description") return description;
  return getSection(description, SECTION_HEADINGS[field]);
}

/**
 * Apply a new value to one of the editable fields. For top-level fields
 * the value is sent straight to `issueUpdate`; for section fields the
 * description is read, the named section is spliced in, and the full
 * description is updated.
 */
export async function setEditableFieldValue(
  client: GraphQLClient,
  id: string,
  field: EditableField,
  newValue: string,
): Promise<UpdatedIssue> {
  if (field === "title") {
    if (newValue.trim().length === 0) {
      throw new Error("title cannot be empty");
    }
    return updateIssue(client, id, { title: newValue });
  }
  if (field === "description") {
    return updateIssue(client, id, { description: newValue });
  }
  const issue = await getIssue(client, id);
  const nextDescription = replaceSection(
    issue.description ?? "",
    SECTION_HEADINGS[field],
    newValue,
  );
  return updateIssue(client, id, { description: nextDescription });
}

export async function archiveIssue(
  client: GraphQLClient,
  id: string,
): Promise<IssueDetail> {
  const result = await client.request<ArchiveIssueMutation>(
    ArchiveIssueDocument,
    { id },
  );

  if (!result.issueArchive.success || !result.issueArchive.entity) {
    throw new Error(`Failed to archive issue "${id}"`);
  }

  return result.issueArchive.entity;
}

export async function unarchiveIssue(
  client: GraphQLClient,
  id: string,
): Promise<IssueDetail> {
  const result = await client.request<UnarchiveIssueMutation>(
    UnarchiveIssueDocument,
    { id },
  );

  if (!result.issueUnarchive.success || !result.issueUnarchive.entity) {
    throw new Error(`Failed to unarchive issue "${id}"`);
  }

  return result.issueUnarchive.entity;
}

export async function deleteIssue(
  client: GraphQLClient,
  id: string,
): Promise<{
  id: string;
  identifier: string;
  title: string;
  success: true;
}> {
  const result = await client.request<DeleteIssueMutation>(
    DeleteIssueDocument,
    {
      id,
    },
  );

  if (!result.issueDelete.success || !result.issueDelete.entity?.id) {
    throw new Error(`Failed to delete issue "${id}"`);
  }

  return {
    id: result.issueDelete.entity.id,
    identifier: result.issueDelete.entity.identifier,
    title: result.issueDelete.entity.title,
    success: true,
  };
}
