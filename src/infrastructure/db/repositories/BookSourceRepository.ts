import type Database from "better-sqlite3";
import type { BookSourceEntity } from "../entities/index.ts";

export class BookSourceRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Records the imported PDF/EPUB file behind a book. `filePath` is the
   *  absolute path of the copy stored in the books directory. */
  insert(sourceId: string, bookId: string, sourceType: string, filePath: string): void {
    this.db
      .prepare("INSERT INTO BookSources (id, bookId, sourceType, filePath) VALUES (?, ?, ?, ?)")
      .run(sourceId, bookId, sourceType, filePath);
  }

  findByBookId(bookId: string): BookSourceEntity | undefined {
    return this.db.prepare("SELECT * FROM BookSources WHERE bookId = ?").get(bookId) as
      | BookSourceEntity
      | undefined;
  }
}
