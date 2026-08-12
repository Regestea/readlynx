import { Worker } from "node:worker_threads";
import type { AiModel } from "../../src/infrastructure/db/entities/AiModel.ts";
import type {
  CustomInstructionEntity,
  TranslationEntity,
  TranslationMethod,
} from "../../src/infrastructure/db/entities/index.ts";
import type { ReadingStateEntity } from "../../src/infrastructure/db/entities/ReadingState.ts";
import type { ReadingStateInput } from "../../src/infrastructure/db/repositories/ReadingStateRepository.ts";
import type {
  BookListItem,
  CreateBookResult,
  CreateReadingBookPayload,
  CreateReadingBookResult,
  CreateTranslatedBookPayload,
  GetBookResult,
  SaveDocumentPayload,
  UpdateBookPayload,
} from "../../src/infrastructure/db/entities/types.ts";

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

  createTranslatedBook(payload: CreateTranslatedBookPayload): Promise<CreateBookResult> {
    return this.exec("create-translated-book", payload);
  }

  createReadingBook(payload: CreateReadingBookPayload): Promise<CreateReadingBookResult> {
    return this.exec("create-reading-book", payload);
  }

  saveDocument(payload: SaveDocumentPayload): Promise<{ documentId: string } | null> {
    return this.exec("save-document", payload);
  }

  listBooks(): Promise<BookListItem[]> {
    return this.exec("list-books");
  }

  updateBook(payload: UpdateBookPayload): Promise<BookListItem | null> {
    return this.exec("update-book", payload);
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

  listAiModels(): Promise<AiModel[]> {
    return this.exec("ai-models-list");
  }

  createAiModel(model: AiModel): Promise<boolean> {
    return this.exec("ai-model-create", model);
  }

  updateAiModel(model: AiModel): Promise<boolean> {
    return this.exec("ai-model-update", model);
  }

  deleteAiModel(id: string): Promise<boolean> {
    return this.exec("ai-model-delete", id);
  }

  setDefaultAiModel(id: string): Promise<boolean> {
    return this.exec("ai-model-set-default", id);
  }

  getReadingState(bookId: string): Promise<ReadingStateEntity | null> {
    return this.exec("reading-state-get", bookId);
  }

  updateReadingState(bookId: string, state: ReadingStateInput): Promise<ReadingStateEntity | null> {
    return this.exec("reading-state-update", { bookId, ...state });
  }

  getTranslations(options: {
    bookId: string;
    method?: TranslationMethod | null;
    pageNumber?: number | null;
    chunkKeyPrefix?: string | null;
  }): Promise<TranslationEntity[]> {
    return this.exec("translation-get", options);
  }

  putTranslation(translation: TranslationEntity): Promise<boolean> {
    return this.exec("translation-put", translation);
  }

  deleteTranslations(options: {
    bookId: string;
    method?: TranslationMethod | null;
    pageNumber?: number | null;
    chunkKeyPrefix?: string | null;
  }): Promise<boolean> {
    return this.exec("translation-delete", options);
  }

  listCustomInstructions(): Promise<CustomInstructionEntity[]> {
    return this.exec("custom-instructions-list");
  }

  createCustomInstruction(instruction: CustomInstructionEntity): Promise<boolean> {
    return this.exec("custom-instruction-create", instruction);
  }

  updateCustomInstruction(instruction: CustomInstructionEntity): Promise<boolean> {
    return this.exec("custom-instruction-update", instruction);
  }

  deleteCustomInstruction(id: string): Promise<boolean> {
    return this.exec("custom-instruction-delete", id);
  }

  close(): void {
    void this.worker.terminate();
  }
}
