import type {
  BookListItem,
  CreateBookResult,
  CreateTranslatedBookPayload,
  GetBookResult,
  SaveDocumentPayload,
} from "./db/entities/types.ts";

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
      db: {
        createBook(): Promise<CreateBookResult>;
        createTranslatedBook(payload: CreateTranslatedBookPayload): Promise<CreateBookResult>;
        saveDocument(payload: SaveDocumentPayload): Promise<{ documentId: string } | null>;
        listBooks(): Promise<BookListItem[]>;
        getBook(bookId: string): Promise<GetBookResult | null>;
        deleteBook(bookId: string): Promise<boolean>;
        getAppSettings(): Promise<{ theme: string } | null>;
        updateAppSettings(theme: string): Promise<{ theme: string }>;
      };
    };
  }
}
