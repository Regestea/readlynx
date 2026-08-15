import type {
  BookListItem,
  CreateBookResult,
  CreateReadingBookPayload,
  CreateReadingBookResult,
  CreateTranslatedBookPayload,
  GetBookResult,
  ReadingProgressRow,
  ReadingWeekSummary,
  SaveDocumentPayload,
  UpdateBookPayload,
} from "./infrastructure/db/entities/types.ts";
import type { AiModel } from "./infrastructure/db/entities/AiModel.ts";
import type { AppSettingsEntity } from "./infrastructure/db/entities/AppSettings.ts";
import type { CustomInstructionEntity } from "./infrastructure/db/entities/CustomInstruction.ts";
import type { ReadingStateEntity } from "./infrastructure/db/entities/ReadingState.ts";
import type { ReaderSettingsEntity, ReaderViewer } from "./infrastructure/db/entities/ReaderSettings.ts";
import type { ReadingStateInput } from "./infrastructure/db/repositories/ReadingStateRepository.ts";
import type { ReaderSettingsInput } from "./infrastructure/db/repositories/ReaderSettingsRepository.ts";
import type { TranslationEntity, TranslationMethod } from "./infrastructure/db/entities/Translation.ts";

export {};

declare global {
  interface Window {
    readlynx?: {
      exportPdf(options: {
        defaultPath: string;
        html: string;
      }): Promise<string | null>;
      onPrepareClose(callback: () => void): () => void;
      notifyReadyToClose(): void;
      /** Main-process HTTP request log lines (AI, OCR downloads, …), mirrored
       *  so they show up in the DevTools console. `body` is the (redacted)
       *  request body when the request had one. */
      onHttpLog(callback: (payload: { line: string; body?: unknown }) => void): () => void;
      readFileBytes(filePath: string): Promise<ArrayBuffer | null>;
      readCoverDataUrl(relativePath: string): Promise<string | null>;
      pickFile(options?: {
        filters?: { name: string; extensions: string[] }[];
      }): Promise<string | null>;
      importSource(options: {
        sourcePath: string;
        sourceType: string;
      }): Promise<string | null>;
      captureRect(rect: {
        x: number;
        y: number;
        width: number;
        height: number;
      }): Promise<string | null>;
      backup: {
        create(): Promise<{ ok: boolean; path?: string; error?: string } | null>;
        restore(): Promise<{ ok: boolean; path?: string; error?: string } | null>;
      };
      ocr: {
        getInfo(): Promise<{ dir: string; installed: string[] }>;
        downloadModel(lang: string): Promise<{
          ok: boolean;
          lang: string;
          bytes?: number;
          error?: string;
        }>;
        deleteModel(lang: string): Promise<{ ok: boolean; lang: string }>;
        recognize(payload: {
          dataUrl: string;
          langs: string[];
        }): Promise<{ text?: string; error?: string }>;
        onDownloadProgress(
          callback: (data: { lang: string; received: number; total: number }) => void,
        ): () => void;
        onRecognizeProgress(callback: (data: { progress: number }) => void): () => void;
      };
      db: {
        createBook(): Promise<CreateBookResult>;
        createTranslatedBook(payload: CreateTranslatedBookPayload): Promise<CreateBookResult>;
        createReadingBook(payload: CreateReadingBookPayload): Promise<CreateReadingBookResult>;
        saveDocument(payload: SaveDocumentPayload): Promise<{ documentId: string } | null>;
        listBooks(): Promise<BookListItem[]>;
        getBook(bookId: string): Promise<GetBookResult | null>;
        deleteBook(bookId: string): Promise<boolean>;
        updateBook(payload: UpdateBookPayload): Promise<BookListItem | null>;
        getAppSettings(): Promise<AppSettingsEntity | null>;
        updateAppSettings(patch: {
          theme?: string;
          chatZoom?: number;
        }): Promise<AppSettingsEntity | null>;
        listAiModels(): Promise<AiModel[]>;
        createAiModel(model: AiModel): Promise<boolean>;
        updateAiModel(model: AiModel): Promise<boolean>;
        deleteAiModel(id: string): Promise<boolean>;
        setDefaultAiModel(id: string): Promise<boolean>;
        getReadingState(bookId: string): Promise<ReadingStateEntity | null>;
        updateReadingState(
          bookId: string,
          state: ReadingStateInput,
        ): Promise<ReadingStateEntity | null>;
        markReadingStateOpened(bookId: string): Promise<boolean>;
        finalizeReadingState(bookId: string): Promise<boolean>;
        appendReadingEvent(bookId: string, startedAt: number, endedAt: number): Promise<boolean>;
        listReadingProgress(): Promise<ReadingProgressRow[]>;
        getWeekReadingEvents(): Promise<ReadingWeekSummary>;
        getDailyGoal(): Promise<{ goalMinutes: number }>;
        setDailyGoal(minutes: number): Promise<{ goalMinutes: number }>;
        getReaderSettings(
          bookId: string,
          viewer: ReaderViewer,
        ): Promise<ReaderSettingsEntity | null>;
        updateReaderSettings(
          bookId: string,
          viewer: ReaderViewer,
          settings: ReaderSettingsInput,
        ): Promise<boolean>;
        getTranslations(options: {
          bookId: string;
          method?: TranslationMethod;
          pageNumber?: number | null;
          chunkKeyPrefix?: string | null;
        }): Promise<TranslationEntity[]>;
        putTranslation(translation: TranslationEntity): Promise<boolean>;
        deleteTranslations(options: {
          bookId: string;
          method?: TranslationMethod;
          pageNumber?: number | null;
          chunkKeyPrefix?: string | null;
        }): Promise<boolean>;
        listCustomInstructions(): Promise<CustomInstructionEntity[]>;
        createCustomInstruction(
          instruction: CustomInstructionEntity,
        ): Promise<boolean>;
        updateCustomInstruction(
          instruction: CustomInstructionEntity,
        ): Promise<boolean>;
        deleteCustomInstruction(id: string): Promise<boolean>;
      };
      ai: {
        testConnection(input: {
          url: string;
          apiKey: string;
          modelName: string;
        }): Promise<{ ok: boolean; message?: string; error?: string }>;
        listGeminiModels(apiKey: string): Promise<{ value: string; label: string }[]>;
        chat(payload: {
          input: { url: string; apiKey: string; modelName: string };
          messages: { role: "system" | "user" | "assistant"; content: string }[];
          images?: string[];
        }): Promise<string>;
        structured(payload: {
          input: { url: string; apiKey: string; modelName: string };
          options: {
            systemPrompt?: string;
            prompt: string;
            images?: string[];
            jsonSchema: Record<string, unknown>;
          };
        }): Promise<unknown>;
      };
      systemFonts: {
        /** All font families installed on the OS (queried from the main
         *  process — includes user-installed fonts). */
        list(): Promise<string[]>;
      };
    };
  }
}
