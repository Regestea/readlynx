import { Worker } from "node:worker_threads";
import type {
  BookListItem,
  CreateBookResult,
  GetBookResult,
  SaveDocumentPayload,
} from "../../src/db/entities/types.ts";

interface DbResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Async bridge to the SQLite worker thread. All DB work runs off the main
 *  process event loop so saves never block the UI. */
export class DbWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  private nextId = 0;

  constructor(dbPath: string) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      workerData: { dbPath },
    });
    this.worker.on("message", (response: DbResponse) => {
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);
      if (response.ok) {
        entry.resolve(response.result);
      } else {
        entry.reject(new Error(response.error ?? "Unknown db worker error"));
      }
    });
    this.worker.on("error", (error) => {
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    });
  }

  private exec<T>(op: string, payload?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ id, op, payload });
    });
  }

  createBook(): Promise<CreateBookResult> {
    return this.exec("create-book");
  }

  saveDocument(payload: SaveDocumentPayload): Promise<{ documentId: string } | null> {
    return this.exec("save-document", payload);
  }

  listBooks(): Promise<BookListItem[]> {
    return this.exec("list-books");
  }

  getBook(bookId: string): Promise<GetBookResult | null> {
    return this.exec("get-book", bookId);
  }

  deleteBook(bookId: string): Promise<boolean> {
    return this.exec("delete-book", bookId);
  }

  getAppSettings(): Promise<{ theme: string } | null> {
    return this.exec("get-app-settings");
  }

  updateAppSettings(theme: string): Promise<{ theme: string }> {
    return this.exec("update-app-settings", { theme });
  }

  close(): void {
    void this.worker.terminate();
  }
}
