import type { GraphQLClient } from "../client/graphql-client.js";
import type {
  CreatedDocument,
  Document,
  DocumentListItem,
  PaginatedResult,
  UpdatedDocument,
} from "../common/types.js";
import {
  DocumentCreateDocument,
  type DocumentCreateInput,
  type DocumentCreateMutation,
  DocumentDeleteDocument,
  type DocumentDeleteMutation,
  type DocumentFilter,
  DocumentUpdateDocument,
  type DocumentUpdateInput,
  type DocumentUpdateMutation,
  GetDocumentCommentTargetDocument,
  type GetDocumentCommentTargetQuery,
  GetDocumentDocument,
  type GetDocumentQuery,
  ListDocumentsDocument,
  type ListDocumentsQuery,
} from "../gql/graphql.js";

export interface DocumentCommentTarget {
  id: string;
  title: string;
  documentContentId: string;
}

export async function getDocument(
  client: GraphQLClient,
  id: string,
): Promise<Document> {
  const result = await client.request<GetDocumentQuery>(GetDocumentDocument, {
    id,
  });

  if (!result.document) {
    throw new Error(`Document with ID "${id}" not found`);
  }

  return result.document;
}

/**
 * Resolves a document (slug ID or UUID) to the ID a comment can be posted
 * against. Comments hang off the document's DocumentContent entity, so
 * `documentContentId` — not the document ID — is what `commentCreate` wants.
 */
export async function getDocumentCommentTarget(
  client: GraphQLClient,
  id: string,
): Promise<DocumentCommentTarget> {
  const result = await client.request<GetDocumentCommentTargetQuery>(
    GetDocumentCommentTargetDocument,
    { id },
  );

  if (!result.document) {
    throw new Error(`Document with ID "${id}" not found`);
  }

  if (!result.document.documentContentId) {
    throw new Error(
      `Document "${result.document.title}" has no content to comment on`,
    );
  }

  return {
    id: result.document.id,
    title: result.document.title,
    documentContentId: result.document.documentContentId,
  };
}

export async function createDocument(
  client: GraphQLClient,
  input: DocumentCreateInput,
): Promise<CreatedDocument> {
  const result = await client.request<DocumentCreateMutation>(
    DocumentCreateDocument,
    { input },
  );

  if (!result.documentCreate.success || !result.documentCreate.document) {
    throw new Error("Failed to create document");
  }

  return result.documentCreate.document;
}

export async function updateDocument(
  client: GraphQLClient,
  id: string,
  input: DocumentUpdateInput,
): Promise<UpdatedDocument> {
  const result = await client.request<DocumentUpdateMutation>(
    DocumentUpdateDocument,
    { id, input },
  );

  if (!result.documentUpdate.success || !result.documentUpdate.document) {
    throw new Error("Failed to update document");
  }

  return result.documentUpdate.document;
}

export async function listDocuments(
  client: GraphQLClient,
  options?: {
    limit?: number;
    after?: string;
    filter?: DocumentFilter;
  },
): Promise<PaginatedResult<DocumentListItem>> {
  const result = await client.request<ListDocumentsQuery>(
    ListDocumentsDocument,
    {
      first: options?.limit ?? 25,
      after: options?.after,
      filter: options?.filter,
    },
  );

  return {
    nodes: result.documents?.nodes ?? [],
    pageInfo: result.documents?.pageInfo ?? {
      hasNextPage: false,
      endCursor: null,
    },
  };
}

export async function listDocumentsBySlugIds(
  client: GraphQLClient,
  slugIds: string[],
): Promise<DocumentListItem[]> {
  if (slugIds.length === 0) {
    return [];
  }

  const result = await client.request<ListDocumentsQuery>(
    ListDocumentsDocument,
    {
      first: slugIds.length,
      filter: {
        slugId: { in: slugIds },
      },
    },
  );

  return result.documents?.nodes ?? [];
}

export async function deleteDocument(
  client: GraphQLClient,
  id: string,
): Promise<{ id: string; success: boolean }> {
  const result = await client.request<DocumentDeleteMutation>(
    DocumentDeleteDocument,
    { id },
  );

  if (!result.documentDelete.success) {
    throw new Error("Failed to delete document");
  }

  return { id: result.documentDelete.entity?.id ?? id, success: true };
}
