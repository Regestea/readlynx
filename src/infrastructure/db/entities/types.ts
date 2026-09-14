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

export type BookSourceType = "pdf" | "epub" | "markdown";

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
 *  editor. The optional identity lets "Open with" dedupe by content and
 *  remember where the file came from. */
export interface CreateReadingBookPayload {
  title: string;
  sourceType: BookSourceType;
  sourcePath: string;
  coverImage: string | null;
  /** sha256 of the imported bytes (`NULL` for books added before tracking). */
  fileHash?: string | null;
  /** Byte length of the imported file. */
  fileSize?: number | null;
  /** Absolute OS path the file was picked from. */
  originalPath?: string | null;
}

/** A `BookSources` row returned by the identity lookups. */
export interface BookSourceLookupResult {
  id: string;
  bookId: string;
  sourceType: string;
  filePath: string;
  fileHash: string | null;
  fileSize: number | null;
  originalPath: string | null;
}

/** Payload of `db:refresh-book-source`: the book keeps its id/title, but
 *  its stored copy and identity are replaced (the outside file changed). */
export interface RefreshBookSourcePayload {
  bookId: string;
  sourcePath: string;
  fileHash: string | null;
  fileSize: number | null;
  originalPath: string | null;
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
  /** 1 = pinned to the top Pinned shelf, 0 = regular shelf order. */
  isPinned: number;
  /** UTC timestamp of the last pin action (NULL when never pinned / unpinned). */
  pinnedAt: string | null;
}

/** One day of reading time derived from the `ReadingEvents` ledger. `day`
 *  is the local calendar date "YYYY-MM-DD". */
export interface ReadingDayBucket {
  day: string;
  /** Reading seconds accumulated that day (across all books). */
  seconds: number;
}

/** Result of `db:reading-sessions-week`: the last 7 local days (oldest
 *  first, zero-filled) plus today's and the week's totals. */
export interface ReadingWeekSummary {
  days: ReadingDayBucket[];
  todaySeconds: number;
  weekSeconds: number;
}

/** Row of `db:list-reading-progress`: one per reading-kind book that has
 *  position data (PDF books carry `totalPages`, EPUB books
 *  `totalChapters`). `currentChapter` is the spine index (string) or "".
 *  `progressPercent` is the real 0..1 position for EPUB books (epubjs
 *  location percentage); PDF progress derives from `currentPage`. */
export interface ReadingProgressRow {
  bookId: string;
  title: string;
  currentPage: number;
  totalPages: number;
  currentChapter: string;
  totalChapters: number;
  progressPercent: number;
  /** Highest position reached (0..1, monotonic). */
  maxProgress: number;
  lastOpenedAt: string;
}
