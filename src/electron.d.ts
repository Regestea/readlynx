import type {
  BookListItem,
  CreateBookResult,
  CreateTranslatedBookPayload,
  GetBookResult,
  SaveDocumentPayload,
} from "./db/entities/types.ts";
import type { AiModel } from "./db/entities/AiModel.ts";

export {};

declare global {
  interface Window {
    readlynx?: {
      exportPdf(options: {
        defaultPath: string;
        html: string;
      }): Promise<string | null>;
      readFileBytes(filePath: string): Promise<ArrayBuffer | null>;
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
