import type Database from "better-sqlite3";
import type { BookDocumentEntity } from "../entities/index.ts";

export class DocumentRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Creates the document row for a book (content starts empty). */
  insert(documentId: string, bookId: string): void {
    this.db.prepare("INSERT INTO Documents (id, bookId) VALUES (?, ?)").run(documentId, bookId);
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
