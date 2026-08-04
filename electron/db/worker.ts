import { randomUUID } from "node:crypto";
import { parentPort, workerData } from "node:worker_threads";
import { createConnection } from "../../src/db/connection.ts";
import { applySchema } from "../../src/db/schema.ts";
import { seedDatabase } from "../../src/db/seed/seedDatabase.ts";
import type { SaveDocumentPayload } from "../../src/db/entities/types.ts";
import {
  BookRepository,
  DocumentRepository,
  DocumentSettingsRepository,
} from "../../src/db/repositories/index.ts";

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
seedDatabase(db);

const books = new BookRepository(db);
const documents = new DocumentRepository(db);
const documentSettings = new DocumentSettingsRepository(db);

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

function handleSaveDocument(payload: SaveDocumentPayload): { documentId: string } | null {
  const { bookId, title, coverImage, contentJson, settings } = payload;
  const document = documents.findByBookId(bookId);
  if (!document) return null;
  db.transaction(() => {
    documents.updateContent(document.id, contentJson);
    documentSettings.upsert(document.id, settings);
    books.update(bookId, { title, coverImage });
  })();
  return { documentId: document.id };
}

function handleGetBook(bookId: string) {
  const book = books.findByIdWithCover(bookId);
  if (!book) return null;
  const document = documents.findByBookId(bookId) ?? null;
  const settings = document ? (documentSettings.findByDocumentId(document.id) ?? null) : null;
  return { book, document, settings };
}

const handlers: Record<string, (payload: unknown) => unknown> = {
  "create-book": handleCreateBook,
  "save-document": (payload) => handleSaveDocument(payload as SaveDocumentPayload),
  "list-books": () => books.list(),
  "get-book": (payload) => handleGetBook(payload as string),
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
