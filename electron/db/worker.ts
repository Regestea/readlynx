import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { createConnection } from "../../src/infrastructure/db/connection.ts";
import { applySchema } from "../../src/infrastructure/db/schema.ts";
import { seedDatabase } from "../../src/infrastructure/db/seed/seedDatabase.ts";
import type { CreateReadingBookPayload, CreateTranslatedBookPayload, SaveDocumentPayload, UpdateBookPayload } from "../../src/infrastructure/db/entities/types.ts";
import type { AiModel, CustomInstructionEntity, TranslationEntity, TranslationMethod } from "../../src/infrastructure/db/entities/index.ts";
import type { ReaderViewer } from "../../src/infrastructure/db/entities/index.ts";
import type { ReadingStateInput, ReaderSettingsInput } from "../../src/infrastructure/db/repositories/index.ts";
import type { BookListItem } from "../../src/infrastructure/db/entities/types.ts";
import {
  AiModelRepository,
  AppSettingsRepository,
  BookRepository,
  BookSourceRepository,
  CustomInstructionRepository,
  DocumentRepository,
  DocumentSettingsRepository,
  ReadingStateRepository,
  ReaderSettingsRepository,
  ReaderDefaultsRepository,
  TranslationRepository,
} from "../../src/infrastructure/db/repositories/index.ts";
import { EMPTY_DOCUMENT_STATE } from "../../src/infrastructure/db/repositories/DocumentRepository.ts";
import { migrateLegacyCovers, persistCoverImage, removeCoverFile } from "./covers.ts";
import { removeSourceFile } from "./sources.ts";
import { deleteAllBookTranslationImages, deleteTranslationImages } from "../store/translationImageStore.ts";
import { FileStore } from "../store/FileStore.ts";

/** Migrates existing absolute `BookSources.filePath` values to relative
 *  store keys (e.g. `"books/<filename>"`). Moves the actual file from the
 *  old absolute path into the store bucket when possible. */
function migrateAbsoluteSourcePaths(db: InstanceType<typeof import("better-sqlite3")>, store: FileStore): void {
  const rows = db
    .prepare("SELECT id, filePath FROM BookSources")
    .all() as Array<{ id: string; filePath: string }>;
  const needsMigration = rows.some((r) => path.isAbsolute(r.filePath));
  if (!needsMigration) return;

  const update = db.prepare("UPDATE BookSources SET filePath = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of rows) {
      if (!path.isAbsolute(row.filePath)) continue;
      const fileName = path.basename(row.filePath);
      const newKey = `books/${fileName}`;
      // Move file from old absolute path into store if it still exists there
      try {
        if (fs.existsSync(row.filePath)) {
          const data = fs.readFileSync(row.filePath);
          store.put("books", fileName, data);
          // Remove old file
          fs.unlinkSync(row.filePath);
        }
      } catch {
        // File may already be gone — the store copy takes priority
      }
      update.run(newKey, row.id);
    }
  })();
}

interface DbWorkerData {
  dbPath: string;
  storeRoot: string;
}

interface DbRequest {
  id: number;
  op: string;
  payload?: unknown;
}

interface DbResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

if (!parentPort) throw new Error("db worker must run as a worker thread");
const port = parentPort;
const { dbPath, storeRoot } = workerData as DbWorkerData;

const db = createConnection(dbPath);
const store = new FileStore(storeRoot);
store.init();
applySchema(db);
migrateLegacyCovers(db, store);
migrateAbsoluteSourcePaths(db, store);
seedDatabase(db);

const books = new BookRepository(db);
const documents = new DocumentRepository(db);
const documentSettings = new DocumentSettingsRepository(db);
const bookSources = new BookSourceRepository(db);
const appSettings = new AppSettingsRepository(db);
const aiModels = new AiModelRepository(db);
const readingState = new ReadingStateRepository(db);
const readerSettings = new ReaderSettingsRepository(db);
const readerDefaults = new ReaderDefaultsRepository(db);
const translations = new TranslationRepository(db);
const customInstructions = new CustomInstructionRepository(db);

function handleCreateBook(): { bookId: string; documentId: string } {
  const bookId = randomUUID();
  const documentId = randomUUID();
  db.transaction(() => {
    books.insert(bookId);
    documents.insert(documentId, bookId);
    documentSettings.insert(documentId);
  })();
  return { bookId, documentId };
}

/** Creates a translated book: a regular book (with title + cover) plus a
 *  `BookSources` row pointing at the already-copied PDF/EPUB file. */
function handleCreateTranslatedBook(payload: CreateTranslatedBookPayload): {
  bookId: string;
  documentId: string;
} {
  const bookId = randomUUID();
  const documentId = randomUUID();
  const sourceId = randomUUID();
  const storedCover = persistCoverImage(payload.coverImage, store, null);
  db.transaction(() => {
    books.insert(bookId, payload.title);
    documents.insert(documentId, bookId);
    documentSettings.insert(documentId);
    if (storedCover) books.update(bookId, { title: payload.title, coverImage: storedCover });
    bookSources.insert(sourceId, bookId, payload.sourceType, payload.sourcePath);
  })();
  return { bookId, documentId };
}

/** Creates a reading book: a regular book (with title + cover, no document)
 *  plus a `BookSources` row. Reading books open in the read-only viewer. */
function handleCreateReadingBook(payload: CreateReadingBookPayload): { bookId: string } {
  const bookId = randomUUID();
  const sourceId = randomUUID();
  const storedCover = persistCoverImage(payload.coverImage, store, null);
  db.transaction(() => {
    books.insert(bookId, payload.title, "reading");
    if (storedCover) books.update(bookId, { title: payload.title, coverImage: storedCover });
    bookSources.insert(sourceId, bookId, payload.sourceType, payload.sourcePath, {
      fileHash: payload.fileHash ?? null,
      fileSize: payload.fileSize ?? null,
      originalPath: payload.originalPath ?? null,
    });
  })();
  return { bookId };
}

/** Points an existing book at replacement content (the user edited the file
 *  outside the app and reopened it): swaps the stored copy reference and
 *  its identity, drops the now-stale cached translations (rows + images)
 *  and resets the reading position while keeping the title and reader
 *  preferences. Returns false when the book does not exist. */
function handleRefreshBookSource(payload: {
  bookId: string;
  sourcePath: string;
  fileHash: string | null;
  fileSize: number | null;
  originalPath: string | null;
}): boolean {
  const book = books.findById(payload.bookId);
  if (!book) return false;
  db.transaction(() => {
    bookSources.updateIdentity(payload.bookId, {
      filePath: payload.sourcePath,
      fileHash: payload.fileHash,
      fileSize: payload.fileSize,
      originalPath: payload.originalPath,
    });
    db.prepare("DELETE FROM Translations WHERE bookId = ?").run(payload.bookId);
    db.prepare(
      `UPDATE ReadingState SET
         currentPage = 1,
         currentChapter = '',
         totalPages = 0,
         totalChapters = 0,
         progressPercent = 0,
         maxProgress = 0,
         finished = 0,
         lastOpenedAt = datetime('now'),
         updatedAt = datetime('now')
       WHERE bookId = ?`,
    ).run(payload.bookId);
  })();
  deleteAllBookTranslationImages(store, payload.bookId);
  return true;
}

function handleSaveDocument(payload: SaveDocumentPayload): { documentId: string } | null {
  const { bookId, title, coverImage, contentJson, settings } = payload;
  const book = books.findById(bookId);
  const document = documents.findByBookId(bookId);
  if (!book || !document) return null;
  const storedCover = persistCoverImage(coverImage, store, book.coverImage);
  db.transaction(() => {
    documents.updateContent(document.id, contentJson);
    documentSettings.upsert(document.id, settings);
    books.update(bookId, { title, coverImage: storedCover });
  })();
  return { documentId: document.id };
}

function handleGetBook(bookId: string) {
  const book = books.findById(bookId);
  if (!book) return null;
  const document = documents.findByBookId(bookId) ?? null;
  const settings = document ? (documentSettings.findByDocumentId(document.id) ?? null) : null;
  const source = bookSources.findByBookId(bookId) ?? null;
  if (document) {
    // Repair rows whose content never became a valid Lexical state (e.g.
    // legacy `"{}"` rows that crash `parseEditorState` on the renderer).
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(document.contentJson);
    } catch {
      // keep `parsed` as null — the row is corrupt
    }
    const valid = parsed !== null && typeof parsed === "object" && "root" in (parsed as Record<string, unknown>);
    if (!valid) {
      document.contentJson = EMPTY_DOCUMENT_STATE;
      documents.updateContent(document.id, EMPTY_DOCUMENT_STATE);
    }
  }
  return { book, document, settings, source };
}

/** Deletes a book and everything that cascades from it. The cover file and
 *  any imported source file are removed from disk too. Returns false when the
 *  book does not exist. */
function handleDeleteBook(bookId: string): boolean {
  const book = books.findById(bookId);
  if (!book) return false;
  const source = bookSources.findByBookId(bookId);
  db.transaction(() => {
    books.remove(bookId);
  })();
  removeCoverFile(book.coverImage, store);
  if (source) removeSourceFile(source.filePath, store);
  deleteAllBookTranslationImages(store, bookId);
  return true;
}

/** Renames a book and/or replaces its cover. Persists a data-URL cover to
 *  disk (deleting the previous file) and bumps `updatedAt`, which moves the
 *  book to the top of the shelf. Returns the updated row or null. */
function handleUpdateBook(payload: UpdateBookPayload): BookListItem | null {
  const book = books.findById(payload.bookId);
  if (!book) return null;
  const storedCover = persistCoverImage(payload.coverImage, store, book.coverImage);
  db.transaction(() => {
    books.update(book.id, { title: payload.title, coverImage: storedCover });
  })();
  return books.list().find((entry) => entry.id === book.id) ?? null;
}

/** Pins or unpins a book. Returns the updated row or null when missing. */
function handleSetBookPinned(payload: { bookId: string; pinned: boolean }): BookListItem | null {
  const ok = books.setPinned(payload.bookId, payload.pinned);
  if (!ok) return null;
  return books.list().find((entry) => entry.id === payload.bookId) ?? null;
}

const handlers: Record<string, (payload: unknown) => unknown> = {
  "create-book": handleCreateBook,
  "create-translated-book": (payload) =>
    handleCreateTranslatedBook(payload as CreateTranslatedBookPayload),
  "create-reading-book": (payload) =>
    handleCreateReadingBook(payload as CreateReadingBookPayload),
  "find-book-by-source-hash": (payload) => {
    const { fileHash, fileSize } = payload as { fileHash: string; fileSize: number };
    return bookSources.findByHash(fileHash, fileSize) ?? null;
  },
  "find-book-by-original-path": (payload) =>
    bookSources.findByOriginalPath(payload as string) ?? null,
  "refresh-book-source": (payload) =>
    handleRefreshBookSource(
      payload as {
        bookId: string;
        sourcePath: string;
        fileHash: string | null;
        fileSize: number | null;
        originalPath: string | null;
      },
    ),
  "update-book-original-path": (payload) => {
    const { bookId, originalPath } = payload as { bookId: string; originalPath: string };
    bookSources.updateOriginalPath(bookId, originalPath);
    return true;
  },
  "save-document": (payload) => handleSaveDocument(payload as SaveDocumentPayload),
  "list-books": () => books.list(),
  "get-book": (payload) => handleGetBook(payload as string),
  "delete-book": (payload) => handleDeleteBook(payload as string),
  "update-book": (payload) => handleUpdateBook(payload as UpdateBookPayload),
  "set-book-pinned": (payload) =>
    handleSetBookPinned(payload as { bookId: string; pinned: boolean }),
  "get-app-settings": () => appSettings.get() ?? null,
  "update-app-settings": (payload) => {
    appSettings.update(payload as { theme?: string; chatZoom?: number });
    return appSettings.get() ?? null;
  },
  "ai-models-list": () => aiModels.list(),
  "ai-model-create": (payload) => {
    aiModels.insert(payload as AiModel);
    return true;
  },
  "ai-model-update": (payload) => {
    aiModels.update(payload as AiModel);
    return true;
  },
  "ai-model-delete": (payload) => {
    aiModels.remove(payload as string);
    return true;
  },
  "ai-model-set-default": (payload) => {
    aiModels.setDefault(payload as string);
    return true;
  },
  "reading-state-get": (payload) =>
    readingState.findByBookId(payload as string) ?? null,
  "reading-state-update": (payload) => {
    const { bookId, ...state } = payload as { bookId: string } & ReadingStateInput;
    readingState.upsert(bookId, state);
    return readingState.findByBookId(bookId) ?? null;
  },
  "reading-state-mark-opened": (payload) => {
    readingState.markOpened(payload as string);
    return true;
  },
  "reading-state-finalize": (payload) => {
    readingState.finalizeReadingState(payload as string);
    return true;
  },
  "reading-state-add-time": (payload) => {
    const { bookId, startedAt, endedAt } = payload as {
      bookId: string;
      startedAt: number;
      endedAt: number;
    };
    readingState.appendReadingEvent(bookId, startedAt, endedAt);
    return true;
  },
  "reading-events-week": () => readingState.sessionsWeek(),
  "reading-goal-get": () => ({ goalMinutes: readingState.getDailyGoal() }),
  "reading-goal-set": (payload) => {
    const { minutes } = payload as { minutes: number };
    readingState.setDailyGoal(minutes);
    return { goalMinutes: minutes };
  },
  "reading-progress-list": () => readingState.listReadingProgress(),
  "reader-settings-get": (payload) => {
    const { bookId, viewer } = payload as { bookId: string; viewer: ReaderViewer };
    return readerSettings.findByKey(bookId, viewer) ?? null;
  },
  "reader-settings-update": (payload) => {
    const { bookId, viewer, ...settings } = payload as {
      bookId: string;
      viewer: ReaderViewer;
    } & ReaderSettingsInput;
    readerSettings.upsert(bookId, viewer, settings);
    return true;
  },
  "reader-defaults-get": (payload) => {
    const { viewer } = payload as { viewer: ReaderViewer };
    return readerDefaults.findByViewer(viewer) ?? null;
  },
  "reader-defaults-list": () => readerDefaults.list(),
  "reader-defaults-update": (payload) => {
    const { viewer, ...settings } = payload as {
      viewer: ReaderViewer;
    } & ReaderSettingsInput;
    readerDefaults.upsert(viewer, settings);
    return true;
  },
  "translation-get": (payload) => {
    const { bookId, method, pageNumber, chunkKeyPrefix } = payload as {
      bookId: string;
      method?: TranslationMethod | null;
      pageNumber?: number | null;
      chunkKeyPrefix?: string | null;
    };
    return translations.findByKey(bookId, method ?? null, pageNumber ?? null, chunkKeyPrefix ?? null);
  },
  "translation-put": (payload) => {
    translations.upsert(payload as TranslationEntity);
    return true;
  },
  "translation-delete": (payload) => {
    const { bookId, method, pageNumber, chunkKeyPrefix } = payload as {
      bookId: string;
      method?: TranslationMethod | null;
      pageNumber?: number | null;
      chunkKeyPrefix?: string | null;
    };
    translations.deleteWhere(bookId, method ?? null, pageNumber ?? null, chunkKeyPrefix ?? null);
    if (chunkKeyPrefix) {
      deleteTranslationImages(store, bookId, chunkKeyPrefix);
    }
    return true;
  },
  "custom-instructions-list": () => customInstructions.list(),
  "custom-instruction-create": (payload) => {
    customInstructions.insert(payload as CustomInstructionEntity);
    return true;
  },
  "custom-instruction-update": (payload) => {
    customInstructions.update(payload as CustomInstructionEntity);
    return true;
  },
  "custom-instruction-delete": (payload) => {
    customInstructions.remove(payload as string);
    return true;
  },
  /** Writes a consistent snapshot of the live database (WAL included) to a
   *  new file — safe to run while the connection is open. */
  "backup-db": async (payload) => {
    await db.backup(payload as string);
    return true;
  },
};

port.on("message", (request: DbRequest) => {
  const respond = (response: DbResponse) => port.postMessage(response);
  Promise.resolve()
    .then(() => {
      const handler = handlers[request.op];
      if (!handler) {
        throw new Error(`Unknown db operation: ${request.op}`);
      }
      return handler(request.payload);
    })
    .then((result) => respond({ id: request.id, ok: true, result }))
    .catch((error) => {
      respond({
        id: request.id,
        ok: false,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
    });
});
