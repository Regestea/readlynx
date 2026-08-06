import type Database from "better-sqlite3";
import type { BookDocumentEntity } from "../entities/index.ts";

/** A valid, non-empty Lexical editor state (`root` present, one empty
 *  paragraph) used for freshly created documents. Storing `"{}"` (the column
 *  default) crashes `LexicalEditor.parseEditorState` on open. */
export const EMPTY_DOCUMENT_STATE =
  '{"root":{"children":[{"children":[],"direction":null,"format":"","indent":0,"type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"root","version":1}}';

export class DocumentRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Creates the document row for a book (content starts as a valid empty
   *  editor state). */
  insert(documentId: string, bookId: string): void {
    this.db
      .prepare("INSERT INTO Documents (id, bookId, contentJson) VALUES (?, ?, ?)")
      .run(documentId, bookId, EMPTY_DOCUMENT_STATE);
  }

  updateContent(documentId: string, contentJson: string): void {
    this.db.prepare("UPDATE Documents SET contentJson = ? WHERE id = ?").run(contentJson, documentId);
  }

  findByBookId(bookId: string): BookDocumentEntity | undefined {
    return this.db.prepare("SELECT * FROM Documents WHERE bookId = ?").get(bookId) as
      | BookDocumentEntity
      | undefined;
  }
}
