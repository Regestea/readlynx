import { randomUUID } from "node:crypto";
import { parentPort, workerData } from "node:worker_threads";
import { createConnection } from "../../src/db/connection.ts";
import { applySchema } from "../../src/db/schema.ts";
import { seedDatabase } from "../../src/db/seed/seedDatabase.ts";
import type { CreateTranslatedBookPayload, SaveDocumentPayload } from "../../src/db/entities/types.ts";
import type { AiModel } from "../../src/db/entities/AiModel.ts";
import {
  AiModelRepository,
  AppSettingsRepository,
  BookRepository,
  BookSourceRepository,
  DocumentRepository,
  DocumentSettingsRepository,
} from "../../src/db/repositories/index.ts";
import { EMPTY_DOCUMENT_STATE } from "../../src/db/repositories/DocumentRepository.ts";
import { migrateLegacyCovers, persistCoverImage, removeCoverFile } from "./covers.ts";
import { removeSourceFile } from "./sources.ts";

interface DbWorkerData {
  dbPath: string;
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
const { dbPath } = workerData as DbWorkerData;

const db = createConnection(dbPath);
applySchema(db);
migrateLegacyCovers(db, dbPath);
seedDatabase(db);

const books = new BookRepository(db);
const documents = new DocumentRepository(db);
const documentSettings = new DocumentSettingsRepository(db);
const bookSources = new BookSourceRepository(db);
const appSettings = new AppSettingsRepository(db);
const aiModels = new AiModelRepository(db);

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
  const storedCover = persistCoverImage(payload.coverImage, dbPath, null);
  db.transaction(() => {
    books.insert(bookId, payload.title);
    documents.insert(documentId, bookId);
    documentSettings.insert(documentId);
    if (storedCover) books.update(bookId, { title: payload.title, coverImage: storedCover });
    bookSources.insert(sourceId, bookId, payload.sourceType, payload.sourcePath);
  })();
  return { bookId, documentId };
}

function handleSaveDocument(payload: SaveDocumentPayload): { documentId: string } | null {
  const { bookId, title, coverImage, contentJson, settings } = payload;
  const book = books.findById(bookId);
  const document = documents.findByBookId(bookId);
  if (!book || !document) return null;
  const storedCover = persistCoverImage(coverImage, dbPath, book.coverImage);
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
  removeCoverFile(book.coverImage, dbPath);
  if (source) removeSourceFile(source.filePath, dbPath);
  return true;
}

const handlers: Record<string, (payload: unknown) => unknown> = {
  "create-book": handleCreateBook,
  "create-translated-book": (payload) =>
    handleCreateTranslatedBook(payload as CreateTranslatedBookPayload),
  "save-document": (payload) => handleSaveDocument(payload as SaveDocumentPayload),
  "list-books": () => books.list(),
  "get-book": (payload) => handleGetBook(payload as string),
  "delete-book": (payload) => handleDeleteBook(payload as string),
  "get-app-settings": () => appSettings.get() ?? null,
  "update-app-settings": (payload) => {
    const { theme } = payload as { theme: string };
    appSettings.updateTheme(theme);
    return { theme };
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
};

port.on("message", (request: DbRequest) => {
  const respond = (response: DbResponse) => port.postMessage(response);
  try {
    const handler = handlers[request.op];
    if (!handler) {
      respond({ id: request.id, ok: false, error: `Unknown db operation: ${request.op}` });
      return;
    }
    respond({ id: request.id, ok: true, result: handler(request.payload) });
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
});
