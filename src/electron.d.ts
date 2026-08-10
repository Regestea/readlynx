import type {
  BookListItem,
  CreateBookResult,
  CreateReadingBookPayload,
  CreateReadingBookResult,
  CreateTranslatedBookPayload,
  GetBookResult,
  SaveDocumentPayload,
} from "./db/entities/types.ts";
import type { AiModel } from "./db/entities/AiModel.ts";
import type { ReadingStateEntity } from "./db/entities/ReadingState.ts";
import type { ReadingStateInput } from "./db/repositories/ReadingStateRepository.ts";
import type { TranslationEntity, TranslationMethod } from "./db/entities/Translation.ts";

export {};

declare global {
  interface Window {
    readlynx?: {
      exportPdf(options: {
        defaultPath: string;
        html: string;
      }): Promise<string | null>;
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
        getAppSettings(): Promise<{ theme: string } | null>;
        updateAppSettings(theme: string): Promise<{ theme: string }>;
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
        getTranslations(options: {
          bookId: string;
          method: TranslationMethod;
          pageNumber?: number | null;
          chunkKeyPrefix?: string | null;
        }): Promise<TranslationEntity[]>;
        putTranslation(translation: TranslationEntity): Promise<boolean>;
        deleteTranslations(options: {
          bookId: string;
          method: TranslationMethod;
          pageNumber?: number | null;
          chunkKeyPrefix?: string | null;
        }): Promise<boolean>;
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
    };
  }
}
