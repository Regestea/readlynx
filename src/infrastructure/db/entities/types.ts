import type { BookEntity } from "./Book.ts";
import type { BookDocumentEntity } from "./BookDocument.ts";
import type { BookSourceEntity } from "./BookSource.ts";
import type { DocumentSettingsEntity } from "./DocumentSettings.ts";
import type { BookKind } from "../../../shared/types/index.ts";

/** Result of `db:create-book`: a new book with its document. */
export interface CreateBookResult {
  bookId: string;
  documentId: string;
}

export type BookSourceType = "pdf" | "epub";

/** Payload of `db:create-translated-book`: creates a book backed by an
 *  imported PDF/EPUB source. `sourcePath` is the copied file; `coverImage`
 *  is a data URL of the first page screenshot (or null). */
export interface CreateTranslatedBookPayload {
  title: string;
  sourceType: BookSourceType;
  sourcePath: string;
  coverImage: string | null;
}

/** Payload of `db:create-reading-book`: like `create-translated-book` but the
 *  book has no document — it opens in the read-only viewer instead of the
 *  editor. */
export interface CreateReadingBookPayload {
  title: string;
  sourceType: BookSourceType;
  sourcePath: string;
  coverImage: string | null;
}

/** Result of `db:create-reading-book`. There is no document. */
export interface CreateReadingBookResult {
  bookId: string;
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

/** Payload of `db:update-book`: renames a book and/or replaces its cover.
 *  `coverImage` is a data URL, an existing relative path, or null — the main
 *  process normalizes it to a stored file (deleting the previous one). */
export interface UpdateBookPayload {
  bookId: string;
  title: string;
  coverImage: string | null;
}

/** Result of `db:get-book`. `book.coverImage` is a relative path. */
export interface GetBookResult {
  book: BookEntity;
  document: BookDocumentEntity | null;
  settings: DocumentSettingsEntity | null;
  /** Present when the book was created from an imported PDF/EPUB file. */
  source: BookSourceEntity | null;
}

/** Row of `db:list-books`. `coverImage` is a relative path like
 *  `covers/<file>`, resolved to a URL by the renderer. */
export interface BookListItem {
  id: string;
  title: string;
  kind: BookKind;
  coverImage: string | null;
  createdAt: string;
  updatedAt: string;
}
