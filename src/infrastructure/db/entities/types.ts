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
 *  remember where the file came from. `temporary` marks a session-only
 *  import (its file type's add-to-library switch is off): the book is
 *  hidden from the shelf and removed at the next launch. */
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
  /** Session-only import — purge at the next app launch, skip the shelf. */
  temporary?: boolean;
}

/** A `BookSources` row returned by the identity lookups (joined with the
 *  owning book's session flag). */
export interface BookSourceLookupResult {
  id: string;
  bookId: string;
  sourceType: string;
  filePath: string;
  fileHash: string | null;
  fileSize: number | null;
  originalPath: string | null;
  /** 1 = session-only copy (hidden from the shelf, removed at the next
   *  launch); 0 = a permanent library entry. */
  temporary: number;
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

/** Cleanup journal event kinds. Every event describes work outside this
 *  database (store files, renderer localStorage) whose references were
 *  removed in the same transaction that recorded the event; a replay pass
 *  at each launch performs the work and deletes the row. Handlers treat
 *  replay as possible at any time, so each one is idempotent: work that was
 *  already done (or never became necessary) completes as a no-op.
 *
 *  - `source-imported`: the store copy was written before its book row
 *    landed (recorded by `fs:import-source` before the copy); claimed by
 *    the create handlers' transaction, otherwise the unclaimed copy is
 *    deleted at replay.
 *  - `remove-files`: store keys (e.g. `books/<name>`, `covers/<name>`) or
 *    legacy absolute paths whose owning rows no longer exist.
 *  - `remove-translation-images`: cached translation page images under
 *    `translation-images/<bookId>/`, optionally narrowed to a chunk-key
 *    prefix when single units are retranslated.
 *  - `renderer-remove-scroll-keys`: scroll-ratio keys in the renderer's
 *    localStorage, consumed by the shell at startup. */
export type CleanupEventType =
  | "source-imported"
  | "remove-files"
  | "remove-translation-images"
  | "renderer-remove-scroll-keys";

export interface SourceImportedPayload {
  /** Store key of the copied file, e.g. `books/<uuid>.pdf`. */
  key: string;
}

export interface RemoveFilesPayload {
  paths: string[];
}

export interface RemoveTranslationImagesPayload {
  bookId: string;
  /** Slice to delete instead of the whole book — a translated chunk key
   *  prefix (a chapter) or PDF page path (a page). */
  prefix?: string;
}

export interface RemoveRendererScrollKeysPayload {
  bookId: string;
}

/** A pending journal row. `payload` is the JSON-encoded payload shape above. */
export interface CleanupEventEntity {
  id: string;
  type: CleanupEventType;
  payload: string;
  createdAt: string;
}

/** Row handed to the renderer for `renderer-remove-scroll-keys` events. */
export interface RendererCleanupEvent {
  id: string;
  bookId: string;
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
