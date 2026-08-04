import type { BookEntity } from "./Book.ts";
import type { BookDocumentEntity } from "./BookDocument.ts";
import type { DocumentSettingsEntity } from "./DocumentSettings.ts";

/** Result of `db:create-book`: a new book with its document. */
export interface CreateBookResult {
  bookId: string;
  documentId: string;
}

/** Payload of `db:save-document`. `coverImage` is a data URL, an existing
 *  relative path, or null — the main process normalizes it to a stored file. */
export interface SaveDocumentPayload {
  bookId: string;
  title: string;
  coverImage: string | null;
  contentJson: string;
  settings: Omit<DocumentSettingsEntity, "documentId" | "updatedAt">;
}

/** Result of `db:get-book`. `book.coverImage` is a relative path. */
export interface GetBookResult {
  book: BookEntity;
  document: BookDocumentEntity | null;
  settings: DocumentSettingsEntity | null;
}

/** Row of `db:list-books`. `coverImage` is a relative path like
 *  `covers/<file>`, resolved to a URL by the renderer. */
export interface BookListItem {
  id: string;
  title: string;
  coverImage: string | null;
  createdAt: string;
  updatedAt: string;
}
