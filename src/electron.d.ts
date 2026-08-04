import type {
  BookListItem,
  CreateBookResult,
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
      db: {
        createBook(): Promise<CreateBookResult>;
        saveDocument(payload: SaveDocumentPayload): Promise<{ documentId: string } | null>;
        listBooks(): Promise<BookListItem[]>;
        getBook(bookId: string): Promise<GetBookResult | null>;
      };
    };
  }
}
