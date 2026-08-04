import type { BookEntity } from "./Book.ts";
import type { BookDocumentEntity } from "./BookDocument.ts";
import type { DocumentSettingsEntity } from "./DocumentSettings.ts";

/** Result of `db:create-book`: a new book with its document. */
export interface CreateBookResult {
  bookId: string;
  documentId: string;
}

/** Payload of `db:save-document`. */
export interface SaveDocumentPayload {
  bookId: string;
  title: string;
  coverImage: string | null;
  contentJson: string;
  settings: Omit<DocumentSettingsEntity, "documentId" | "updatedAt">;
}

/** Book with the cover BLOB decoded back to a data URL. */
export type BookWithDecodedCover = Omit<BookEntity, "coverImage"> & {
  coverImage: string | null;
};

/** Result of `db:get-book`. */
export interface GetBookResult {
  book: BookWithDecodedCover;
  document: BookDocumentEntity | null;
  settings: DocumentSettingsEntity | null;
}

/** Row of `db:list-books` (cover BLOB decoded back to a data URL). */
export interface BookListItem {
  id: string;
  title: string;
  coverImage: string | null;
  createdAt: string;
  updatedAt: string;
}
